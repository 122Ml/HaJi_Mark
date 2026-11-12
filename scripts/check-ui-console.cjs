// Local UI self-check: real routes, semantic tags, role actions and responsive layout.
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:18080';
const fixtures = JSON.parse(fs.readFileSync(path.join(root, '.local/s1-accounts.json'), 'utf8'));
const materialCourse = JSON.parse(fs.readFileSync(path.join(root, '.local/material-workflows-check.json'), 'utf8')).course_id;
const output = path.join(root, '.local/ui-audit');
const pages = {
  teacher: ['dashboard', 'courses', 'curriculum', 'materials', 'knowledge', 'question-bank', 'retrieval', 'content-impact', 'regrades', 'intervention', 'homework', 'quiz', 'interaction', 'research', 'industry-intelligence', 'profile'],
  student: ['home', 'learning', 'course-content', 'knowledge', 'retrieval', 'homework', 'quiz', 'intervention', 'interaction', 'profile'],
};
(async () => {
  fs.mkdirSync(output, {recursive: true});
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  const problems = [];
  const checked = [];
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
      const courses = (await (await page.request.get(base + '/api/v1/me/courses')).json()).data;
      const teachingCourse = courses.filter(c => /^浏览器验收 \d+$/.test(c.title)).sort((a,b) => b.title.localeCompare(a.title))[0];
      if (!teachingCourse) throw Error('Run check-platform-browser.cjs first to create the teaching fixture');
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({width, height: 900});
        for (const p of pages[role]) {
          const useMaterials = ['materials', 'knowledge', 'question-bank', 'retrieval', 'content-impact', 'regrades'].includes(p);
          await page.goto(`${base}/${role}/${p}?course=${useMaterials ? materialCourse : teachingCourse.id}`);
          await page.waitForLoadState('networkidle');
          await page.locator('main .live-page').first().waitFor({timeout: 10000}).catch(() => problems.push(`${role}/${p}@${width}: missing page content`));
          if (await page.locator('main .live-heading h1, main > .live-page > h1').count()) problems.push(`${role}/${p}@${width}: redundant page heading`);
          const native = await page.locator('main').evaluate(main => [...main.querySelectorAll('button, select, input, textarea, details')].filter(el => !el.closest('[class*="ant-"]')).map(el => el.tagName));
          if(native.length) problems.push(`${role}/${p}@${width}: native controls ${native.join(',')}`);
          if(await page.locator('main .workspace-course-select').count()) problems.push(`${role}/${p}@${width}: duplicate course selection`);
          const courseSelectors = await page.locator('.topbar #current-course').count();
          if(courseSelectors !== (p === 'profile' ? 0 : 1)) problems.push(`${role}/${p}@${width}: topbar course selection count ${courseSelectors}`);
          if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) problems.push(`${role}/${p}@${width}: horizontal overflow`);
          const leaked = await page.locator('main').evaluate(main => {
            const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
              if (/^\s*teacher\s*&&\s*\(\s*$/.test(node.textContent)) return true;
            }
            return false;
          });
          if (leaked) problems.push(`${role}/${p}@${width}: JSX condition rendered as text`);
          if (['homework', 'quiz', 'intervention'].includes(p)) {
            const createLabel = p === 'homework' ? '新建作业' : p === 'quiz' ? '新建测验' : '新建补学补练任务';
            if (await page.getByRole(p === 'intervention' ? 'button' : 'link', {name: createLabel, exact: true}).count() !== (role === 'teacher' ? 1 : 0)) problems.push(`${role}/${p}@${width}: incorrect create action visibility`);
          }
          if (p === 'courses') {
            const rows = page.locator('.live-row').filter({has: page.getByRole('button', {name: /当前课程|管理课程/})});
            for (const row of await rows.all()) {
              if (await row.locator('.ui-status-tag').count() !== 1 || await row.locator('.ui-meta-tag').filter({hasText: /\d+\s*个知识点/}).count() !== 1) problems.push(`courses@${width}: status/count must be separate Ant tags`);
            }
          }
          const overflowingTags = await page.locator('main .ui-meta-tags').evaluateAll(groups => groups.filter(group => {
            if (!group.getClientRects().length) return false;
            const bounds = group.getBoundingClientRect();
            return [...group.children].some(child => child.getBoundingClientRect().right > bounds.right + 1);
          }).length);
          if (overflowingTags) problems.push(`${role}/${p}@${width}: metadata tags overflow their group`);
          if (width !== 768 && ['dashboard','courses','materials','knowledge','question-bank','homework','home','course-content'].includes(p)) await page.screenshot({path: path.join(output, `${role}-${p}-${width}.png`), fullPage: true});
          checked.push(`${role}/${p}@${width}`);
        }
        console.log(`CHECKED: ${role}, ${pages[role].length} routes at ${width}px`);
      }
      await context.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({checked, problems}, null, 2));
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
  else console.log('PASS: 26 routes × 3 widths; semantic tags, role actions, no leaked JSX, no console errors or overflow');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
