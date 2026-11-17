// Local regression against Docker; message POSTs are intercepted, so no model calls are made.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { selectFile } = require('./browser-ui.cjs');
const root = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:18080';
const data = JSON.parse(fs.readFileSync(path.join(root, '.local/agent-acceptance.json'), 'utf8'));
const accounts = JSON.parse(fs.readFileSync(path.join(root, '.local/s1-accounts.json'), 'utf8')).accounts;
const folder = path.join(root, '.local/agent-polish');
fs.mkdirSync(folder, { recursive: true });
const reportPath = path.join(folder, 'report.json');
if (fs.existsSync(reportPath)) fs.copyFileSync(reportPath, path.join(folder, `report-${Date.now()}.json`));
const report = { started_at: new Date().toISOString(), real_model: false, checks: [], errors: [], serverErrors: [], screenshots: [] };
const pass = text => { report.checks.push(text); console.log('PASS', text); };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('dialog', d => { if (d.type() === 'beforeunload') void d.accept(); else void d.dismiss(); });
    const submissions = [];
    await page.route('**/api/v1/learning/courses/*/agent/conversations/*/messages', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      submissions.push(route.request().postDataJSON());
      await route.fulfill({ status: 503, contentType: 'application/json', headers: { 'X-Haji-Test': 'message-failure' },
        body: JSON.stringify({ error: { code: 'test_failure', message: '验收模拟发送失败，未调用模型' } }) });
    });
    page.on('response', r => {
      if (r.url().startsWith(base + '/api/') && r.status() >= 500 && !r.headers()['x-haji-test']) report.serverErrors.push(r.status() + ' ' + new URL(r.url()).pathname);
    });
    const composer = page.getByRole('textbox', { name: '消息', exact: true });
    const send = page.getByRole('button', { name: '发送', exact: true });
    const newConversation = page.locator('.agent-conversations > button').first();
    const conversationURL = (id, course = data.course_id, role = 'teacher') => `${base}/${role}/assistant?course=${course}${id ? '&conversation=' + id : ''}`;
    const prefix = `/api/v1/learning/courses/${data.course_id}/agent`;
    const read = async url => {
      const response = await page.request.get(base + url);
      assert(response.ok(), `${url}: ${response.status()}`);
      return (await response.json()).data;
    };
    const enabled = async locator => page.waitForFunction(el => !el.disabled, await locator.elementHandle());
    async function login(username, role) {
      const a = accounts.find(a => a.username === username);
      assert(a, 'Missing local acceptance account');
      await page.goto(base + '/login');
      await page.getByLabel('用户名', { exact: true }).fill(a.username);
      await page.getByLabel('密码', { exact: true }).fill(a.password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.waitForURL(u => u.pathname === `/${role}/${role === 'teacher' ? 'dashboard' : 'home'}`);
    }
    async function createConversation() {
      const previous = new URL(page.url()).searchParams.get('conversation');
      await enabled(newConversation);
      await newConversation.click();
      await page.waitForURL(u => !!u.searchParams.get('conversation') && u.searchParams.get('conversation') !== previous);
      await enabled(composer);
      return new URL(page.url()).searchParams.get('conversation');
    }
    async function selectConversation(id) {
      await page.locator(`[data-conversation-id="${id}"]`).click();
      await page.waitForURL(u => u.searchParams.get('conversation') === id);
      await enabled(composer);
    }
    async function screenshot(name) {
      await page.screenshot({ path: path.join(folder, name), fullPage: true });
      report.screenshots.push(name);
    }
    await login('s1-teacher', 'teacher');
    await page.goto(conversationURL());
    const first = await createConversation();
    const firstText = '待发送：请导入这份自编资料，先核对来源。';
    await composer.fill(firstText);
    const filename = `draft-${Date.now()}.txt`;
    const fixture = path.join(folder, filename);
    const fixtureContent = '草稿恢复验收文件：仅上传到私有会话，不执行导入和模型处理。';
    fs.writeFileSync(fixture, fixtureContent);
    await selectFile(page.getByRole('button', { name: '上传文件', exact: true }), fixture);
    await page.locator('.agent-composer .ant-tag').filter({ hasText: filename }).waitFor();
    assert.equal(await composer.inputValue(), firstText, 'Upload erased draft');
    const attachment = (await read(`${prefix}/conversations/${first}`)).attachments.find(a => a.filename === filename);
    assert(attachment, 'Private attachment not persisted');
    const fileURL = `${prefix}/conversations/${first}/attachments/${attachment.id}/file`;
    const download = await page.request.get(base + fileURL);
    assert.equal(await download.text(), fixtureContent, 'Private upload download changed content');
    const second = await createConversation();
    report.draft_conversations = [first, second];
    assert.equal(await composer.inputValue(), '', 'New conversation copied another draft');
    await composer.fill('另一份独立草稿');
    await selectConversation(first);
    assert.equal(await composer.inputValue(), firstText, 'Switch lost text');
    await page.locator('.agent-composer .ant-tag').filter({ hasText: filename }).waitFor();
    await page.reload();
    await enabled(composer);
    assert.equal(await composer.inputValue(), firstText, 'Refresh lost text');
    await page.locator('.agent-composer .ant-tag').filter({ hasText: filename }).waitFor();
    await selectConversation(second);
    assert.equal(await composer.inputValue(), '另一份独立草稿', 'Drafts mixed between conversations');
    await composer.fill('汉'.repeat(4001));
    assert(await send.isDisabled(), 'Over 12000 UTF-8 bytes was sendable');
    await page.getByRole('alert').filter({ hasText: '消息超过12000字节' }).waitFor();
    await composer.fill('另一份独立草稿');
    await enabled(send);
    pass('Private file upload/download; text and attachments survive switching and refresh; UTF-8 limit');

    await selectConversation(first);
    await send.click();
    await page.getByText('验收模拟发送失败，未调用模型', { exact: true }).first().waitFor();
    await enabled(send);
    assert.equal(await composer.inputValue(), firstText, 'Failed send erased draft');
    assert.equal(submissions.length, 1);
    await page.reload();
    await enabled(send);
    await send.click();
    await page.getByText('验收模拟发送失败，未调用模型', { exact: true }).first().waitFor();
    await enabled(send);
    assert.equal(submissions.length, 2);
    assert.equal(submissions[0].request_id, submissions[1].request_id, 'Refresh retry changed idempotency key');
    assert.deepEqual(submissions[0].attachment_ids, submissions[1].attachment_ids, 'Retry lost attachments');
    const empty = await read(`${prefix}/conversations/${first}`);
    assert.equal(empty.runs.length, 0, 'Message interception unexpectedly launched a real run');
    await screenshot('draft-recovery.png');
    pass('Failed send preserves draft/attachment; retry after refresh reuses request_id; zero real model calls');

    const courses = await read('/api/v1/me/courses');
    const other = courses.find(c => c.id !== data.course_id);
    assert(other, 'Need existing second owned course for scope isolation');
    await page.goto(conversationURL('', other.id));
    await enabled(composer);
    assert.equal(await composer.inputValue(), '', 'Draft leaked across course');
    await page.goto(conversationURL(first));
    await enabled(composer);
    assert.equal(await composer.inputValue(), firstText, 'Original course draft not restored');
    const me = await read('/api/v1/me');
    const logout = await page.request.delete(base + '/api/v1/sessions/current', { headers: { Origin: base, 'X-CSRF-Token': me.csrf_token } });
    assert(logout.ok(), 'Logout failed');
    await login('s1-student-a', 'student');
    await page.goto(conversationURL(data.student_conversation, data.course_id, 'student'));
    await enabled(composer);
    assert.equal(await composer.inputValue(), '', 'Teacher draft leaked to student');
    const denied = await page.request.get(base + fileURL);
    assert([403, 404].includes(denied.status()), 'Private teacher attachment exposed to student');
    pass('Drafts remain isolated by course/account; teacher private attachment denied to student');

    await page.locator('.agent-message-assistant').first().waitFor();
    const history = await read(`${prefix}/conversations/${data.student_conversation}`);
    assert(history.runs.length >= 2, 'Need persisted multi-turn acceptance conversation');
    for (const run of history.runs.filter(r => r.state === 'succeeded')) {
      const surrounded = await page.locator(`[data-run-id="${run.id}"]`).evaluate(el => {
        const children = Array.from(el.parentElement.children);
        const i = children.indexOf(el);
        return i > 0 && children[i - 1].classList.contains('agent-message-user') && children[i + 1]?.classList.contains('agent-message-assistant');
      });
      assert(surrounded, 'Execution card is not between its user message and assistant response');
    }
    pass('Persisted multi-turn history displays user → execution → assistant in actual order');

    await page.context().clearCookies();
    await login('s1-teacher', 'teacher');
    await page.goto(conversationURL(data.materials_conversation));
    const completed = page.getByText(/^已处理的确认与补充/).first();
    await completed.waitFor();
    assert.equal(await page.getByRole('radio', { name: '允许', exact: true }).count(), 0, 'Completed cards were not folded');
    await completed.click();
    assert(await page.getByRole('radio', { name: '允许', exact: true }).isChecked(), 'Persisted answer missing from folded history');
    await page.goto(conversationURL(data.assessment_conversation));
    const exports = page.locator('.agent-exports');
    await exports.waitFor();
    const [csv] = await Promise.all([page.waitForEvent('download'), exports.getByRole('link', { name: '下载', exact: true }).first().click()]);
    const csvPath = path.join(folder, csv.suggestedFilename());
    await csv.saveAs(csvPath);
    assert(fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean).length > 1, 'Export is empty');
    await screenshot('receipts-and-export.png');
    pass('Answered cards stay folded and retain values; authorized CSV downloads directly from file list');

    for (const width of [390, 375, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await composer.scrollIntoViewIfNeeded();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Page overflow ${width}`);
      const box = await composer.boundingBox();
      assert(box && box.x >= 0 && box.x + box.width <= width + 1, `Composer clipped ${width}`);
      assert(await send.isVisible(), `Send unavailable at ${width}`);
      if (width === 375) await screenshot('mobile.png');
    }
    await page.goto(conversationURL('not-an-owned-conversation'));
    await page.getByRole('alert').filter({ hasText: /不存在|权限|访问/ }).first().waitFor();
    assert(await send.isDisabled(), 'Send enabled for inaccessible conversation');
    assert(await composer.isDisabled(), 'Composer enabled for inaccessible conversation');
    assert.equal(report.errors.length, 0, report.errors.join('\n'));
    assert.equal(report.serverErrors.length, 0, report.serverErrors.join('\n'));
    pass('375/390/1440 layouts and inaccessible conversation controls; no browser exceptions or unexpected 5xx');
  } catch (e) {
    report.failure = e.message;
    throw e;
  } finally {
    report.finished_at = new Date().toISOString();
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
