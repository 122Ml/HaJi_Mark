// Playwright MCP browser_run_code_unsafe filename entry. Restores local demo storage.
// Run against the locally built Docker web service, not the remote reference site.
async (page) => {
  const context = page.context();
  const test = await context.newPage();
  const errors = [];
  test.on('pageerror', error => errors.push(String(error)));
  const base = 'http://127.0.0.1:18080';
  const routes = ['login', 'student/home', 'student/course-content', 'student/learning', 'student/student-twin', 'student/homework', 'student/homework/7bcfeeef0a1e4363a7a348d9c42e85cc', 'student/intervention', 'student/intervention/showcase_pkg_zyh', 'student/interaction', 'student/profile', 'student/quiz', 'teacher/dashboard', 'teacher/course-twin', 'teacher/homework', 'teacher/homework/new', 'teacher/homework/7bcfeeef0a1e4363a7a348d9c42e85cc/edit', 'teacher/homework/7bcfeeef0a1e4363a7a348d9c42e85cc/submissions', 'teacher/homework/submissions/sub-clean/grade', 'teacher/intervention', 'teacher/intervention/showcase_pkg_zyh', 'teacher/interaction', 'teacher/research', 'teacher/industry-intelligence', 'teacher/quiz', 'teacher/teacher-twin/drilldown'];
  const goto = async route => { await test.goto(`${base}/${route}`); await test.locator('h1,h2,h3').first().waitFor({ state: 'visible' }); };
  const click = async locator => { await locator.evaluate(element => element.click()); };
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const results = [];
  await test.goto(`${base}/login`);
  const saved = await test.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('haji-demo:'))));
  await test.evaluate(() => { Object.keys(localStorage).filter(key => key.startsWith('haji-demo:')).forEach(key => localStorage.removeItem(key)); });
  try {
    await test.bringToFront();
    for (const width of [1440, 390]) {
      await test.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const route of routes) {
        await goto(route);
        const overflow = await test.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert(!overflow, `${route} overflows at ${width}px`);
      }
      results.push({ width, routes: routes.length, overflow: false });
    }
    await test.setViewportSize({ width: 1440, height: 1000 });
    await goto('teacher/homework/new');
    await test.getByLabel('作业标题', { exact: true }).fill('浏览器验收作业');
    await test.getByLabel('题目标题', { exact: true }).fill('数据质量');
    await test.getByLabel('题目要求', { exact: true }).fill('说明数据完整性和准确性的核查方法。');
    await click(test.getByRole('button', { name: '保存草稿', exact: true }));
    await goto('student/homework');
    assert(await test.getByText('浏览器验收作业', { exact: true }).count() === 0, 'Draft leaked to student');
    await goto('teacher/homework');
    await click(test.locator('tr').filter({ hasText: '浏览器验收作业' }).getByRole('button', { name: '发布', exact: true }));
    await goto('student/homework');
    await click(test.locator('.student-homework-v2-card').filter({ hasText: '浏览器验收作业' }).getByRole('button', { name: '快速作答' }));
    await test.getByPlaceholder('请输入答案，草稿自动保存在本机浏览器').fill('检查缺失字段验证完整性，对照原始数据验证准确性。');
    await click(test.getByRole('button', { name: '提交作业', exact: true }));
    const assignment = new URL(test.url()).pathname.split('/').pop();
    await goto(`teacher/homework/${assignment}/submissions`);
    await click(test.getByRole('link', { name: '批改详情', exact: true }));
    await test.getByLabel('终审分数', { exact: true }).fill('88');
    await test.getByLabel('终审评语', { exact: true }).fill('方法完整，请补充证据记录。');
    await click(test.getByRole('button', { name: '保存终审结果', exact: true }));
    await click(test.getByRole('button', { name: '确认并发布', exact: true }));
    await goto(`student/homework/${assignment}`);
    await click(test.getByRole('button', { name: '结果', exact: true }));
    assert((await test.locator('main').innerText()).includes('88'), 'Released score missing');
    assert((await test.locator('main').innerText()).includes('方法完整，请补充证据记录。'), 'Released feedback missing');
    results.push({ assignment: 'draft-hidden → publish → submit → teacher-confirm → student-feedback', passed: true });

    await goto('teacher/intervention');
    await click(test.getByRole('button', { name: '识别薄弱点', exact: true }));
    await click(test.getByRole('button', { name: '生成任务包', exact: true }));
    await click(test.getByRole('button', { name: '确认并推送任务包', exact: true }));
    await click(test.getByRole('button', { name: '确认推送', exact: true }));
    await goto('student/intervention');
    await click(test.locator('tr').filter({ hasText: '数据采集流程补学任务' }).getByRole('link', { name: '进入作答' }));
    await click(test.getByRole('button', { name: '接受并开始', exact: true }));
    await test.getByPlaceholder('请输入本题答案').fill('记录数据源、采集批次、清洗规则和质量核查结果。');
    await click(test.getByRole('button', { name: '提交任务包', exact: true }));
    const pack = new URL(test.url()).pathname.split('/').pop();
    await goto(`teacher/intervention/${pack}`);
    await test.getByLabel('复查意见', { exact: true }).fill('复查通过。');
    await click(test.getByRole('button', { name: '确认复查完成', exact: true }));
    assert((await test.locator('main').innerText()).includes('已复查'), 'Task review missing');
    results.push({ intervention: 'draft → push → accept → answer → review', passed: true });

    await goto('teacher/interaction');
    const form = test.locator('form').first();
    await form.getByLabel('公告标题').fill('浏览器验收公告');
    await form.getByLabel('公告内容').fill('请查看作业反馈。');
    await click(form.getByRole('button', { name: '发布公告', exact: true }));
    await goto('student/interaction');
    await click(test.getByText('浏览器验收公告', { exact: true }));
    assert((await test.getByRole('dialog').innerText()).includes('请查看作业反馈。'), 'Announcement missing');
    results.push({ announcement: 'teacher publish → student detail', passed: true });

    await goto('teacher/quiz');
    await click(test.getByRole('button', { name: 'AI 一键出题', exact: true }));
    await test.getByLabel('出题主题', { exact: true }).fill('质量验收');
    await click(test.getByRole('button', { name: '生成示例草稿', exact: true }));
    await click(test.getByRole('button', { name: '保存草稿', exact: true }));
    await click(test.locator('tr').filter({ hasText: '质量验收测验' }).getByRole('button', { name: '发布', exact: true }));
    await goto('student/quiz');
    await click(test.getByRole('link', { name: '质量验收测验' }));
    await click(test.getByRole('radio').first());
    await click(test.getByRole('button', { name: '提交测验', exact: true }));
    assert((await test.locator('main').innerText()).includes('100 / 100'), 'Quiz result missing');
    results.push({ quiz: 'sample draft → publish → student answer → result', passed: true });
    assert(errors.length === 0, errors.join('\n'));
    return { results, runtimeErrors: errors, restoresDemoStorage: true };
  } finally {
    await test.evaluate(saved => { Object.keys(localStorage).filter(key => key.startsWith('haji-demo:')).forEach(key => localStorage.removeItem(key)); Object.entries(saved).forEach(([key, value]) => localStorage.setItem(key, value)); }, saved);
    await test.close();
  }
}
