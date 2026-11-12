const { choose, selectedText, optionCount } = require('./browser-ui.cjs');
// Local Docker regression: navigation boundaries, course context and preserved teaching actions.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:18080';
const fixtures = JSON.parse(fs.readFileSync(path.join(root, '.local/s1-accounts.json'), 'utf8'));
const out = path.join(root, '.local/navigation');
const checks = [], errors = [], serverErrors = [];

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    async function login(username, role) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', r => { if (r.url().startsWith(base + '/api/') && r.status() >= 500) serverErrors.push(r.status() + ' ' + new URL(r.url()).pathname); });
      const a = fixtures.accounts.find(a => a.username === username);
      await page.goto(base + '/login');
      await page.getByLabel('用户名', { exact: true }).fill(a.username);
      await page.getByLabel('密码', { exact: true }).fill(a.password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.waitForURL(u => u.pathname === `/${role}/${role === 'teacher' ? 'dashboard' : 'home'}`);
      await page.getByRole('combobox', { name: '当前课程', exact: true }).waitFor();
      return page;
    }
    function pass(text) { checks.push(text); console.log('PASS: ' + text); }
    const t = await login('s1-teacher', 'teacher');
    const me = (await (await t.request.get(base + '/api/v1/me')).json()).data;
    async function post(route, data) {
      const r = await t.request.post(base + '/api/v1' + route, { data, headers: { Origin: base, 'X-CSRF-Token': me.csrf_token } });
      assert(r.ok(), `${route}: ${r.status()}`);
      return (await r.json()).data;
    }
    const title = '路由验收 ' + Date.now();
    await t.goto(base + '/teacher/courses');
    await t.getByLabel('新课程名称', { exact: true }).fill(title);
    await t.getByRole('button', { name: '新建课程', exact: true }).click();
    await t.waitForURL(u => u.pathname === '/teacher/courses' && u.searchParams.has('course'));
    await t.getByLabel('课程名称', { exact: true }).waitFor();
    assert.equal(await t.getByLabel('课程名称', { exact: true }).inputValue(), title);
    const course = new URL(t.url()).searchParams.get('course');
    const prefix = `/learning/courses/${course}`;
    const other = await post('/learning/courses', { title: title + ' 另一课程' });
    await t.getByRole('tab', { name: '课程成员', exact: true }).click();
    await t.getByLabel('学生用户名', { exact: true }).fill('s1-student-a');
    await t.getByRole('button', { name: '加入课程', exact: true }).click();
    await t.locator('.member-list li').filter({ hasText: 's1-student-a' }).waitFor();
    assert.equal(await t.getByLabel('课程名称', { exact: true }).count(), 0);
    await t.getByRole('tab', { name: '课程设置', exact: true }).click();
    await t.getByRole('button', { name: '发布课程', exact: true }).click();
    await t.getByRole('button', { name: '发布课程', exact: true }).waitFor({ state: 'hidden' });
    await t.goto(`${base}/teacher/curriculum?course=${course}`);
    await choose(t.getByRole('combobox', { name: '目录类型', exact: true }), 'point');
    await t.getByLabel('节点名称', { exact: true }).fill('边界值分析');
    await t.getByRole('button', { name: '添加节点', exact: true }).click();
    await t.locator('.ant-tree').getByText('边界值分析', { exact: true }).waitFor();
    assert.equal(await t.getByRole('button', { name: '新增资料', exact: true }).count(), 0);
    assert.equal(await t.getByLabel('学生用户名', { exact: true }).count(), 0);
    pass('课程创建/成员/发布与目录节点维护分属独立页面，写入后仍可读取');

    await t.goto(`${base}/teacher/materials?course=${course}&tab=published`);
    assert.equal(await t.locator('.ant-tree').count(), 0);
    await t.getByRole('button', { name: '新增资料', exact: true }).click();
    await t.getByLabel('资料标题', { exact: true }).fill('路由验收资料');
    const materialText = '测试应覆盖端点及其两侧相邻值。\n\n## 核查要点\n\n**边界测试**\n\n| 类型 | 输入 |\n| --- | --- |\n| 端点 | 18 |\n\n$x^2$';
    await t.getByLabel('资料原文', { exact: true }).fill(materialText);
    await t.getByLabel('来源说明', { exact: true }).fill('自动化验收自编资料');
    await choose(t.getByRole('combobox', { name: '关联知识点', exact: true }), { label: '边界值分析' });
    await t.getByRole('button', { name: '保存资料草稿', exact: true }).click();
    const row = t.locator('.live-row').filter({ has: t.getByRole('heading', { name: '路由验收资料', exact: true }) });
    await row.getByRole('button', { name: '审核通过并发布', exact: true }).click();
    await row.getByRole('button', { name: '审核通过并发布', exact: true }).waitFor({ state: 'hidden' });
    const resources = (await (await t.request.get(base + '/api/v1' + prefix + '/resources')).json()).data;
    const resource = resources.find(r => r.title === '路由验收资料');
    assert.equal(resource.content, materialText, 'Rendering must not rewrite the saved source');
    await t.goto(`${base}/teacher/course-twin?course=${course}&resource=${resource.id}`);
    await t.waitForURL(u => u.pathname === '/teacher/materials' && u.searchParams.get('tab') === 'published');
    await t.getByText('测试应覆盖端点及其两侧相邻值。', { exact: true }).waitFor();
    await t.locator('.rich-content h2').getByText('核查要点', { exact: true }).waitFor();
    assert.equal(await t.locator('.rich-content strong').getByText('边界测试', { exact: true }).count(), 1);
    assert.equal(await t.locator('.rich-content table td').getByText('18', { exact: true }).count(), 1);
    assert.equal(await t.locator('.rich-content .katex').count(), 1);
    assert(!(await t.locator('.rich-content').innerText()).includes('**边界测试**'));
    pass('资料正文渲染标题、粗体、表格与公式，服务端原文保持不变');
    await t.goto(`${base}/teacher/course-twin?course=${course}&tab=members`);
    await t.waitForURL(u => u.pathname === '/teacher/courses');
    await t.getByLabel('学生用户名', { exact: true }).waitFor();
    await t.goto(`${base}/teacher/course-content?course=${course}&node=legacy-node`);
    await t.waitForURL(u => u.pathname === '/teacher/curriculum' && u.searchParams.get('node') === 'legacy-node');
    pass('资料创建/发布功能保留，旧资料/成员/目录链接定位正确');

    for (const route of ['curriculum', 'materials', 'knowledge', 'question-bank', 'homework/foreign-object/submissions']) {
      await t.goto(`${base}/teacher/${route}?course=${course}&source=old&resource=old&task=old&bank=old&page=4`);
      await t.locator('main .live-page').first().waitFor();
      await t.waitForLoadState('networkidle');
      const closeDrawer = t.locator('.ant-drawer:visible .ant-drawer-close');
      if (await closeDrawer.count()) {
        await closeDrawer.click();
        await t.locator('.ant-drawer:visible').waitFor({ state: 'hidden' });
      }
      await choose(t.getByRole('combobox', { name: '当前课程', exact: true }), other.title);
      const target = route.startsWith('homework/') ? 'homework' : route;
      await t.waitForURL(u => u.pathname === `/teacher/${target}` && u.searchParams.get('course') === other.id);
      assert.deepEqual([...new URL(t.url()).searchParams.keys()], ['course']);
      await t.locator('.workspace-course-select .ant-select-selection-item').getByText(other.title + '（草稿）', { exact: true }).waitFor();
      assert.equal(await selectedText(t.getByRole('combobox', { name: '当前课程', exact: true })), other.title + "（草稿）");
    }
    pass('切换课程留在同一模块、清除旧对象与筛选，作业详情返回新课程列表');
    await t.goto(`${base}/teacher/materials?course=${course}&tab=published`);
    await t.getByRole('button', { name: '新增资料', exact: true }).click();
    await t.getByLabel('资料标题', { exact: true }).fill('未保存的资料标题');
    // The drawer covers the topbar: close it (retaining the draft), then switch course.
    await t.locator('.ant-drawer-close').click();
    await t.getByRole('button', { name: '确认', exact: true }).click();
    await t.getByRole('dialog').waitFor({ state: 'hidden' });
    await choose(t.getByRole('combobox', { name: '当前课程', exact: true }), other.title);
    await t.getByRole('button', { name: '继续编辑', exact: true }).click();
    assert.equal(new URL(t.url()).searchParams.get('course'), course);
    assert.equal(await selectedText(t.getByRole('combobox', { name: '当前课程', exact: true })), title);
    await t.getByRole('button', { name: '新增资料', exact: true }).click();
    assert.equal(await t.getByLabel('资料标题', { exact: true }).inputValue(), '未保存的资料标题');
    await t.getByLabel('资料标题', { exact: true }).fill('');
    await t.locator('.ant-drawer-close').click();
    pass('取消课程切换保持课程选择和未保存资料，编辑内容未串课');
    await t.goto(`${base}/teacher/materials?course=00000000-0000-0000-0000-000000000000`);
    await t.getByText('无法访问该课程', { exact: true }).waitFor();
    await choose(t.getByRole('combobox', { name: '当前课程', exact: true }), title);
    await t.getByRole('tab', { name: '原始资料', exact: true }).waitFor();
    assert(!await t.locator('body').innerText().then(s => s.includes('联调记账')));
    await t.goto(`${base}/teacher/profile?course=${course}`);
    assert.equal(await t.getByRole('combobox', { name: '当前课程', exact: true }).count(), 0);
    pass('无权限课程显式提示且可恢复，个人设置无课程选择，教学页面无联调账目');

    const idsFile = path.join(root, '.local/material-workflows-check.json');
    if (fs.existsSync(idsFile)) {
      const ids = JSON.parse(fs.readFileSync(idsFile, 'utf8'));
      const paper = ids.sources['paper.pdf'].source;
      await t.goto(`${base}/teacher/materials?course=${ids.course_id}&source=${paper.id}`);
      const sourceDrawer = t.getByRole('dialog', { name: '资料核对与发布', exact: true });
      await sourceDrawer.getByRole('link', { name: '到题库拆分试卷', exact: true }).click();
      const paperDrawer = t.getByRole('dialog', { name: '整卷导入', exact: true });
      await paperDrawer.locator('.ant-collapse-header').filter({ hasText: /^整卷拆题$/ }).waitFor();
      assert.equal(await selectedText(paperDrawer.getByRole('combobox', { name: '试卷原件', exact: true })), paper.title);
      await t.reload();
      await paperDrawer.locator('.ant-collapse-header').filter({ hasText: /^整卷拆题$/ }).click();
      await paperDrawer.getByRole('button', { name: '载入候选', exact: true }).click();
      const questionList = paperDrawer.getByRole('combobox', { name: '题目', exact: true });
      await questionList.waitFor();
      assert.equal(await optionCount(questionList), 3);
      const prompt = paperDrawer.getByLabel('题干', { exact: true });
      await prompt.fill((await prompt.inputValue()) + '\n前端拆题编辑核对');
      await t.reload();
      await paperDrawer.locator('.ant-collapse-header').filter({ hasText: /^整卷拆题$/ }).click();
      await t.waitForFunction(() => document.querySelector('[aria-label="题干"]')?.value.includes('前端拆题编辑核对'));
      pass('资料到题库保留试卷来源，真实三题型候选可载入、编辑并在刷新后恢复');
    }
    for (const [route, heading] of [['courses', '课程管理'], ['curriculum', '课程目录'], ['materials', '学习资料'], ['question-bank', '题库']]) {
      await t.goto(`${base}/teacher/${route}?course=${course}`);
      await t.locator('main .live-page').waitFor();
      assert.equal(await t.locator('main > .live-page > h1, main .live-heading h1').count(), 0);
      for (const width of [1440, 390]) {
        await t.setViewportSize({ width, height: 1000 });
        await t.waitForLoadState('networkidle');
        await t.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
        assert.equal(await t.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${route}/${width} overflow`);
        assert.equal(await t.getByRole('combobox', { name: '当前课程', exact: true }).count(), 1);
        await t.screenshot({ path: path.join(out, `${route}-${width}.png`), fullPage: true });
      }
    }
    pass('四个主要管理页在1440/390px无横向溢出，顶部仅一处课程切换');
    const a = await login('s1-student-a', 'student');
    await a.goto(`${base}/student/course-content?course=${course}`);
    await a.locator('.ant-tree').getByText('边界值分析', { exact: true }).waitFor();
    await a.getByRole('button', { name: '打开资料', exact: true }).click();
    await a.getByLabel('我的笔记', { exact: true }).fill('路由分区后笔记仍可保存');
    await a.getByRole('button', { name: '保存笔记与收藏', exact: true }).click();
    await a.getByText('已同步', { exact: true }).waitFor();
    await a.getByRole('button', { name: '标记完成', exact: true }).click();
    await a.reload();
    assert.equal(await a.getByLabel('我的笔记', { exact: true }).inputValue(), '路由分区后笔记仍可保存');
    await a.locator('main').getByRole('link', { name: '资料问答', exact: true }).waitFor();
    pass('学生目录、资料阅读、笔记持久化、完成记录和问答入口保留');
    assert.deepEqual(errors, [], 'Browser exceptions');
    assert.deepEqual(serverErrors, [], 'API 5xx');
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ passed: true, course_id: course, checks, model_calls: 0, production_changed: false }, null, 2));
  } catch (e) {
    for (const [i, c] of browser.contexts().entries()) {
      const page = c.pages()[0];
      if (page) await page.screenshot({ path: path.join(out, `failure-${i}.png`), fullPage: true }).catch(() => {});
    }
    throw e;
  } finally { await browser.close(); }
})().catch(e => {
  let message = e.stack;
  for (const a of fixtures.accounts) message = message.replaceAll(a.password, '[redacted]');
  console.error(message); process.exitCode = 1;
});
