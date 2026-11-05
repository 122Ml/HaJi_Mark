const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const base = process.env.HAJI_BASE_URL || 'http://127.0.0.1:18080';
if (!['http://127.0.0.1:18080', 'https://hajistudy.online'].includes(base)) throw Error('Unexpected test target');
const fixtures = JSON.parse(fs.readFileSync(process.env.HAJI_ACCOUNTS || path.join(root, '.local/s1-accounts.json'), 'utf8'));
const ids = JSON.parse(fs.readFileSync(process.env.HAJI_CHECK_IDS || path.join(root, '.local/platform-check.json'), 'utf8'));
const account = fixtures.accounts.find(a => a.username === (process.env.HAJI_TEACHER_USER || 's1-teacher'));
const assert = (value, message) => { if (!value) throw Error(message); };
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  let release = () => {};
  try {
    const page = await context.newPage();
    await page.goto(base + '/login');
    await page.getByLabel('用户名', { exact: true }).fill(account.username);
    await page.getByLabel('密码', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(u=>u.pathname==='/teacher/dashboard');
    await page.getByLabel('当前课程', { exact: true }).selectOption(ids.course_id);
    const url = `${base}/api/v1/learning/courses/${ids.course_id}/evidence`;
    const result = await context.request.get(url);
    assert(result.ok(), 'Evidence request failed');
    const rows = (await result.json()).data;
    assert(rows.length > 0, 'Use a fixture course with released grading evidence');
    let started;
    const pending = new Promise(resolve => { started = resolve; });
    await page.route(url, async route => {
      started();
      await new Promise(resolve => { release = resolve; });
      await route.continue();
    });
    await page.reload();
    await pending;
    const button = page.getByRole('button', { name: '导出当前正式结果', exact: true });
    assert(await button.count()===0 || await button.isDisabled(), 'Export must be unavailable while evidence response is pending');
    await Promise.all([page.waitForResponse(url), Promise.resolve().then(release)]);
    await button.click({ trial: true });
    const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const csv = Buffer.concat(chunks).toString('utf8');
    assert(rows.every(r => csv.includes(r.submission_id)), 'CSV must retain all loaded submission IDs');
    await page.unroute(url);
    await page.route(url, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'service_unavailable', message: '导出验收：证据读取失败' } }) }));
    await page.reload();
    await page.getByRole('alert').filter({ hasText: '导出验收：证据读取失败' }).waitFor();
    assert(await button.count()===0 || await button.isDisabled(), 'Export must be unavailable when evidence loading fails');
    console.log('PASS: delayed evidence blocks export; loaded CSV preserves records; failed reads block export');
  } finally {
    release();
    const me = await context.request.get(base + '/api/v1/me');
    if (me.ok()) await context.request.delete(base + '/api/v1/sessions/current', { headers: { 'X-CSRF-Token': (await me.json()).data.csrf_token } });
    await browser.close();
  }
})().catch(error => { console.error(error.message.replaceAll(account.password, '[redacted]')); process.exitCode = 1; });
