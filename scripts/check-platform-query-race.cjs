// Hold a pre-write list snapshot until after saving; exercise the real query/mutation boundary.
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const {selectedText} = require('./browser-ui.cjs');
const root = path.resolve(__dirname, '..');
const base = process.env.HAJI_BASE_URL || 'http://127.0.0.1:18080';
if (!['http://127.0.0.1:18080', 'https://hajistudy.online'].includes(base)) throw new Error('Unexpected test target');
const fixtures = JSON.parse(fs.readFileSync(process.env.HAJI_ACCOUNTS || path.join(root, '.local/s1-accounts.json'), 'utf8'));
const watchdog = setTimeout(() => { console.error('Timed out after 90s'); process.exit(124); }, 90000);
watchdog.unref();
(async () => {
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  const context = await browser.newContext();
  let releaseSnapshot;
  try {
    const page = await context.newPage();
    const account = fixtures.accounts.find(a => a.username === 's1-teacher');
    await page.goto(base + '/login');
    await page.getByLabel('用户名', {exact: true}).fill(account.username);
    await page.getByLabel('密码', {exact: true}).fill(account.password);
    await page.getByRole('button', {name: '登录', exact: true}).click();
    await page.waitForURL(base + '/teacher/dashboard');
    const me = (await (await context.request.get(base + '/api/v1/me')).json()).data;
    const response = await context.request.post(base + '/api/v1/learning/courses', {
      headers: {'X-CSRF-Token': me.csrf_token, Origin: base},
      data: {title: '并发刷新回归 ' + Date.now()},
    });
    if (!response.ok()) throw new Error('Could not create isolated regression course');
    const course = (await response.json()).data;
    await page.evaluate(({id, user}) => sessionStorage.setItem(`haji-course:${user}`, id), {id: course.id, user: me.user.id});
    for (const industry of [false, true]) {
      const endpoint = `/api/v1/learning/courses/${course.id}/${industry ? 'industry' : 'research'}`;
      const gate = new Promise(resolve => {releaseSnapshot = resolve});
      let snapshotReady;
      const ready = new Promise(resolve => {snapshotReady = resolve});
      let held = false;
      await page.route('**' + endpoint, async route => {
        if (route.request().method() !== 'GET' || held) return route.continue();
        held = true;
        const snapshot = await route.fetch();
        console.log(`SNAPSHOT ${snapshot.status()} ${endpoint}`);
        snapshotReady();
        await gate;
        await route.fulfill({response: snapshot}).catch(() => {}); // Cancellation is expected after the fix.
      });
      await page.goto(base + (industry ? '/teacher/industry-intelligence' : '/teacher/research'));
      await ready;
      const title = industry ? '并发岗位回归' : '并发教研回归';
      await page.getByLabel('标题', {exact: true}).fill(title);
      if (industry) {
        await page.getByLabel('原始来源链接', {exact: true}).fill('https://example.org/query-race');
        await page.getByLabel('技能要求', {exact: true}).fill('并发刷新回归记录');
      } else await page.getByLabel('教研内容', {exact: true}).fill('首次读取尚未结束时保存记录');
      const saved = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === 'POST');
      await page.getByRole('button', {name: '保存记录', exact: true}).click();
      if (!(await saved).ok()) throw new Error('Record write failed');
      await page.getByRole('status').filter({hasText: '已保存'}).waitFor();
      const chosen = await selectedText(page.getByRole('combobox', {name: '当前课程', exact: true}));
      if (chosen !== course.title && chosen !== `${course.title}（草稿）`) throw new Error(`Course changed during save: ${chosen}`);
      const storedCourse = await page.evaluate(user => sessionStorage.getItem(`haji-course:${user}`), me.user.id);
      if (storedCourse !== course.id) throw new Error('Course changed during save');
      releaseSnapshot();
      await page.getByText(title, { exact: true }).waitFor({timeout: 8000});
      await page.reload();
      await page.getByText(title, { exact: true }).waitFor();
      await page.unroute('**' + endpoint);
      console.log(`PASS: ${industry ? 'industry' : 'research'} saved record survives pre-write snapshot and reload`);
    }
  } finally {
    releaseSnapshot?.();
    const response = await context.request.get(base + '/api/v1/me').catch(() => null);
    if (response && response.ok()) await context.request.delete(base + '/api/v1/sessions/current', {headers: {'X-CSRF-Token': (await response.json()).data.csrf_token}}).catch(() => {});
    await Promise.race([browser.close().catch(() => {}), new Promise(r => setTimeout(r, 5000))]);
  }
})().catch(error => {console.error(error.message); process.exitCode = 1}).finally(() => process.exit(process.exitCode || 0));
