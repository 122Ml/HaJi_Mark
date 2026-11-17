// Local business/interaction acceptance. SQL seeds only labelled long-history and
// visibility fixtures; submissions and formal grades use real authorized APIs.
// No model endpoints are invoked and no data/volumes are deleted.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { choose } = require('./browser-ui.cjs');
const root = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:18080';
const accounts = JSON.parse(fs.readFileSync(path.join(root, '.local/s1-accounts.json'), 'utf8')).accounts;
const folder = path.join(root, '.local/completion');
fs.mkdirSync(folder, { recursive: true });
const reportPath = path.join(folder, 'report.json');
if (fs.existsSync(reportPath)) fs.copyFileSync(reportPath, path.join(folder, `report-${Date.now()}.json`));
const report = { started_at: new Date().toISOString(), real_model: false, checks: [], errors: [], serverErrors: [] };
const pass = text => { report.checks.push(text); console.log('PASS', text); };
function seed(sql) {
  const r = spawnSync('docker', ['compose', '-f', 'compose.yaml', '-f', 'compose.rag.yaml', 'exec', '-T', 'postgres', 'sh', '-c', 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'], { cwd: root, input: sql, encoding: 'utf8', timeout: 15000 });
  assert.equal(r.status, 0, r.stderr || r.error?.message);
}
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('response', r => { if (r.url().startsWith(base + '/api/') && r.status() >= 500) report.serverErrors.push(r.status() + ' ' + new URL(r.url()).pathname); });
    let csrf = '';
    async function call(method, url, body, expected = 200) {
      const r = await context.request.fetch(base + '/api/v1' + url, { method, data: body, headers: { Origin: base, 'X-CSRF-Token': csrf } });
      assert.equal(r.status(), expected, `${method} ${url}: ${r.status()} ${await r.text()}`);
      return expected === 204 ? null : (await r.json()).data;
    }
    async function login(name) {
      await context.clearCookies();
      const a = accounts.find(a => a.username === name); assert(a, 'Missing local account');
      csrf = (await call('POST', '/sessions', { username: a.username, password: a.password })).csrf_token;
    }
    const screenshot = name => page.screenshot({ path: path.join(folder, name), fullPage: true });
    await login('s1-teacher');
    const teacher = (await call('GET', '/me')).user;
    const course = await call('POST', '/learning/courses', { title: '增量闭环自动验收 ' + Date.now() });
    report.course_id = course.id;
    const prefix = '/learning/courses/' + course.id;
    for (const username of ['s1-student-a', 's1-student-b']) await call('POST', prefix + '/members', { username });
    await call('POST', prefix + '/publish', {});
    const members = await call('GET', prefix + '/members');
    const point = await call('POST', prefix + '/points', { title: '构造边界知识点', kind: 'point', position: 0 });
    const assignment = await call('POST', prefix + '/assignments', { title: '批量导入验收', questions: [{ prompt: '说明测试范围外输入的目的', max_score: 10, rubric: '逐点按证据评分', knowledge_point_id: point.id }] });
    const ap = prefix + '/assignments/' + assignment.id;
    const question = (await call('GET', ap)).questions[0];
    const rubric = await call('POST', prefix + '/questions/' + question.id + '/rubrics', { criteria: [{ id: 'D1', title: '测试目的', max_score: 10, rule: '说明拒绝超范围输入的检查目的' }] });
    await call('POST', prefix + '/rubrics/' + rubric.id + '/confirm', {});
    await call('POST', ap + '/state', { state: 'published' });
    await page.goto(`${base}/teacher/homework/${assignment.id}/submissions?course=${course.id}`);
    await page.getByRole('button', { name: '导入文本作答', exact: true }).click();
    const drawer = page.getByRole('dialog');
    await choose(drawer.getByLabel('导入到题目', { exact: true }), '1. ' + question.prompt);
    const input = drawer.getByLabel('CSV内容', { exact: true });
    const csv = 'username,answer_text\ns1-student-a,"检查拒绝范围外输入😀\n保留换行"\ns1-student-b,"检查系统拒绝超范围输入"';
    await input.fill(csv.replace('s1-student-b', 'not-enrolled'));
    await drawer.getByRole('button', { name: '预览核对', exact: true }).click();
    await drawer.getByText('当前课程没有该学生，请先核对用户名或选课名单', { exact: true }).waitFor();
    assert(await drawer.getByRole('button', { name: /确认导入/ }).isDisabled());
    assert.equal((await call('GET', ap + '/submissions')).length, 0);
    await input.fill(csv);
    await drawer.getByRole('button', { name: '预览核对', exact: true }).click();
    await drawer.getByText('已核对，尚未导入', { exact: true }).waitFor();
    assert.equal((await call('GET', ap + '/submissions')).length, 0);
    await drawer.getByRole('button', { name: '确认导入 2 份答案', exact: true }).click();
    await drawer.getByText('已导入2份答案，尚未评分', { exact: true }).waitFor();
    assert.equal(await drawer.getByLabel('CSV内容', { exact: true }).count(), 0, 'Committed import still presents a pending form');
    const gradingURL = await drawer.getByRole('link', { name: '开始批阅', exact: true }).getAttribute('href');
    await screenshot('import-receipt.png');
    await drawer.getByRole('button', { name: '再导入一批', exact: true }).click();
    assert.equal(await drawer.getByLabel('CSV内容', { exact: true }).inputValue(), '');
    const submissions = await call('GET', ap + '/submissions');
    assert.equal(submissions.length, 2);
    assert(submissions.every(s => s.teacher_imported));
    const a = submissions.find(s => s.student_id === members.find(m => m.username === 's1-student-a').id);
    assert.equal(a.answer_text, '检查拒绝范围外输入😀\n保留换行');
    await page.goto(new URL(gradingURL, base).href);
    await page.getByText('教师导入', { exact: true }).first().waitFor();
    pass('CSV student validation, no-write preview, explicit commit, exact multiline original and grading provenance');
    for (const s of submissions) {
      const score = s.id === a.id ? 4 : 10;
      const grade = await call('POST', prefix + '/submissions/' + s.id + '/revisions', { score, feedback: '构造验收正式反馈', request_id: crypto.randomUUID(), rubric_id: rubric.id, points: [{ criterion_id: 'D1', score, quote: s.answer_text.split('\n')[0], feedback: '构造逐点反馈，可回到原文核对' }] });
      for (const state of ['confirmed', 'released']) await call('POST', prefix + '/revisions/' + grade.id + '/state', { state });
    }
    await page.goto(`${base}/teacher/dashboard?course=${course.id}&view=gaps`);
    const gaps = page.locator('.diagnosis-section');
    assert.equal(await page.getByLabel('学生范围', { exact: true }).count(), 0, 'Unapplied student filter shown on class gaps');
    await gaps.getByText('1 / 2 人', { exact: true }).waitFor();
    await gaps.getByRole('button', { name: '查看证据', exact: true }).click();
    await page.getByRole('dialog').getByText('同标准有效人数 2', { exact: true }).waitFor();
    await page.getByRole('dialog').getByText('构造逐点反馈，可回到原文核对', { exact: true }).waitFor();
    const link = page.getByRole('dialog').getByRole('link', { name: '安排补学补练' });
    assert((await link.getAttribute('href')).includes('submission=' + a.id));
    await screenshot('criterion-evidence.png');
    pass('Formal per-criterion denominator, affected student drilldown, original quote and intervention source link');

    // Fixtures are deliberately labelled and isolated to this new course. No model-run claim.
    const conversation = await call('POST', prefix + '/agent/conversations', { title: '构造长历史验收', mode: 'read-only' });
    seed(`BEGIN;
      INSERT INTO assist_turns(id,course_id,owner_id,request_id,question,state,response,created_at)
      SELECT '${course.id}-qa-'||n,'${course.id}','${teacher.id}','history-'||n,'构造历史问题-'||n,'succeeded','{"text":"构造保存回答[R1]。","sources":[{"id":"fixture","title":"自编依据","body":"保留引用原句","locator":{}}],"citations":[{"id":"fixture","quote":"保留引用原句"}]}',now()+n*interval '1 second' FROM generate_series(1,12)n;
      INSERT INTO assist_turns(id,course_id,owner_id,request_id,question,state) VALUES('${course.id}-failed','${course.id}','${teacher.id}','failed','构造失败问题','failed');
      INSERT INTO agent_messages(id,conversation_id,role,content,created_at)
      SELECT '${course.id}-msg-'||n,'${conversation.id}','user','构造历史消息-'||n,now()+n*interval '1 second' FROM generate_series(1,225)n;
      INSERT INTO agent_conversations(id,course_id,owner_id,title,mode)
      SELECT '${course.id}-conversation-'||n,'${course.id}','${teacher.id}','构造分页会话-'||n,'read-only' FROM generate_series(1,35)n;
      INSERT INTO knowledge_entries(id,course_id,created_by,title,body,state,student_visible,use_for_learning,knowledge_point_ids)
      VALUES('${course.id}-knowledge','${course.id}','${teacher.id}','构造可见精炼知识','这是显式构造的权限与链接验收内容。','confirmed',true,true,ARRAY['${point.id}']),
      ('${course.id}-private','${course.id}','${teacher.id}','构造私有知识','不应出现在学生路径。','confirmed',false,true,ARRAY['${point.id}']),
      ('${course.id}-draft','${course.id}','${teacher.id}','构造草稿知识','不应出现在学生路径。','draft',true,true,ARRAY['${point.id}']); COMMIT;`);
    await page.goto(`${base}/teacher/retrieval?course=${course.id}`);
    await page.getByRole('button', { name: '构造历史问题-12', exact: true }).click();
    await page.getByRole('dialog').locator('blockquote').filter({ hasText: '保留引用原句' }).waitFor();
    await page.reload();
    await page.getByRole('dialog').locator('blockquote').filter({ hasText: '保留引用原句' }).waitFor();
    await page.getByRole('button', { name: '带回输入框', exact: true }).click();
    assert.equal(await page.getByLabel('课程问题', { exact: true }).inputValue(), '构造历史问题-12');
    await page.goto(`${base}/teacher/retrieval?course=${course.id}&history_page=2`);
    await page.getByRole('button', { name: '构造失败问题', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '本次尚无已保存回答' }).waitFor();
    await screenshot('saved-retrieval.png');
    pass('Persistent cited answer drawer, URL refresh, history page 2, failed-state recovery and explicit prompt reuse');
    await page.goto(`${base}/teacher/assistant?course=${course.id}&conversation=${conversation.id}`);
    await page.getByText('构造历史消息-225', { exact: true }).waitFor();
    for (let i = 0; i < 4; i++) {
      const load = page.getByRole('button', { name: '加载更早记录', exact: true });
      await load.click();
      await page.getByText('构造历史消息-' + Math.max(1, 176 - (i + 1) * 50), { exact: true }).waitFor();
    }
    assert.equal(await page.locator('.agent-message').count(), 225);
    assert.equal(await page.getByRole('button', { name: '加载更早记录', exact: true }).count(), 0);
    await page.reload();
    await page.getByText('构造历史消息-225', { exact: true }).waitFor();
    assert.equal(await page.locator('.agent-message').count(), 50);
    await page.getByRole('button', { name: '加载更多对话', exact: true }).click();
    assert.equal(await page.locator('[data-conversation-id]').count(), 36);
    await screenshot('conversation-history.png');
    pass('225 persisted messages page without omissions/duplicates; refresh resets window; conversation list loads beyond 30');
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      await page.goto(`${base}/teacher/retrieval?course=${course.id}`);
      await page.getByRole('button', { name: '构造历史问题-12', exact: true }).waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'History page overflow ' + width);
    }
    await login('s1-student-a');
    await call('GET', prefix + '/assist/history/' + course.id + '-qa-12', undefined, 404);
    await call('GET', prefix + '/agent/conversations/' + conversation.id, undefined, 404);
    await call('POST', prefix + '/path', {});
    await page.goto(`${base}/student/learning?course=${course.id}`);
    await page.getByText('关联精炼知识（1）', { exact: true }).click();
    await page.getByText('构造可见精炼知识', { exact: false }).first().waitFor();
    assert.equal(await page.getByText('构造私有知识', { exact: true }).count(), 0);
    assert.equal(await page.getByText('构造草稿知识', { exact: true }).count(), 0);
    await page.getByRole('link', { name: '阅读知识', exact: true }).click();
    await page.waitForURL(u => u.pathname === '/student/knowledge' && u.searchParams.get('knowledge') === course.id + '-knowledge');
    await screenshot('path-knowledge.png');
    pass('Rule path links to currently authorized confirmed knowledge; private/draft entries and owner histories stay isolated');
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.serverErrors, []);
    pass('390/1440 page layout; zero browser exceptions and unexpected 5xx');
  } catch (e) { report.failure = e.message; if (page) await page.screenshot({ path: path.join(folder, 'failure.png'), fullPage: true }); throw e; }
  finally { report.finished_at = new Date().toISOString(); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); await browser.close(); }
})().catch(e => { console.error(e.message); process.exit(1); });
