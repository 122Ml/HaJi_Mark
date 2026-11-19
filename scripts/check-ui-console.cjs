// Local UI self-check: real routes, semantic tags, role actions and responsive layout.
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:18080';
const fixtures = JSON.parse(fs.readFileSync(path.join(root, '.local/s1-accounts.json'), 'utf8'));
const materialFile = path.join(root, '.local/material-workflows-check.json');
const materialCourse = (fs.existsSync(materialFile) ? JSON.parse(fs.readFileSync(materialFile, 'utf8')) : {}).course_id || '';
const output = path.join(root, '.local/ui-audit');
const pages = {
  teacher: ['dashboard', 'assistant', 'courses', 'curriculum', 'materials', 'knowledge', 'question-bank', 'retrieval', 'content-impact', 'regrades', 'intervention', 'homework', 'quiz', 'interaction', 'research', 'industry-intelligence', 'profile'],
  student: ['home', 'assistant', 'learning', 'course-content', 'knowledge', 'retrieval', 'homework', 'quiz', 'intervention', 'interaction', 'profile'],
};
const watchdog = setTimeout(() => { console.error('HARD TIMEOUT: check-ui-console.cjs exceeded 180s'); process.exit(124); }, 180000);
watchdog.unref();
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
(async () => {
  fs.mkdirSync(output, {recursive: true});
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  const problems = [];
  const checked = [];
  const controls = [];
  async function inspectUI(page, label) {
    const snapshot = await page.locator('main, .ant-drawer-content, .ant-modal-content').evaluateAll(roots => {
      const all = selector => [...new Set(roots.flatMap(root => [...root.querySelectorAll(selector)]))];
      const native = all('button, select, input, textarea, details, summary, table, form').filter(el => !el.closest('.rich-content'));
      // ConfigProvider's .ant-app is NOT evidence that a child is an Ant control.
      const component = '.ant-btn, .ant-input, .ant-input-affix-wrapper, .ant-input-group-wrapper, .ant-input-number, .ant-select, .ant-picker, .ant-radio, .ant-checkbox, .ant-switch, .ant-tabs, .ant-menu, .ant-pagination, .ant-upload, .ant-table, .ant-tree, .ant-segmented, .ant-drawer-close, .ant-modal-close';
      const covered = el => el.matches('form') ? el.matches('.ant-form') : !!el.closest(component);
      return {
        total: native.length,
        reused: native.filter(covered).length,
        uncovered: native.filter(el => !covered(el)).map(el => el.outerHTML.slice(0, 160)),
        headings: all('h2,h3,h4,h5,h6').filter(el => !el.closest('.rich-content')).map(el => el.textContent),
        readmeCopy: roots.some(root => /使用题库确认版本，题目与标准固定|本作业绑定题库确认版本及标准|确认后的版本可用于评分|修改题干或保存新的知识关联|联调记账/.test(root.innerText)),
      };
    });
    controls.push({page: label, total: snapshot.total, reused: snapshot.reused});
    if(snapshot.uncovered.length) problems.push(`${label}: native controls ${snapshot.uncovered.join(',')}`);
    if(snapshot.headings.length) problems.push(`${label}: secondary headings ${snapshot.headings.join(',')}`);
    if(snapshot.readmeCopy) problems.push(`${label}: README-style copy returned`);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) problems.push(`${label}: horizontal overflow`);
  }
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
      const activeMaterialCourse = materialCourse || teachingCourse.id;
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({width, height: 900});
        for (const p of pages[role]) {
          const useMaterials = ['materials', 'knowledge', 'question-bank', 'retrieval', 'content-impact', 'regrades'].includes(p);
          await page.goto(`${base}/${role}/${p}?course=${useMaterials ? activeMaterialCourse : teachingCourse.id}`);
          await page.waitForLoadState('networkidle');
          await page.locator('main .live-page, main .agent-workspace').first().waitFor({timeout: 10000}).catch(() => problems.push(`${role}/${p}@${width}: missing page content`));
          if (await page.locator('main .live-heading h1, main > .live-page > h1').count()) problems.push(`${role}/${p}@${width}: redundant page heading`);
          await inspectUI(page, `${role}/${p}@${width}`);
          if(await page.locator('main .workspace-course-select').count()) problems.push(`${role}/${p}@${width}: duplicate course selection`);
          const slotSelector = width >= 960 ? '.lab-workspace #current-course' : '.topbar #current-course';
          const courseSelectors = await page.locator(slotSelector).count();
          const totalSelectors = await page.locator('#current-course').count();
          if(courseSelectors !== (p === 'profile' ? 0 : 1) || totalSelectors !== courseSelectors) problems.push(`${role}/${p}@${width}: course selection count ${courseSelectors}/${totalSelectors}`);
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
      if (role === 'teacher') for (const width of [390, 1440]) {
        await page.setViewportSize({width, height: 1000});
        for (const [route, button] of [['materials', '导入资料'], ['knowledge', '新建知识'], ['question-bank', '新建题目'], ['question-bank', '整卷导入'], ['intervention', '新建补学补练任务']]) {
          await page.goto(`${base}/teacher/${route}?course=${activeMaterialCourse}`);
          await page.getByRole('button', {name: button, exact: true}).click();
          await page.waitForLoadState('networkidle');
          await inspectUI(page, `${button}@${width}`);
          await page.screenshot({path: path.join(output, `editor-${route}-${button}-${width}.png`), fullPage: false});
          checked.push(`${button}@${width}`);
        }
        for (const route of ['homework/new', 'quiz/new']) {
          await page.goto(`${base}/teacher/${route}?course=${activeMaterialCourse}`);
          await page.getByLabel(route.startsWith('quiz') ? '测验标题' : '作业标题', {exact: true}).waitFor();
          await inspectUI(page, `${route}@${width}`);
          checked.push(`${route}@${width}`);
        }
        console.log(`CHECKED: seven editors at ${width}px; no writes or model calls`);
      }
      await context.close();
    }
  } finally { await withTimeout(browser.close(), 5000).catch(() => {}); }
  const total = controls.reduce((n, row) => n + row.total, 0), reused = controls.reduce((n, row) => n + row.reused, 0);
  const widgets = {total, reused, reusePercent: total ? reused / total * 100 : 0};
  if (widgets.reusePercent < 99) problems.push('Rendered Ant Design widget reuse is below 99%');
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({checked, widgets, controls, problems}, null, 2));
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
  else console.log(`PASS: ${Object.values(pages).flat().length} routes × 3 widths; ${reused}/${total} Ant controls; no secondary headings, README copy, console errors or overflow`);
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => { clearTimeout(watchdog); process.exit(process.exitCode || 0); });
