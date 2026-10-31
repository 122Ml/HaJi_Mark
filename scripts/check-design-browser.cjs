// Local Docker UI acceptance. Uses real test accounts; never prints credentials.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:18080';
const output = path.join(root, '.local/design');
const fixtures = JSON.parse(fs.readFileSync(path.join(root, '.local/s1-accounts.json'), 'utf8'));

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
      await page.waitForURL(`${base}/${role}/${home}`);
      const courseSelect = page.getByLabel('当前课程', {exact: true});
      await courseSelect.waitFor();
      const courseID = await courseSelect.locator('option').evaluateAll(options => options.filter(o => /^浏览器验收 \d+$/.test(o.textContent)).sort((a, b) => b.textContent.localeCompare(a.textContent))[0]?.value);
      assert.ok(courseID, 'Run check-platform-browser.cjs first to create a labeled example course');
      await courseSelect.selectOption(courseID);
      assert.equal(await page.locator('.live-shortcut p').count(), 0, 'Shortcut cards must not repeat feature instructions');
      assert.equal(await page.getByText(/维护知识目录|准备并审核学习资料|基于实际学习、提交|PREPARE|SUPPORT/).count(), 0, 'README-style interface copy returned');
      await capture(role + '-overview', true);
      const nav = page.getByRole('navigation', {name: role === 'teacher' ? '教师导航' : '学生导航', exact: true});
      assert.equal(await nav.getByRole('group').count(), 5, 'Sidebar must keep four business groups plus account');
      await nav.getByRole('link', {name: role === 'teacher' ? '作业中心' : '作业', exact: true}).click();
      await page.waitForURL(`${base}/${role}/homework`);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'main-content', 'SPA navigation must focus main');
      await capture(role + '-assignments', true);
      const aliases = role === 'teacher' ? ['teacher-twin/drilldown', 'insight', 'home'] : ['student-twin', 'insight', 'dashboard'];
      for (const alias of aliases) {
        await page.goto(`${base}/${role}/${alias}?student=design-check`);
        await page.waitForURL(`${base}/${role}/${home}?student=design-check`);
      }
      await page.goto(`${base}/${role}/grading`);
      await page.waitForURL(`${base}/${role}/homework`);
      const course = role === 'teacher' ? 'course-twin' : 'course-content';
      await page.goto(`${base}/${role}/${role === 'teacher' ? 'course-content' : 'course-twin'}?node=design-check`);
      await page.waitForURL(`${base}/${role}/${course}?node=design-check`);
      await page.goto(`${base}/${role}/${role === 'teacher' ? 'course-twin' : 'course-content'}`);
      await capture(role + '-course', true);
      await page.goto(`${base}/${role}/${home}`);
      await page.getByRole('heading', {level: 1}).waitFor();
      for (const width of [390, 768, 1024]) {
        await page.setViewportSize({width, height: 900});
        await capture(`${role}-${width}`);
      }
      await page.setViewportSize({width: 390, height: 844});
      const toggle = page.getByRole('button', {name: '打开导航', exact: true});
      await toggle.click();
      await nav.getByRole('link', {name: role === 'teacher' ? '课程与资料' : '课程学习', exact: true}).waitFor({state: 'visible'});
      await capture(`${role}-390-menu`);
      await page.keyboard.press('Escape');
      await page.getByRole('button', {name: '打开导航', exact: true}).waitFor();
      await page.setViewportSize({width: 1440, height: 1000});
      await page.getByRole('button', {name: '退出登录', exact: true}).click();
      await page.waitForURL(base + '/login');
      console.log(`PASS: ${role} grouped navigation, keyboard focus, aliases, screenshots and responsive layout`);
    }
    assert.deepEqual(errors, [], 'Unexpected browser exceptions');
    console.log('PASS: design acceptance; screenshots in .local/design');
  } finally { await browser.close(); }
})().catch(error => {
  let message = error.message;
  for (const account of fixtures.accounts) message = message.replaceAll(account.password, '[redacted]');
  console.error(message);
  process.exitCode = 1;
});
