const { choose, selectedText, selectFile } = require('./browser-ui.cjs');
// Local browser acceptance against Docker. Optional real calls share the server budget.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:18080';
const accounts = JSON.parse(fs.readFileSync(path.join(root, '.local/s1-accounts.json'), 'utf8')).accounts;
const ids = JSON.parse(fs.readFileSync(path.join(root, '.local/question-bank-check.json'), 'utf8'));
const output = path.join(root, '.local/question-bank-browser.json');
const report = { checks: [], screenshots: [], course_id: ids.course_id };
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
const assert = (ok, message) => { if (!ok) throw Error(message); };
const pass = message => { report.checks.push(message); save(); console.log('PASS', message); };
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const contexts = [], errors = [], serverErrors = [];
  try {
    async function login(username, role) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); contexts.push(context);
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', r => { if (r.status() >= 500 && r.url().includes('/api/') && r.headers()['x-acceptance-injected'] !== '1') serverErrors.push(r.status() + ' ' + new URL(r.url()).pathname); });
      page.on('dialog', d => d.accept());
      await page.goto(base + '/login');
      await page.getByLabel('用户名', { exact: true }).fill(username);
      await page.getByLabel('密码', { exact: true }).fill(accounts.find(a => a.username === username).password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.waitForURL(u => u.pathname === `/${role}/${role === 'teacher' ? 'dashboard' : 'home'}`);
      const me = (await (await page.request.get(base + '/api/v1/me')).json()).data;
      async function call(method, route, data, extra = {}) {
        const r = await page.request.fetch(base + '/api/v1' + route, { method, data, ...extra, headers: { Origin: base, 'X-CSRF-Token': me.csrf_token } });
        assert(r.status() === 200, `${method} ${route}: ${r.status()} ${(await r.text()).slice(0, 400)}`);
        return (await r.json()).data;
      }
      return { page, call };
    }
    const { page: t, call: tc } = await login('s1-teacher', 'teacher');
    const { page: s } = await login('s1-student-a', 'student');
    const p = '/learning/courses/' + ids.course_id;
    const url = (role, route, suffix = '') => `${base}/${role}/${route}?course=${ids.course_id}${suffix}`;
    const post = (page, ending) => page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(ending));
    await t.goto(url('teacher', 'question-bank'));
    await t.getByRole('button', { name: '新建题目', exact: true }).click();
    await selectFile(t.getByRole('button', { name: '导入题目 JSON', exact: true }), { name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ title: 'bad', prompt: {}, criteria: 'bad' })) });
    await t.getByText('题目须含文本title、prompt，reference_answer也须为文本', { exact: true }).waitFor();
    pass('malformed import is rejected without crashing the editor');
    const title = '浏览器题库验收 ' + Date.now();
    await t.getByLabel('题目名称', { exact: true }).fill(title);
    await t.getByLabel('题干与条件', { exact: true }).fill('说明为什么要测试18到60整数区间之外的相邻年龄。');
    await t.getByLabel('参考解答', { exact: true }).fill('检查系统是否拒绝超范围输入。');
    let failed = false;
    await t.route('**/question-bank', route => { if (route.request().method() === 'POST' && !failed) { failed = true; return route.fulfill({ status: 503, headers: { 'X-Acceptance-Injected': '1' }, contentType: 'application/json', body: JSON.stringify({ error: { code: 'test_failure', message: '验收模拟：暂时保存失败' } }) }); } return route.continue(); });
    await t.getByRole('button', { name: '保存题目草稿', exact: true }).click();
    await t.getByText('验收模拟：暂时保存失败', { exact: true }).waitFor();
    assert(await t.getByLabel('题目名称', { exact: true }).inputValue() === title, 'failed save lost content');
    const [createdResponse] = await Promise.all([post(t, '/question-bank'), t.getByRole('button', { name: '保存题目草稿', exact: true }).click()]);
    assert(createdResponse.ok(), 'question retry failed');
    const version = (await createdResponse.json()).data; report.bank_id = version.bank_id; report.version_id = version.id; save();
    await t.getByRole('button', { name: '确认题目', exact: true }).click();
    await t.getByRole('button', { name: '确认参考解答', exact: true }).click();
    pass('manual question save recovers from failure and confirms question/reference separately');
    await t.getByRole('tab', { name: '评分标准', exact: true }).click();
    await t.getByRole('button', { name: '新建标准版本', exact: true }).click();
    await t.getByLabel('评分点名称', { exact: true }).fill('拒绝行为');
    await t.getByLabel('给分规则', { exact: true }).fill('明确说明用于检查拒绝超范围输入得10分，否则0分。');
    const [rubricResponse] = await Promise.all([post(t, `/versions/${version.id}/rubrics`), t.getByRole('button', { name: '保存标准草稿', exact: true }).click()]);
    assert(rubricResponse.ok(), 'rubric save failed');
    report.rubric_id = (await rubricResponse.json()).data.id; save();
    await t.getByRole('button', { name: '确认标准 v1', exact: true }).click();
    await t.locator('.live-revision').filter({has: t.getByRole('heading', { name: '标准 v1', exact: true })}).locator('.ui-status-tag').filter({hasText: /^已确认$/}).waitFor();
    pass('teacher creates and confirms a versioned standard in the bank UI');
    await t.goto(url('teacher', 'homework/new'));
    await t.getByLabel('作业标题', { exact: true }).fill(title + ' 作业');
    await t.getByRole('button', { name: '从题库选题', exact: true }).click();
    const picker = t.getByRole('dialog', { name: '从题库选题', exact: true });
    await choose(picker.getByRole('combobox', { name: '题目', exact: true }), title);
    await picker.getByRole('button', { name: '加入作业', exact: true }).click();
    assert(await t.getByLabel('题目要求', { exact: true }).evaluate(el => el.readOnly), 'bank prompt was editable');
    assert(await t.getByLabel('满分', { exact: true }).evaluate(el => el.readOnly), 'bank score was editable');
    const [assignmentResponse] = await Promise.all([post(t, '/assignments'), t.getByRole('button', { name: '保存并发布', exact: true }).click()]);
    assert(assignmentResponse.ok(), 'assignment save failed');
    const assignment = (await assignmentResponse.json()).data; report.assignment_id = assignment.id; save();
    await t.waitForURL(u => u.pathname === '/teacher/homework');
    pass('assignment picker fixes question and rubric, then publishes from the UI');
    await s.goto(url('student', 'homework/' + assignment.id));
    const answer = '检查系统是否拒绝超范围输入。';
    await s.getByLabel('我的作答', { exact: true }).fill(answer);
    await s.getByRole('button', { name: '提交本题', exact: true }).click();
    const [submissionResponse] = await Promise.all([post(s, `/assignments/${assignment.id}/submissions`), s.getByRole('button', { name: '确认提交', exact: true }).click()]);
    const submission = (await submissionResponse.json()).data; report.submission_id = submission.id; save();
    await t.goto(url('teacher', `homework/submissions/${submission.id}/grade`));
    await t.getByLabel('D1 得分', { exact: true }).fill('10');
    await t.getByLabel('D1 评语', { exact: true }).fill('明确说明了拒绝行为。');
    await t.getByLabel('D1 原文引用', { exact: true }).fill(answer);
    await t.getByLabel('终审评语', { exact: true }).fill('测试目的正确。');
    await t.getByRole('button', { name: '保存逐点评分草稿', exact: true }).click();
    await t.getByRole('button', { name: '确认评分', exact: true }).click();
    await t.getByRole('button', { name: '发布正式反馈', exact: true }).click();
    await s.goto(url('student', `homework/submissions/${submission.id}/feedback`));
    await s.getByText('测试目的正确。', { exact: true }).waitFor();
    pass('student submission reaches fixed-standard teacher grading and released feedback through the UI');

    if (process.argv.includes('--real-ai')) {
      const text = '边界值分析：只接受18至60的整数年龄。测试17、18、19、59、60、61；18、19、59、60合法，17、61非法，范围外测试检查系统是否拒绝超范围输入。';
      const jobs = await tc('POST', p + '/sources', undefined, { multipart: { source_note: '题库浏览器验收构造资料', allow_derived: 'true', files: { name: 'browser-bank.txt', mimeType: 'text/plain', buffer: Buffer.from(text) } } });
      async function waitJob(job) {
        for (let i = 0; i < 150; i++) {
          const current = await tc('GET', p + '/jobs/' + job.id);
          if (current.state === 'succeeded') return current;
          assert(!['failed','canceled'].includes(current.state), current.error);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        throw Error('AI job timeout');
      }
      for (const job of jobs) await waitJob(job);
      const source = (await tc('GET', p + '/sources')).find(source => source.filename === 'browser-bank.txt');
      report.source_id = source.id;
      await waitJob(await tc('POST', p + '/jobs', { kind: 'index' }));
      await t.goto(url('teacher', 'materials', '&source=' + source.id));
      await t.getByRole('link', { name: '据此出题', exact: true }).click();
      assert(new URL(t.url()).searchParams.get('source_id') === source.id, 'source context lost');
      await t.getByRole('button', { name: '查找依据', exact: true }).click();
      await t.locator('.bank-evidence .rag-hit input[type=checkbox]').first().check();
      await t.getByLabel('AI出题要求', { exact: true }).fill('出一道边界值分析主观题，要求列值、分类、说明范围外目的。');
      const [jobResponse] = await Promise.all([post(t, '/question-bank/jobs'), t.getByRole('button', { name: 'AI出题', exact: true }).click()]);
      const job = (await jobResponse.json()).data; report.generate_job_id = job.id; save();
      await waitJob(job);
      const adopt = t.getByRole('button', { name: '载入编辑区', exact: true });
      await adopt.waitFor();
      const requirements = t.getByLabel('AI出题要求', { exact: true });
      const originalRequirements = await requirements.inputValue();
      await requirements.fill(originalRequirements + ' 改为另一题。');
      assert(await adopt.isDisabled(), 'stale AI candidate could overwrite changed requirements');
      await requirements.fill(originalRequirements);
      await t.getByRole('button', { name: '载入编辑区', exact: true }).click();
      assert((await t.getByLabel('题干与条件', { exact: true }).inputValue()).length > 10, 'AI question not adopted');
      const [saved] = await Promise.all([post(t, '/question-bank'), t.getByRole('button', { name: '保存题目草稿', exact: true }).click()]);
      assert(saved.ok(), 'AI question save failed');
      const aiVersion = (await saved.json()).data; report.ai_bank_id = aiVersion.bank_id;
      await t.getByRole('button', { name: '确认题目', exact: true }).click();
      await t.getByRole('button', { name: '确认参考解答', exact: true }).click();
      await t.getByRole('tab', { name: '评分标准', exact: true }).click();
      await t.getByRole('button', { name: '确认标准 v1', exact: true }).click();
      await t.locator('.live-revision').filter({has: t.getByRole('heading', { name: '标准 v1', exact: true })}).locator('.ui-status-tag').filter({hasText: /^已确认$/}).waitFor();
      pass('source-to-bank deep link, real AI generation, adoption and separate confirmations work in the UI');
    }
    for (const width of [1440, 390]) {
      await t.setViewportSize({ width, height: 1000 });
      await t.goto(url('teacher', 'question-bank', '&bank=' + report.bank_id));
      await t.getByRole('heading', { name: title, exact: true }).first().waitFor();
      assert(await t.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow at ${width}px`);
      const file = `.local/question-bank-${width}.png`;
      await t.screenshot({ path: path.join(root, file), fullPage: true }); report.screenshots.push(file);
    }
    pass('desktop and 390px bank pages have no horizontal overflow');
    assert(!errors.length, errors.join('\n')); assert(!serverErrors.length, serverErrors.join('\n'));
    pass('no browser exceptions or unexpected server failures');
  } catch (error) {
    report.error = error.message;
    const page = contexts[0]?.pages()[0];
    if (page) { report.failure_url = page.url(); await page.screenshot({ path: path.join(root, '.local/question-bank-browser-failure.png'), fullPage: true }).catch(() => {}); }
    save(); throw error;
  } finally {
    report.browser_errors = errors; report.server_errors = serverErrors;
    for (const context of contexts) await context.close();
    await browser.close(); save();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
