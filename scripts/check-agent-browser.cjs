// Real local browser acceptance; all paid calls need the explicit CLI flag.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { choose, selectFile, selectRoot } = require('./browser-ui.cjs');
const root = path.resolve(__dirname, '..');
const base = process.env.HAJI_BASE_URL || 'http://127.0.0.1:18080';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw Error('Local acceptance only');
const real = process.argv.includes('--real-model');
const data = JSON.parse(fs.readFileSync(path.join(root, '.local/agent-acceptance.json'), 'utf8'));
const accounts = JSON.parse(fs.readFileSync(path.join(root, '.local/s1-accounts.json'), 'utf8')).accounts;
const folder = path.join(root, real ? '.local/agent-browser' : '.local/agent-browser-layout');
fs.mkdirSync(folder, { recursive: true });
const reportPath = path.join(folder, 'report.json');
if (fs.existsSync(reportPath)) fs.copyFileSync(reportPath, path.join(folder, `report-${Date.now()}.json`));
const report = { started_at: new Date().toISOString(), real_model: real, checks: [], errors: [], serverErrors: [], screenshots: [] };
const assert = (condition, message) => { if (!condition) throw Error(message); };
const pass = text => { report.checks.push(text); console.log('PASS', text); };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('response', r => { if (r.url().startsWith(base + '/api/') && r.status() >= 500) report.serverErrors.push(r.status() + ' ' + new URL(r.url()).pathname); });
    const account = accounts.find(a => a.username === 's1-teacher');
    await page.goto(base + '/login');
    await page.getByLabel('用户名', { exact: true }).fill(account.username);
    await page.getByLabel('密码', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(u => u.pathname === '/teacher/dashboard');
    await page.goto(base + '/teacher/assistant?course=' + data.course_id);
    const newConversation = page.locator('.agent-conversations > button').first();
    await newConversation.waitFor();
    await page.getByRole('combobox', { name: '对话模型', exact: true }).waitFor();
    await newConversation.click();
    await page.waitForURL(u => !!u.searchParams.get('conversation'));
    const conversation = new URL(page.url()).searchParams.get('conversation');
    report.conversation_id = conversation;
    const prefix = `/api/v1/learning/courses/${data.course_id}/agent/conversations/${conversation}`;
    async function snapshot() {
      return page.evaluate(async url => { const r = await fetch(url); if (!r.ok) throw Error('Snapshot ' + r.status); return (await r.json()).data; }, prefix);
    }
    for (const mode of ['只读', '完整操作', '自动审查']) {
      await page.waitForFunction(el => !el.disabled, await page.getByRole('combobox', { name: '权限模式', exact: true }).elementHandle());
      await choose(page.getByRole('combobox', { name: '权限模式', exact: true }), { label: mode });
      await page.waitForFunction(async ({ url, expected }) => (await (await fetch(url)).json()).data.conversation.mode === expected,
        { url: prefix, expected: { '只读': 'read-only', '完整操作': 'full-access', '自动审查': 'auto-review' }[mode] });
    }
    pass('Model/mode controls save to the owned conversation');
    if (real) {
      const filename = `agent-browser-${Date.now()}.txt`;
      const fixture = path.join(folder, filename);
      fs.writeFileSync(fixture, `浏览器闭环验收资料（${filename}）：边界值分析测试18到60区间的端点和相邻整数，越界输入用于检查系统拒绝行为。`, 'utf8');
      const prompt = '帮我导入附件并等待解析完成，不发布、不提炼。来源说明为“本地验收教师自编资料”，允许后续提炼。导入前请先用问题卡询问资料名称：字段key=title，标签为资料名称，text必填。回答后以该标题导入，完成后查询原文片段并报告实际原件ID。';
      await page.getByRole('textbox', { name: '消息', exact: true }).fill(prompt);
      await selectFile(page.getByRole('button', { name: '上传文件', exact: true }), fixture);
      await page.locator('.agent-composer .ant-tag').filter({ hasText: filename }).waitFor();
      assert(await page.getByRole('textbox', { name: '消息', exact: true }).inputValue() === prompt, 'Upload cleared message');
      await page.getByRole('textbox', { name: '消息', exact: true }).press('Control+Enter');
      await page.getByLabel('资料名称', { exact: true }).waitFor({ timeout: 180000 });
      const before = await snapshot();
      const request = before.requests.find(r => r.state === 'pending' && r.kind === 'input');
      assert(request, 'Missing durable input card');
      await page.reload();
      await page.getByLabel('资料名称', { exact: true }).waitFor();
      const after = await snapshot();
      assert(after.requests.some(r => r.id === request.id && r.state === 'pending'), 'Refresh replaced input request');
      await page.screenshot({ path: path.join(folder, 'input-card.png'), fullPage: true });
      report.screenshots.push('input-card.png');
      await page.getByLabel('资料名称', { exact: true }).fill('浏览器资料验收');
      await page.getByRole('button', { name: '提交回答', exact: true }).click();
      await page.getByRole('button', { name: '确认执行', exact: true }).waitFor({ timeout: 180000 });
      const approval = (await snapshot()).requests.find(r => r.state === 'pending' && r.kind === 'approval');
      assert(approval?.snapshot.tool === 'source_import', 'Unexpected operation approval');
      assert(approval.snapshot.arguments.source_note === '本地验收教师自编资料', 'Source provenance changed');
      await page.screenshot({ path: path.join(folder, 'approval.png'), fullPage: true });
      report.screenshots.push('approval.png');
      await page.getByRole('button', { name: '确认执行', exact: true }).click();
      let final;
      let previous = '';
      for (let n = 0; n < 240; n++) {
        final = await snapshot();
        const run = final.runs[0];
        if (run.state !== previous || n % 15 === 0) console.log('RUN', run.state, 'steps', final.steps.length);
        previous = run.state;
        assert(!['failed', 'unknown', 'canceled'].includes(run.state), run.error || 'Run interrupted');
        if (run.state === 'succeeded') break;
        assert(!['waiting_approval', 'waiting_input'].includes(run.state) || final.requests.every(r => r.state !== 'pending'), 'Unexpected extra user decision');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      assert(final.runs[0].state === 'succeeded', 'Browser run timeout');
      assert(final.requests.filter(r => r.kind === 'input').length === 1, 'The same question was repeated after a saved answer');
      const sources = await page.evaluate(async url => (await (await fetch(url)).json()).data,
        `/api/v1/learning/courses/${data.course_id}/sources`);
      const source = sources.find(s => s.filename === filename);
      assert(source?.parse_state === 'ready' && source.title === '浏览器资料验收', 'Browser import did not reach ready state');
      assert(final.steps.some(s => s.tool === 'source_read' && s.state === 'succeeded'), 'No original-text verification');
      report.source_id = source.id;
      pass('Upload + keyboard send + durable question + refresh + approval + real worker parse + original read');
      await page.reload();
      await page.locator('.agent-message-assistant').first().waitFor();
      await page.getByText(/^已处理的确认与补充/).first().click();
      assert(await page.getByLabel('资料名称', { exact: true }).inputValue() === '浏览器资料验收', 'Answered question lost its saved value after refresh');
      pass('Completed conversation and execution receipts survive refresh');
      await page.goto(base + '/teacher/assistant?course=' + data.course_id + '&conversation=' + data.materials_conversation);
      await page.getByText(/^已处理的确认与补充/).first().click();
      await page.getByRole('radio', { name: '允许', exact: true }).waitFor();
      assert(await page.getByRole('radio', { name: '允许', exact: true }).isChecked(), 'Saved single-choice answer was not rendered');
      pass('Single-choice question renders the persisted selected answer');
      await page.goto(base + '/teacher/assistant?course=' + data.course_id + '&conversation=' + conversation);
      await page.locator('.agent-message-assistant').first().waitFor();
    }
    await page.waitForFunction(el => !el.disabled, await page.getByRole('combobox', { name: '权限模式', exact: true }).elementHandle());
    await page.waitForFunction(el => !el.disabled, await page.getByRole('textbox', { name: '消息', exact: true }).elementHandle());
    await page.screenshot({ path: path.join(folder, 'desktop.png'), fullPage: true });
    report.screenshots.push('desktop.png');
    for (const width of [390, 375]) {
      await page.setViewportSize({ width, height: 844 });
      await page.locator('.sidebar').waitFor({ state: 'hidden' });
      await page.getByRole('textbox', { name: '消息', exact: true }).scrollIntoViewIfNeeded();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Page overflow ${width}`);
      assert(await page.getByRole('button', { name: '发送', exact: true }).isVisible(), 'Composer hidden on mobile');
      const box = await page.getByRole('textbox', { name: '消息', exact: true }).boundingBox();
      assert(box && box.x >= 0 && box.x + box.width <= width, `Composer clipped ${width}`);
    }
    await page.screenshot({ path: path.join(folder, 'mobile.png'), fullPage: true });
    report.screenshots.push('mobile.png');
    pass('Desktop and 390/375 mobile layouts; composer and controls remain available');
    const learner = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const studentPage = await learner.newPage();
    studentPage.on('pageerror', e => report.errors.push(e.message));
    studentPage.on('response', r => { if (r.url().startsWith(base + '/api/') && r.status() >= 500) report.serverErrors.push(r.status() + ' ' + new URL(r.url()).pathname); });
    const studentAccount = accounts.find(a => a.username === 's1-student-a');
    await studentPage.goto(base + '/login');
    await studentPage.getByLabel('用户名', { exact: true }).fill(studentAccount.username);
    await studentPage.getByLabel('密码', { exact: true }).fill(studentAccount.password);
    await studentPage.getByRole('button', { name: '登录', exact: true }).click();
    await studentPage.waitForURL(u => u.pathname === '/student/home');
    await studentPage.goto(base + '/student/assistant?course=' + data.course_id + '&conversation=' + data.student_conversation);
    await studentPage.locator('.agent-message-assistant').first().waitFor();
    assert(await studentPage.locator('.agent-message-assistant .rich-content').first().evaluate(el => getComputedStyle(el).whiteSpace) === 'normal', 'Markdown layout preserved structural whitespace');
    const studentMode = studentPage.getByRole('combobox', { name: '权限模式', exact: true });
    await selectRoot(studentMode).click();
    const options = studentPage.locator('.ant-select-dropdown:visible .ant-select-item-option-content');
    await options.first().waitFor();
    assert(await options.count() === 2 && await options.filter({ hasText: /^完整操作$/ }).count() === 0, 'Student received full-access mode');
    await studentMode.press('Escape');
    await studentPage.locator('.ant-select-dropdown:visible').waitFor({ state: 'hidden' });
    await studentPage.screenshot({ path: path.join(folder, 'student.png'), fullPage: true });
    report.screenshots.push('student.png');
    pass('Student assistant restores real cited answer and exposes only the two permitted modes');
    assert(!report.errors.length, report.errors.join('\n'));
    assert(!report.serverErrors.length, report.serverErrors.join('\n'));
    pass('No browser exceptions or HTTP 5xx');
  } catch (e) {
    report.failure = e.message;
    throw e;
  } finally {
    report.finished_at = new Date().toISOString();
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
