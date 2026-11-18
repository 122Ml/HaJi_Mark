// Local acceptance. --real-model explicitly uses the existing shared 50 CNY
// budget. The default tests manual UI only; no seeded report is called AI output.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { choose } = require('./browser-ui.cjs');
const root = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:18080';
const folder = path.join(root, '.local/intelligence');
fs.mkdirSync(folder, { recursive: true });
const real = process.argv.includes('--real-model');
const resume = process.argv.includes('--resume');
const verifySaved = process.argv.includes('--verify-saved');
const retained = resume || verifySaved ? JSON.parse(fs.readFileSync(path.join(folder, 'report.json'), 'utf8')) : null;
const report = resume ? retained : { started_at: new Date().toISOString(), real_model: real, checks: [], errors: [], serverErrors: [] };
assert(!(verifySaved && (real || resume)), 'Saved-result verification never starts model calls');
if (resume) {
  assert(real && report.real_model && report.course_id && report.agent_run_id, 'Resume only the retained real-model run');
  fs.copyFileSync(path.join(folder, 'report.json'), path.join(folder, `interrupted-${Date.now()}.json`));
  report.resumed_at = new Date().toISOString();
  delete report.failure;
}
const pass = text => { report.checks.push(text); console.log('PASS', text); };
const accounts = JSON.parse(fs.readFileSync(path.join(root, '.local/s1-accounts.json'), 'utf8')).accounts;
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('dialog', d => { if (d.type() === 'beforeunload') void d.accept(); else void d.dismiss(); });
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('response', r => { if (r.url().startsWith(base + '/api/') && r.status() >= 500) report.serverErrors.push(r.status() + ' ' + new URL(r.url()).pathname); });
    let csrf = '';
    async function call(method, url, body, expected = 200) {
      const r = await context.request.fetch(base + '/api/v1' + url, { method, data: body, headers: { Origin: base, 'X-CSRF-Token': csrf } });
      assert.equal(r.status(), expected, `${method} ${url}: ${r.status()} ${await r.text()}`);
      return (await r.json()).data;
    }
    async function login(name) {
      await context.clearCookies();
      const a = accounts.find(a => a.username === name); assert(a);
      csrf = (await call('POST', '/sessions', { username: a.username, password: a.password })).csrf_token;
    }
    async function until(label, read, accept, timeout = 150000) {
      const start = Date.now(); let state = '';
      while (Date.now() - start < timeout) {
        const value = await read();
        const next = value.report?.job_state || value.runs?.[0]?.state || '';
        if (next !== state) { console.log(label, next); state = next; }
        if (['failed', 'unknown', 'canceled'].includes(next)) throw Error(`${label}: ${JSON.stringify(value.report?.job_error || value.runs?.[0]?.error)}`);
        if (accept(value)) return value;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      throw Error(`${label}: timeout, inspect the retained run/report before retrying`);
    }
    await login('s1-teacher');
    if (verifySaved) {
      assert(retained.passed && retained.course_id && retained.recommendation_id);
      const prefix = '/learning/courses/' + retained.course_id;
      const diagnosis = await call('GET', prefix + '/intelligence/' + retained.diagnosis_id);
      assert.equal(diagnosis.report.state, 'confirmed');
      await page.goto(`${base}/teacher/dashboard?course=${retained.course_id}&view=overview`);
      await page.getByText('教师已确认', { exact: true }).last().waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Teacher diagnosis mobile overflow');
      await page.screenshot({ path: path.join(folder, 'diagnosis-mobile.png'), fullPage: true });
      pass('教师已确认诊断刷新可读，390px无页面横向溢出');
      await page.setViewportSize({ width: 1440, height: 1000 });
      const conversation = await call('GET', prefix + '/agent/conversations/' + retained.conversation_id);
      assert.equal(conversation.runs[0].state, 'succeeded');
      assert(conversation.requests.some(r => r.response.changed && r.response.snapshot_hash));
      await page.goto(`${base}/teacher/assistant?course=${retained.course_id}&conversation=${retained.conversation_id}`);
      await page.getByText('知识编辑已完成', { exact: false }).waitFor();
      pass('重启容器后原对话、工具回执与完成状态持久保留');
      await login('s1-student-a');
      await page.goto(`${base}/student/learning?course=${retained.course_id}`);
      await page.getByRole('button', { name: '收藏', exact: true }).first().waitFor();
      const recommendation = await call('GET', prefix + '/intelligence/' + retained.recommendation_id);
      assert(recommendation.choices.some(c => c.choice === 'saved'));
      const candidate = recommendation.report.input.candidates[0];
      await page.getByRole('link', { name: candidate.title, exact: true }).first().click();
      await page.getByText('教师独立编写：先确定允许区间', { exact: false }).waitFor();
      pass('学生历史偏好保留，推荐链接进入确切授权知识正文');
      await page.screenshot({ path: path.join(folder, 'recommended-content.png'), fullPage: true });
      assert.deepEqual(report.errors, []);
      assert.deepEqual(report.serverErrors, []);
      report.course_id = retained.course_id;
      report.passed = true;
      report.finished_at = new Date().toISOString();
      return;
    }
    const course = resume ? { id: report.course_id } : await call('POST', '/learning/courses', { title: '智能收口本地验收 ' + Date.now() });
    report.course_id = course.id;
    const prefix = '/learning/courses/' + course.id;
    if (!resume) {
    await call('POST', prefix + '/members', { username: 's1-student-a' });
    await call('POST', prefix + '/publish', {});
    const point = await call('POST', prefix + '/points', { title: '边界值分析', kind: 'point', position: 0 });
    await page.goto(`${base}/teacher/knowledge?course=${course.id}`);
    await page.getByRole('button', { name: '新建知识', exact: true }).click();
    const editor = page.getByRole('dialog');
    await choose(editor.getByLabel('内容来源', { exact: true }), '教师自编教学示例');
    await editor.getByLabel('标题', { exact: true }).fill('教师自编边界示例');
    await editor.getByLabel('知识正文', { exact: true }).fill('教师独立编写：检查18至60的整数年龄时，既检验允许区间内的值，也检验区间外的值是否被拒绝。');
    const points = editor.getByRole('combobox', { name: '关联课程知识点', exact: true });
    await points.click();
    await page.locator('.ant-select-dropdown:visible').getByText('边界值分析', { exact: true }).click();
    await points.press('Escape');
    await editor.getByLabel('学生可见', { exact: true }).check();
    assert(await editor.getByLabel('用于评分依据', { exact: true }).isDisabled());
    await editor.getByRole('button', { name: '保存待审核版本', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    const knowledge = (await call('GET', prefix + '/knowledge')).find(k => k.title === '教师自编边界示例');
    assert(knowledge && knowledge.origin === 'teacher_example' && !knowledge.use_for_grading && knowledge.evidence.length === 0);
    pass('教师自编示例独立编写、保存草稿，评分用途被禁用');

    const assignment = await call('POST', prefix + '/assignments', { title: '正式结果诊断样本', questions: [{ prompt: '系统只允许18到60的整数年龄。列出边界测试值、说明合法性及范围外测试目的。', max_score: 10, rubric: '覆盖6分、分类2分、目的2分', knowledge_point_id: point.id }] });
    const question = (await call('GET', prefix + '/assignments/' + assignment.id)).questions[0];
    const rubric = await call('POST', prefix + '/questions/' + question.id + '/rubrics', { criteria: [{ id: 'D1', title: '覆盖', max_score: 6, rule: '每个明确选定的目标数值1分' }, { id: 'D2', title: '分类', max_score: 2, rule: '范围内合法与范围外非法各1分' }, { id: 'D3', title: '目的', max_score: 2, rule: '检查系统拒绝超范围输入2分，否则0分' }] });
    await call('POST', prefix + '/rubrics/' + rubric.id + '/confirm', {});
    await call('POST', prefix + '/assignments/' + assignment.id + '/state', { state: 'published' });
    await login('s1-student-a');
    const submission = await call('POST', prefix + '/assignments/' + assignment.id + '/submissions', { question_id: question.id, answer_text: '测试17、18、19、59、60、61。这六个年龄都合法，系统应该全部接受。', request_id: crypto.randomUUID() });
    await login('s1-teacher');
    const grade = await call('POST', prefix + '/submissions/' + submission.id + '/revisions', { score: 7, feedback: '范围外分类和目的有误，覆盖完整。', rubric_id: rubric.id, request_id: crypto.randomUUID(), points: [{ criterion_id: 'D1', score: 6, feedback: '完整', quote: '测试17、18、19、59、60、61' }, { criterion_id: 'D2', score: 1, feedback: '把范围外也判为合法', quote: '这六个年龄都合法' }, { criterion_id: 'D3', score: 0, feedback: '应该检查拒绝', quote: '系统应该全部接受' }] });
    for (const state of ['confirmed', 'released']) await call('POST', prefix + '/revisions/' + grade.id + '/state', { state });
    if (real) {
      report.budget_before = (await call('GET', prefix + '/models')).budget;
      await page.goto(`${base}/teacher/dashboard?course=${course.id}&view=overview`);
      await choose(page.getByLabel('分析题目与标准', { exact: true }), `${question.prompt.slice(0, 55)} · 标准v1`);
      await page.getByRole('button', { name: '分析正式失分作答', exact: true }).click();
      const diagnosis = await until('诊断', async () => { const list = await call('GET', prefix + '/intelligence?kind=diagnosis'); return list.length ? call('GET', prefix + '/intelligence/' + list[0].id) : {}; }, value => value.report?.job_state === 'succeeded');
      report.diagnosis_id = diagnosis.report.id;
      const findings = diagnosis.report.output.findings || [];
      for (const f of findings) for (const e of f.evidence) { assert.equal(e.submission_id, submission.id); assert(submission.answer_text.includes(e.quote)); }
      assert.equal(diagnosis.report.input.eligible, 1);
      await page.getByRole('button', { name: '确认本批诊断', exact: true }).waitFor();
      for (const f of findings.filter(f => !f.label_id)) {
        const label = await call('POST', prefix + '/diagnosis-labels', { title: f.title }); f.label_id = label.id;
      }
      await call('POST', prefix + '/intelligence/' + diagnosis.report.id + '/confirm', { output: diagnosis.report.output, edit_version: diagnosis.report.edit_version });
      await page.reload();
      await page.getByText('教师已确认', { exact: true }).last().waitFor();
      await page.screenshot({ path: path.join(folder, 'diagnosis.png'), fullPage: true });
      pass('真实模型诊断：固定正式结果、逐字证据、新标签维护与教师确认、刷新保留');

      const ap = prefix + '/agent';
      const conversation = await call('POST', ap + '/conversations', { mode: 'auto-review', profile_id: 'bailian-qwen' });
      report.conversation_id = conversation.id;
      await page.goto(`${base}/teacher/assistant?course=${course.id}&conversation=${conversation.id}`);
      await page.getByLabel('消息', { exact: true }).fill(`请委派资料知识专家，调用knowledge_editor打开现有知识${knowledge.id}的编辑工作台，等我编辑保存后返回。不要新建条目，不要替我编写内容，不要确认、发布或归档。`);
      await page.getByRole('button', { name: '发送', exact: true }).click();
      const waiting = await until('助理编辑', () => call('GET', ap + '/conversations/' + conversation.id), v => v.requests?.some(r => r.state === 'pending' && r.snapshot.editor));
      report.agent_run_id = waiting.runs[0].id;
      await page.getByRole('button', { name: '打开知识编辑', exact: true }).click();
      const work = page.getByRole('dialog');
      await work.getByLabel('知识正文', { exact: true }).fill('教师修改后的教学示例：范围外取值用于验证系统是否拒绝超范围输入。');
      assert(await work.getByRole('button', { name: '返回对话并继续', exact: true }).isDisabled());
      await page.reload();
      await page.getByRole('button', { name: '打开知识编辑', exact: true }).click();
      const restored = page.getByRole('dialog');
      assert((await restored.getByLabel('知识正文', { exact: true }).inputValue()).includes('教师修改后的教学示例'));
      await restored.getByRole('button', { name: '保存待审核版本', exact: true }).click();
      await restored.getByText('版本已保存，可返回原对话继续核对与确认', { exact: true }).waitFor();
      await restored.getByRole('button', { name: '返回对话并继续', exact: true }).click();
      const done = await until('助理返回', () => call('GET', ap + '/conversations/' + conversation.id), v => v.runs?.[0]?.state === 'succeeded');
      assert(done.requests.some(r => r.response.changed === true && JSON.stringify(r.response.saved_snapshot).includes('教师修改后的教学示例')));
      assert(done.runs.some(r => r.stream_text));
      assert.equal((await call('GET', prefix + '/knowledge')).find(k => k.id === knowledge.id).state, 'draft');
      await page.screenshot({ path: path.join(folder, 'agent-return.png'), fullPage: true });
      pass('真实助理：委派→工作台→未保存草稿刷新恢复→保存→服务端回执→原运行继续；正式确认未被跳过；流式文本落库');
    }
    }
    const knowledge = (await call('GET', prefix + '/knowledge')).find(k => k.title === '教师自编边界示例');
    assert(knowledge);
    const currentKnowledge = (await call('GET', prefix + '/knowledge')).find(k => k.id === knowledge.id);
    if (currentKnowledge.state === 'draft') await call('POST', prefix + '/knowledge/' + knowledge.id + '/state', { state: 'confirmed', edit_version: currentKnowledge.edit_version });
    // The scored point has 70%, so rules correctly omit it. An additional
    // ungraded point provides eligible content without changing formal evidence.
    const graph = await call('GET', prefix + '/graph');
    const ungraded = graph.nodes.find(p => p.title === '未评分的边界练习') || await call('POST', prefix + '/points', { title: '未评分的边界练习', kind: 'point', position: 1 });
    let extra = (await call('GET', prefix + '/knowledge')).find(k => k.title === '教师自编未评分练习提示');
    if (!extra) extra = await call('POST', prefix + '/knowledge', { title: '教师自编未评分练习提示', body: '教师独立编写：先确定允许区间，再比较端点和相邻整数的预期处理。', origin: 'teacher_example', content_kind: 'example', student_visible: true, use_for_learning: true, use_for_grading: false, knowledge_point_ids: [ungraded.id], evidence: [] });
    if (extra.state === 'draft') await call('POST', prefix + '/knowledge/' + extra.id + '/state', { state: 'confirmed', edit_version: extra.edit_version });
    await login('s1-student-a');
    await call('POST', prefix + '/path', {});
    await page.goto(`${base}/student/learning?course=${course.id}`);
    await page.getByRole('button', { name: 'AI排序', exact: true }).waitFor();
    if (real) {
      await page.getByRole('button', { name: 'AI排序', exact: true }).click();
      const recommendation = await until('推荐', async () => { const rows = await call('GET', prefix + '/intelligence?kind=recommendation'); return rows.length ? call('GET', prefix + '/intelligence/' + rows[0].id) : {}; }, v => v.report?.job_state === 'succeeded');
      report.recommendation_id = recommendation.report.id;
      assert.equal(recommendation.report.output.ranking.length, recommendation.report.input.candidates.length);
      const panel = page.locator('.ant-card').filter({ has: page.getByText('学习推荐', { exact: true }) }).first();
      await panel.getByRole('button', { name: '收藏', exact: true }).first().click();
      await page.reload();
      await panel.getByRole('button', { name: '收藏', exact: true }).first().waitFor();
      const chosen = await call('GET', prefix + '/intelligence/' + recommendation.report.id);
      assert(chosen.choices.some(c => c.choice === 'saved'));
      await page.screenshot({ path: path.join(folder, 'recommendation.png'), fullPage: true });
      pass('真实推荐：规则候选→AI排序→授权内容链接→偏好保存→刷新与历史');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(folder, 'mobile.png'), fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    pass('学生推荐与关联学习在390px无页面横向溢出');
    await login('s1-teacher');
    if (real) report.budget_after = (await call('GET', prefix + '/models')).budget;
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.serverErrors, []);
    report.finished_at = new Date().toISOString();
    report.passed = true;
  } catch (e) {
    report.passed = false; report.failure = e.stack;
    if (page) await page.screenshot({ path: path.join(folder, 'failure.png'), fullPage: true }).catch(() => {});
    console.error(e.message); process.exitCode = 1;
  } finally {
    const target = path.join(folder, verifySaved ? 'saved-report.json' : 'report.json');
    if (fs.existsSync(target)) fs.copyFileSync(target, path.join(folder, `report-${Date.now()}.json`));
    fs.writeFileSync(target, JSON.stringify(report, null, 2));
    await browser.close();
  }
})();
