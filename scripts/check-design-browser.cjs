const { choose, selectedText } = require('./browser-ui.cjs');
// Local Docker UI acceptance. Uses real test accounts; never prints credentials.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:18080';
const output = path.join(root, '.local/design');
const fixtures = JSON.parse(fs.readFileSync(path.join(root, '.local/s1-accounts.json'), 'utf8'));
const watchdog = setTimeout(() => { console.error('HARD TIMEOUT: check-design-browser.cjs exceeded 180s'); process.exit(124); }, 180000);
watchdog.unref();
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

(async () => {
  fs.mkdirSync(output, {recursive: true});
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  const errors = [];
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    async function capture(name, fullPage = false) {
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, null, { timeout: 2000 }).catch(() => {});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: horizontal overflow`);
      await page.screenshot({path: path.join(output, name + '.png'), fullPage});
    }
    await page.goto(base + '/login');
    assert.equal(await page.getByRole('button', {name: '登录', exact: true}).count(), 1);
    await capture('login', true);
    for (const width of [390, 768]) {
      await page.setViewportSize({width, height: 844});
      await capture('login-' + width, true);
    }
    console.log('PASS: login accessible controls and 390/768/1440px layout');
    await page.setViewportSize({width: 1440, height: 1000});
    for (const role of ['teacher', 'student']) {
      const account = fixtures.accounts.find(a => a.username === (role === 'teacher' ? 's1-teacher' : 's1-student-a'));
      await page.goto(base + '/login');
      await page.getByLabel('用户名', {exact: true}).fill(account.username);
      await page.getByLabel('密码', {exact: true}).fill(account.password);
      await page.getByRole('button', {name: '登录', exact: true}).click();
      const home = role === 'teacher' ? 'dashboard' : 'home';
      await page.waitForURL(u=>u.pathname===`/${role}/${home}`);
      const courseSelect = page.getByRole('combobox', { name: '当前课程', exact: true });
      await courseSelect.waitFor();
      const courses = (await (await page.request.get(base + '/api/v1/me/courses')).json()).data;
      const course = courses.filter(c => /^浏览器验收 \d+$/.test(c.title)).sort((a,b)=>b.title.localeCompare(a.title))[0];
      assert.ok(course, 'Run check-platform-browser.cjs first to create a labeled example course');
      await choose(courseSelect, course.title);
      assert.equal(await page.locator('.live-shortcut p').count(), 0, 'Shortcut cards must not repeat feature instructions');
      assert.equal(await page.getByText(/维护知识目录|准备并审核学习资料|基于实际学习、提交|PREPARE|SUPPORT/).count(), 0, 'README-style interface copy returned');
      await capture(role + '-overview', true);
      const nav = page.getByRole('navigation', {name: role === 'teacher' ? '教师导航' : '学生导航', exact: true});
      assert.equal(await nav.getByRole('link').count(), role === 'teacher' ? 7 : 6, 'Sidebar must keep Studio top-level module links');
      await nav.getByRole('link', {name: role === 'teacher' ? '作业与批阅' : '作业与反馈', exact: true}).click();
      await page.waitForURL(u=>u.pathname===`/${role}/homework`);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'main-content', 'SPA navigation must focus main');
      await capture(role + '-assignments', true);
      const aliases = role === 'teacher' ? ['teacher-twin/drilldown', 'home'] : ['student-twin', 'insight', 'dashboard'];
      for (const alias of aliases) {
        await page.goto(`${base}/${role}/${alias}?student=design-check`);
        await page.waitForURL(u=>u.pathname===`/${role}/${home}` && u.searchParams.get("student")==="design-check");
      }
      if (role === 'teacher') {
        await page.goto(`${base}/teacher/insight?student=design-check`);
        await page.waitForURL(u=>u.pathname==='/teacher/insight' && u.searchParams.get("student")==="design-check");
      }
      await page.goto(`${base}/${role}/grading`);
      await page.waitForURL(u=>u.pathname===`/${role}/homework`);
      const courseRoute = role === 'teacher' ? 'curriculum' : 'course-content';
      await page.goto(`${base}/${role}/${role === 'teacher' ? 'course-content' : 'course-twin'}?node=design-check`);
      await page.waitForURL(u=>u.pathname===`/${role}/${courseRoute}` && u.searchParams.get("node")==="design-check");
      await page.goto(`${base}/${role}/${role === 'teacher' ? 'curriculum' : 'course-content'}`);
      await capture(role + '-course', true);
      await page.goto(`${base}/${role}/${home}`);
      await page.locator('main .live-page').waitFor();
      for (const width of [390, 768, 1024]) {
        await page.setViewportSize({width, height: 900});
        await capture(`${role}-${width}`);
      }
      await page.setViewportSize({width: 390, height: 844});
      const toggle = page.getByRole('button', {name: '打开导航', exact: true});
      await toggle.click();
      await page.locator('.mobile-nav-drawer').getByRole('link', {name: role === 'teacher' ? '课程管理' : '课程学习', exact: true}).waitFor({state: 'visible'});
      await capture(`${role}-390-menu`);
      await page.keyboard.press('Escape');
      await page.getByRole('button', {name: '打开导航', exact: true}).waitFor();
      await page.setViewportSize({width: 1440, height: 1000});
      if (role === 'teacher') {
        const editor = await context.newPage();
        editor.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
        editor.on('pageerror', error => errors.push(error.message));
        await editor.goto(`${base}/teacher/homework/new?course=${course.id}`);
        const due = editor.getByLabel('截止时间', {exact: true});
        await due.fill('2035-12-31 20:30');
        await editor.locator('.ant-picker-dropdown:visible').getByRole('button', {name: '确定', exact: true}).click();
        assert.equal(await due.inputValue(), '2035-12-31 20:30');
        await editor.reload();
        assert.equal(await due.inputValue(), '2035-12-31 20:30', 'Confirmed cutoff must survive browser draft recovery');
        await due.hover();
        await editor.locator('.ant-picker-clear').click();
        assert.equal(await due.inputValue(), '');
        await editor.reload();
        assert.equal(await due.inputValue(), '', 'Clearing the cutoff must also update the recovered draft');
        await editor.close();
        console.log('PASS: Ant cutoff picker confirms, recovers and clears; no assignment was created');
        await page.goto(base + '/teacher/profile');
        await page.route('**/api/v1/learning/profile', route => route.fulfill({
          status: 422, contentType: 'application/json',
          body: JSON.stringify({error: {code: 'test_profile_rejected', message: '测试：资料保存被拒绝'}}),
        }));
        const nameInput = page.getByLabel('显示姓名', {exact: true});
        await nameInput.fill((await nameInput.inputValue()) + '（测试）');
        await page.getByRole('button', {name: '保存资料', exact: true}).click();
        await page.locator('.ant-alert-error').getByText('测试：资料保存被拒绝', {exact: true}).waitFor();
        assert.equal(await page.locator('.ant-alert-success').count(), 0, 'A rejected save must not appear as success');
        await page.unroute('**/api/v1/learning/profile');
        await capture('teacher-profile-error');
        console.log('PASS: rejected profile save renders an error; no profile data was changed');
      }
      await page.getByRole('button', {name: '退出登录', exact: true}).click();
      await page.waitForURL(base + '/login');
      console.log(`PASS: ${role} grouped navigation, keyboard focus, aliases, screenshots and responsive layout`);
    }
    assert.deepEqual(errors, [], 'Unexpected browser exceptions');
    console.log('PASS: design acceptance; screenshots in .local/design');
  } finally { await withTimeout(browser.close(), 5000).catch(() => {}); }
})().catch(error => {
  let message = (error && error.stack) || error.message;
  for (const account of fixtures.accounts) message = message.replaceAll(account.password, '[redacted]');
  console.error(message);
  process.exitCode = 1;
}).finally(() => { clearTimeout(watchdog); process.exit(process.exitCode || 0); });
