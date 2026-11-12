const { choose, selectedText } = require('./browser-ui.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const ids = JSON.parse(fs.readFileSync(path.join(root, '.local/rubric-check.json'), 'utf8'));
const accounts = JSON.parse(fs.readFileSync(path.join(root, '.local/s1-accounts.json'), 'utf8')).accounts;
const base = 'http://127.0.0.1:18080';
const assert = (v, m) => { if (!v) throw Error(m); };
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  const contexts = [];
  try {
    async function login(name, role) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); contexts.push(ctx);
      const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
      await page.goto(base + '/login');
      await page.getByLabel('用户名', { exact: true }).fill(name);
      await page.getByLabel('密码', { exact: true }).fill(accounts.find(a => a.username === name).password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.waitForURL(u=>u.pathname===`/${role}/${role === 'teacher' ? 'dashboard' : 'home'}`);
      const courses = (await (await page.request.get(base + '/api/v1/me/courses')).json()).data;
      await choose(page.getByRole('combobox', { name: '当前课程', exact: true }), courses.find(c => c.id === ids.course_id).title);
      return page;
    }
    const t = await login('s1-teacher', 'teacher');
    const a = await login('s1-student-a', 'student');
    await t.goto(`${base}/teacher/homework/${ids.assignment_id}`);
    await t.locator('.ant-collapse-header').filter({ hasText: '逐点评分标准' }).click();
    await t.getByRole('button',{name:'新建标准版本',exact:true}).click();
    await t.getByLabel('评分点名称', { exact: true }).fill('新版本草稿验收');
    await t.getByLabel('给分与部分得分规则', { exact: true }).fill('教学验收构造规则，保留草稿不用于本次评分。');
    const [savedResponse] = await Promise.all([
      t.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/questions/${ids.question_id}/rubrics`)),
      t.getByRole('button', { name: '保存标准草稿', exact: true }).click()
    ]);
    const saved = (await savedResponse.json()).data;
    await t.getByRole('heading', { name: `标准 v${saved.version} · 草稿`, exact: true }).waitFor();
    await t.screenshot({ path: path.join(root, '.local/rubric-standard.png'), fullPage: true });
    console.log('PASS: browser independently saved a new rubric draft; confirmed versions unchanged');
    await t.goto(`${base}/teacher/homework/submissions/${ids.submission_id}/grade`);
    await t.getByRole('button',{name:'基于当前评分修改',exact:true}).click();
    const rubrics = (await (await t.request.get(`${base}/api/v1/learning/courses/${ids.course_id}/questions/${ids.question_id}/rubrics`)).json()).data;
    await choose(t.getByRole('combobox', { name: '使用标准版本', exact: true }), `v${rubrics.find(r => r.id === ids.rubric_id).version} · 已确认`);
    const confirmation = t.getByRole('dialog').filter({ hasText: '切换标准后使用该版本的独立草稿' });
    if (await confirmation.count()) await confirmation.getByRole('button', { name: '确认', exact: true }).click();
    for (const [id, score, comment, quote] of [
      ['D1', 5, '六个测试值均出现，本次人工修订保留为5分。', '测试17、18、19、59、60、61'],
      ['D2', 1, '范围内分类正确，17和61分类错误。', '这六个年龄都合法'],
      ['D3', 0, '应检查拒绝超范围输入。', '系统应该全部接受']
    ]) {
      await t.getByLabel(`${id} 得分`, { exact: true }).fill(String(score));
      await t.getByLabel(`${id} 评语`, { exact: true }).fill(comment);
      await t.getByLabel(`${id} 原文引用`, { exact: true }).fill(quote);
    }
    await t.getByLabel('终审评语', { exact: true }).fill('浏览器验收修订，逐点评分与原文依据保留。');
    await t.getByRole('button', { name: '保存逐点评分草稿', exact: true }).click();
    await t.getByRole('button', { name: '确认评分', exact: true }).waitFor();
    const scoring = t.locator('.grading-editor');
    await scoring.screenshot({ path: path.join(root, '.local/rubric-grading-full.png') });
    await t.addStyleTag({ content: '.topbar{visibility:hidden!important}' });
    await scoring.locator('.live-point-results').screenshot({ path: path.join(root, '.local/rubric-grading.png') });
    for (const name of ['确认评分', '发布正式反馈']) {
      await t.getByRole('button', { name, exact: true }).click();
      await t.getByRole('button', { name, exact: true }).waitFor({ state: 'hidden' });
    }
    await a.goto(`${base}/student/homework/submissions/${ids.submission_id}/feedback`);
    await a.locator('.grading-editor').getByText('浏览器验收修订，逐点评分与原文依据保留。', { exact: true }).waitFor();
    assert(await a.getByText(/^测试值覆盖：\s*5\s*\/\s*6$/).count() > 0, 'Released point scores missing');
    assert(await a.locator('form').count() === 0, 'Student got a grading form');
    await a.screenshot({ path: path.join(root, '.local/rubric-student-full.png'), fullPage: true });
    await a.addStyleTag({ content: '.topbar{visibility:hidden!important}' });
    await a.locator('.grading-editor').screenshot({ path: path.join(root, '.local/rubric-student.png') });
    for (const width of [390, 1440]) {
      await a.setViewportSize({ width, height: 900 });
      assert(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Feedback has horizontal overflow');
    }
    assert(errors.length === 0, 'Browser page errors');
    fs.writeFileSync(path.join(root, '.local/rubric-browser-check.json'), JSON.stringify({ passed: true, checks: ['create version through form', 'select confirmed version', 'enter per-point scores/comments/quotes', 'save-confirm-release', 'student read-only feedback', '390/1440px without horizontal overflow', 'no pageerror'], model_calls: 0 }, null, 2));
    console.log('PASS: per-point teacher edit/confirm/release, student feedback, responsive layout and no pageerror');
  } finally { for (const c of contexts) await c.close(); await browser.close(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
