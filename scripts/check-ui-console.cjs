// Local UI self-check: console errors, failed/404 resources, horizontal overflow at 390/768px.
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:18080';
const fixtures = JSON.parse(fs.readFileSync(path.join(root, '.local/s1-accounts.json'), 'utf8'));
const pages = {
  teacher: ['dashboard', 'courses', 'curriculum', 'materials', 'knowledge', 'question-bank', 'retrieval', 'content-impact', 'regrades', 'intervention', 'homework', 'quiz', 'interaction', 'research', 'industry-intelligence', 'profile'],
  student: ['home', 'learning', 'course-content', 'homework', 'quiz', 'intervention', 'interaction', 'profile'],
};
(async () => {
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  const problems = [];
  try {
    for (const role of ['teacher', 'student']) {
      const context = await browser.newContext({viewport: {width: 1440, height: 900}});
      const page = await context.newPage();
      page.on('console', m => { if (m.type() === 'error' && !/status of 401/.test(m.text())) problems.push(`${role} console: ${m.text()}`); });
      page.on('pageerror', e => problems.push(`${role} pageerror: ${e.message}`));
      page.on('response', r => { if (r.status() >= 400 && !r.url().includes('/api/')) problems.push(`${role} ${r.status()} ${r.url()}`); });
      const account = fixtures.accounts.find(a => a.username === (role === 'teacher' ? 's1-teacher' : 's1-student-a'));
      await page.goto(base + '/login');
      await page.getByLabel('用户名', {exact: true}).fill(account.username);
      await page.getByLabel('密码', {exact: true}).fill(account.password);
      await page.getByRole('button', {name: '登录', exact: true}).click();
      await page.waitForURL(new RegExp(`/${role}/`));
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({width, height: 900});
        for (const p of pages[role]) {
          await page.goto(`${base}/${role}/${p}`);
          await page.waitForLoadState('networkidle');
          await page.locator('main .live-page').first().waitFor({timeout: 10000}).catch(() => problems.push(`${role}/${p}@${width}: missing page content`));
          if (await page.locator('main .live-heading h1, main > .live-page > h1').count()) problems.push(`${role}/${p}@${width}: redundant page heading`);
          const native = await page.locator('main').evaluate(main => [...main.querySelectorAll('button, select, input, textarea, details')].filter(el => !el.closest('[class*="ant-"]')).map(el => el.tagName));
          if(native.length) problems.push(`${role}/${p}@${width}: native controls ${native.join(',')}`);
          if(await page.locator('main .workspace-course-select').count()) problems.push(`${role}/${p}@${width}: duplicate course selection`);
          const courseSelectors = await page.locator('.topbar #current-course').count();
          if(courseSelectors !== (p === 'profile' ? 0 : 1)) problems.push(`${role}/${p}@${width}: topbar course selection count ${courseSelectors}`);
          if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) problems.push(`${role}/${p}@${width}: horizontal overflow`);
        }
      }
      await context.close();
    }
  } finally { await browser.close(); }
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
  else console.log('PASS: no console errors, no failed static resources, no horizontal overflow at 390/768/1440px');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
