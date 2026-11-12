// Local-only acceptance: real database writes remain in a labelled test course.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:18080';
const accounts = JSON.parse(fs.readFileSync(path.join(root, '.local/s1-accounts.json'), 'utf8')).accounts;
const assert = (ok, message) => { if (!ok) throw Error(message); };
const checks = [];
function pass(message) { checks.push(message); console.log('PASS:', message); }
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const contexts = [], errors = [];
  let teacher, student;
  try {
    async function login(username, role) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); contexts.push(context);
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      page.setDefaultTimeout(12000);
      await page.goto(base + '/login');
      await page.getByLabel('用户名', { exact: true }).fill(username);
      await page.getByLabel('密码', { exact: true }).fill(accounts.find(a => a.username === username).password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.waitForURL(u => u.pathname === `/${role}/${role === 'teacher' ? 'dashboard' : 'home'}`);
      const me = (await (await page.request.get(base + '/api/v1/me')).json()).data;
      async function call(method, url, data, status = 200) {
        const response = await page.request.fetch(base + '/api/v1' + url, { method, data, headers: { Origin: base, 'X-CSRF-Token': me.csrf_token } });
        assert(response.status() === status, `${method} ${url}: expected ${status}, got ${response.status()}`);
        return (await response.json()).data;
      }
      return { page, call, me };
    }
    teacher = await login('s1-teacher', 'teacher'); student = await login('s1-student-a', 'student');
    const otherStudent = await login('s1-student-b', 'student'), otherTeacher = await login('s1-teacher-other', 'teacher');
    const { page: t, call: tc } = teacher, { page: a, call: ac } = student;
    const course = await tc('POST', '/learning/courses', { title: '交互验收 ' + Date.now() });
    const prefix = '/learning/courses/' + course.id;
    for (const username of ['s1-student-a', 's1-student-b']) await tc('POST', prefix + '/members', { username });
    await tc('POST', prefix + '/publish', {});
    const point = await tc('POST', prefix + '/points', { title: '边界测试', position: 0 });
    const resource = await tc('POST', prefix + '/resources', { title: '交互验收资料', content: '范围内外输入应分别测试，核对系统接受和拒绝行为。', locator: '第1段', source_note: '自动验收构造资料', knowledge_point_id: point.id });
    await tc('POST', prefix + '/resources/' + resource.id + '/publish', {});
    const assignment = await tc('POST', prefix + '/assignments', { title: '交互验收两题作业', type: 'subjective', description: '仅用于本地回归', questions: [1, 2].map(n => ({ prompt: `第${n}题：说明边界测试`, max_score: 10, rubric: '选值与解释各5分', knowledge_point_id: point.id, resource_id: resource.id })) });
    const questions = (await tc('GET', prefix + '/assignments/' + assignment.id)).questions;
    await tc('POST', prefix + '/assignments/' + assignment.id + '/state', { state: 'published' });
    const rubric = await tc('POST', prefix + '/questions/' + questions[0].id + '/rubrics', { criteria: [{ id: 'D1', title: '选值', max_score: 5, rule: '明确列出测试值' }, { id: 'D2', title: '解释', max_score: 5, rule: '说明预期行为' }] });
    await tc('POST', prefix + '/rubrics/' + rubric.id + '/confirm', {});
    const submissions = [];
    for (let i = 0; i < 21; i++) submissions.push(await ac('POST', prefix + '/assignments/' + assignment.id + '/submissions', { question_id: questions[0].id, answer_text: `测试17、18、60、61。\n第${i + 1}次原文😀，应拒绝范围外输入。`, request_id: crypto.randomUUID() }));
    const url = (role, route, extra = '') => `${base}/${role}/${route}?course=${course.id}${extra}`;
    const queuePath = prefix + '/assignments/' + assignment.id + '/worklist';
    const first = await tc('GET', queuePath + '?size=20'), second = await tc('GET', queuePath + '?size=20&page=2');
    assert(first.rows.length === 20 && second.rows.length === 1 && second.total === 21, 'Incorrect queue pagination');
    assert((await tc('GET', queuePath + '?page=999')).total === 21, 'Out-of-range page lost total');
    await tc('GET', queuePath + '?size=101', undefined, 422);
    await ac('GET', queuePath, undefined, 403); await otherTeacher.call('GET', queuePath, undefined, 403);
    assert((await ac('GET', prefix + '/assignment-worklist')).rows[0].submitted_count === 1, 'Personal progress counts attempts instead of questions');
    assert((await otherStudent.call('GET', prefix + '/assignment-worklist')).rows[0].submitted_count === 0, 'Personal progress leaked');
    const codeWork = await tc('POST', prefix + '/assignments', {title:'代码题列表回归',type:'code',questions:[{prompt:'编写边界检查函数',max_score:10,rubric:'检查上下界'}]});
    assert((await tc('GET',prefix+'/assignment-worklist?kind=homework')).rows.some(r=>r.id===codeWork.id), 'Code assignment disappeared from homework');
    assert(!(await ac('GET',prefix+'/assignment-worklist?kind=homework')).rows.some(r=>r.id===codeWork.id), 'Draft code assignment leaked');
    pass('服务端分页、越界页总数、参数校验、教师权限和个人进度隔离');

    await t.goto(url('teacher', 'homework', '&search=' + encodeURIComponent('交互验收两题作业') + '&state=published'));
    await t.getByRole('link', { name: '查看提交', exact: true }).click();
    await t.getByRole('link', { name: '批改详情', exact: true }).first().waitFor();
    assert(!new URL(t.url()).searchParams.has('state'), 'Assignment status polluted review queue');
    await t.getByRole('link', { name: '‹ 返回作业列表', exact: true }).click();
    await t.waitForURL(u => u.pathname === '/teacher/homework' && u.searchParams.get('search') === '交互验收两题作业' && u.searchParams.get('state') === 'published');
    pass('作业筛选与批阅队列独立，返回恢复原列表筛选');

    await t.goto(url('teacher', `homework/submissions/${submissions[0].id}/grade`));
    await t.getByLabel('D1 得分', { exact: true }).fill('4');
    await t.getByLabel('D1 评语', { exact: true }).fill('选值基本完整');
    await t.getByLabel('D2 得分', { exact: true }).fill('5');
    await t.getByLabel('D2 评语', { exact: true }).fill('拒绝行为说明明确');
    await t.getByLabel('终审评语', { exact: true }).fill('交互验收评分');
    await t.locator('.original-answer').evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    await t.getByRole('button', { name: '引用选中文本', exact: true }).click();
    assert((await t.getByLabel('D1 原文引用', { exact: true }).inputValue()).includes('😀'), 'Selected Unicode quote was not copied');
    await t.getByRole('button', { name: '保存逐点评分草稿', exact: true }).click();
    await t.getByRole('button', { name: '确认评分', exact: true }).waitFor();
    await t.getByRole('button', { name: '定位原文', exact: true }).click();
    await t.locator('.original-answer mark').waitFor();
    for (const name of ['确认评分', '发布正式反馈']) { await t.getByRole('button', { name, exact: true }).click(); await t.getByRole('button', { name, exact: true }).waitFor({ state: 'hidden' }); }
    await t.getByRole('button', { name: '基于当前评分修改', exact: true }).click();
    assert(await t.getByLabel('D1 得分', { exact: true }).inputValue() === '4', 'Copy did not retain current points');
    assert(await t.getByLabel('终审评语', { exact: true }).inputValue() === '交互验收评分', 'Copy lost feedback');
    await t.getByLabel('终审评语', { exact: true }).fill('待恢复的评分修改');
    await t.getByRole('button', { name: '退出登录', exact: true }).click();
    await t.getByText('还有未保存的内容，确认退出？', { exact: true }).waitFor();
    await t.getByRole('button', { name: '继续编辑', exact: true }).click();
    await t.getByText('还有未保存的内容，确认退出？', { exact: true }).waitFor({ state: 'hidden' });
    const anotherCourse = await t.getByLabel('当前课程', { exact: true }).locator('option').evaluateAll((options, id) => options.find(o => o.value && o.value !== id)?.value, course.id);
    if (anotherCourse) {
      await t.getByLabel('当前课程', { exact: true }).selectOption(anotherCourse);
      await t.getByRole('button', { name: '继续编辑', exact: true }).click();
      assert(new URL(t.url()).searchParams.get('course') === course.id, 'Cancelled switch changed course URL');
      assert(await t.evaluate(id => sessionStorage.getItem('haji-course:' + id), teacher.me.user.id) === course.id, 'Cancelled switch changed remembered course');
    }
    await t.getByRole('button', { name: '下一份', exact: true }).click();
    await t.getByRole('dialog').getByText('还有未保存的内容', { exact: true }).waitFor();
    await t.getByRole('button', { name: '继续编辑', exact: true }).click();
    assert(t.url().includes(submissions[0].id), 'Cancel did not retain current submission');
    await t.getByRole('button', { name: '下一份', exact: true }).click();
    await t.getByRole('button', { name: '离开页面', exact: true }).click();
    await t.waitForURL(u => u.pathname.includes(submissions[1].id));
    await t.getByRole('button', { name: '上一份', exact: true }).click();
    await t.getByRole('button', { name: '基于当前评分修改', exact: true }).click();
    await t.getByText('已恢复上次未保存的编辑。', { exact: true }).waitFor();
    assert(await t.getByLabel('终审评语', { exact: true }).inputValue() === '待恢复的评分修改', 'Recovery lost edits');
    await t.getByRole('button', { name: '保存逐点评分草稿', exact: true }).click();
    await t.getByRole('button', { name: '确认评分', exact: true }).waitFor();
    await t.screenshot({ path: path.join(root, '.local/workspace-grading.png'), fullPage: true });
    pass('逐点引用与定位、复制当前评分、离页保护、编辑恢复、保存确认发布');
    for (let i = 1; i <= 10; i++) { await t.getByRole('button', { name: '下一份', exact: true }).click(); await t.waitForURL(u => u.pathname.includes(submissions[i].id)); }
    await t.goto(url('teacher', `homework/submissions/${submissions[19].id}/grade`));
    await t.getByRole('button', { name: '下一份', exact: true }).click();
    await t.waitForURL(u => u.pathname.includes(submissions[20].id) && u.searchParams.get('page') === '2');
    await t.getByRole('button', { name: '上一份', exact: true }).click();
    await t.waitForURL(u => u.pathname.includes(submissions[19].id) && u.searchParams.get('page') === '1');
    pass('连续查看十份作答、跨20条分页往返、URL保持课程与队列');

    await a.goto(url('student', `homework/${assignment.id}`));
    const answer = a.getByLabel('我的作答', { exact: true }).nth(1);
    const draftURL = base + '/api/v1' + prefix + `/assignments/${assignment.id}/questions/${questions[1].id}/draft`;
    let releaseSave; let savedRequest; let delayed = false;
    const saveStarted = new Promise(resolve => { savedRequest = resolve; });
    await a.route(draftURL, async route => {
      if (route.request().method() !== 'PUT' || delayed) return route.continue();
      delayed = true; savedRequest(); await new Promise(resolve => { releaseSave = resolve; }); await route.continue();
    });
    await answer.fill('第一版待保存'); await Promise.race([saveStarted, new Promise((_, reject) => setTimeout(() => reject(Error('Autosave did not start')), 12000))]);
    await answer.fill('保存期间继续输入😀'); releaseSave();
    await a.waitForResponse(r => r.url() === draftURL && r.request().method() === 'PUT' && r.request().postDataJSON().answer_text === '保存期间继续输入😀');
    await a.reload(); await answer.waitFor();
    await a.waitForFunction(() => [...document.querySelectorAll('textarea[aria-label="我的作答"]')][1]?.value === '保存期间继续输入😀');
    await a.unroute(draftURL);
    await a.route(draftURL, route => route.request().method() === 'PUT' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: '构造保存失败' } }) }) : route.continue());
    await answer.fill('失败时保留的草稿');
    await a.getByText('保存失败，内容已暂存，可重试', { exact: false }).waitFor();
    a.once('dialog', dialog => dialog.accept()); await a.reload();
    await a.getByText('已恢复上次未保存的编辑。', { exact: true }).waitFor();
    assert(await answer.inputValue() === '失败时保留的草稿', 'Failed save lost local recovery');
    await a.unroute(draftURL);
    const answerPanel = a.locator('.answer-panel').nth(1);
    await answerPanel.getByRole('button', { name: '保存作答草稿', exact: true }).click();
    await answerPanel.getByRole('button', { name: '提交本题', exact: true }).click();
    await a.getByRole('dialog').getByText('确认提交本题？', { exact: true }).waitFor();
    await a.getByRole('button', { name: '确认提交', exact: true }).click();
    await answerPanel.getByText(/提交成功 · 第1次/).waitFor();
    await a.getByText('已提交 2 / 2 题', { exact: true }).waitFor();
    pass('慢保存期间的新输入不丢失、失败恢复、逐题确认回执与多题进度');

    await a.goto(url('student', `homework/submissions/${submissions[0].id}/feedback`));
    await a.getByText('交互验收评分', { exact: true }).waitFor();
    assert(await a.getByText('待恢复的评分修改', { exact: true }).count() === 0, 'Unreleased revision leaked');
    assert(await a.locator('form').count() === 0, 'Student can edit grades');
    pass('学生只见最新已发布结果，未发布修订隔离');

    await t.goto(url('teacher', 'dashboard', '&view=evidence&student=' + student.me.user.id));
    await t.getByRole('link', { name: '根据本次反馈安排任务', exact: true }).first().click();
    const creator = t.getByRole('dialog');
    await t.waitForFunction(id => document.querySelector('select[aria-label="指定学生"]')?.value === id, student.me.user.id);
    await creator.getByRole('link', { name: '查看原始依据', exact: true }).waitFor();
    await creator.getByLabel('任务标题', { exact: true }).fill('交互验收补学补练');
    await creator.getByLabel('补学资料、练习及完成要求', { exact: true }).fill('学习资料，并为两道题补交新答案。');
    await creator.getByLabel('关联补学资料', { exact: true }).selectOption(resource.id);
    await creator.getByLabel('关联补练作业', { exact: true }).selectOption(assignment.id);
    await creator.getByRole('button', { name: '保存任务草稿', exact: true }).click();
    await t.getByRole('button', { name: '确认下发', exact: true }).waitFor();
    const task = new URL(t.url()).searchParams.get('task');
    await ac('GET', prefix + '/interventions/' + task + '/evidence', undefined, 403);
    await t.getByRole('button', { name: '确认下发', exact: true }).click();
    await t.getByRole('heading', { name: '本次完成条件', exact: true }).waitFor();
    await otherStudent.call('GET', prefix + '/interventions/' + task + '/evidence', undefined, 403);
    await a.goto(url('student', 'intervention', '&task=' + task));
    const submitTask = a.getByRole('button', { name: '提交执行结果', exact: true });
    assert(await submitTask.isDisabled(), 'Old work satisfies new task');
    await a.getByRole('link', { name: /打开补学资料/ }).click();
    await a.getByRole('button', { name: '标记完成', exact: true }).click();
    await a.getByRole('status').filter({ hasText: '已保存' }).waitFor();
    await a.getByRole('link', { name: '返回补学补练任务，检查完成条件', exact: true }).click();
    await a.getByText('✓ 已有新的学习完成记录', { exact: true }).waitFor();
    assert(await submitTask.isDisabled(), 'New learning alone bypasses practice');
    await a.getByRole('link', { name: '进入补练作业', exact: true }).click();
    for (let i = 0; i < 2; i++) {
      const panel = a.locator('.answer-panel').nth(i);
      await panel.getByLabel('我的作答', { exact: true }).fill('补练新作答 ' + i);
      await panel.getByRole('button', { name: '保存作答草稿', exact: true }).click();
      await panel.getByRole('button', { name: '提交本题', exact: true }).click();
      await a.getByRole('button', { name: '确认提交', exact: true }).click();
      await panel.getByText(/提交成功/).waitFor();
    }
    await a.getByRole('link', { name: '返回补学补练任务，检查完成条件', exact: true }).click();
    await a.getByText('✓ 已为全部题目提交新作答', { exact: true }).waitFor();
    await a.getByLabel('执行结果与新学习证据', { exact: true }).fill('已重新学习并逐题补练。');
    await submitTask.click(); await submitTask.waitFor({ state: 'hidden' });
    await t.reload(); await t.getByLabel('复查意见', { exact: true }).fill('已核对下发后的学习与两题新提交');
    await t.getByRole('button', { name: '确认复查完成', exact: true }).click();
    await t.getByRole('button', { name: '确认复查完成', exact: true }).waitFor({ state: 'hidden' });
    await t.screenshot({ path: path.join(root, '.local/workspace-intervention.png'), fullPage: true });
    pass('学情证据带入学生和来源、任务条件提示、新学习与逐题补练、教师复查、草稿及本人权限');

    for (const [page, role, routes] of [[t, 'teacher', ['course-twin', 'dashboard', 'homework', `homework/submissions/${submissions[0].id}/grade`, 'intervention']], [a, 'student', ['course-content', 'home', 'homework', `homework/${assignment.id}`, `homework/submissions/${submissions[0].id}/feedback`, 'intervention', 'learning']]]) {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const route of routes) {
          await page.goto(url(role, route)); await page.locator('main h1').first().waitFor(); await page.waitForLoadState('networkidle');
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${role}/${route} overflows at ${width}`);
          assert(new URL(page.url()).searchParams.get('course') === course.id, 'Deep link lost course');
        }
      }
    }
    await t.setViewportSize({ width: 1440, height: 1000 }); await t.goto(url('teacher', 'curriculum'));
    await t.getByRole('heading', { name: '课程目录', exact: true, level: 1 }).waitFor();
    await t.screenshot({ path: path.join(root, '.local/workspace-course.png'), fullPage: true });
    await t.goto(url('teacher', 'courses')); await t.getByLabel('新课程名称', { exact: true }).waitFor();
    await t.getByRole('tab', { name: '课程成员', exact: true }).click(); await t.getByLabel('学生用户名', { exact: true }).waitFor();
    assert(await t.getByLabel('课程名称', { exact: true }).count() === 0, 'Settings mixed into members tab');
    assert(errors.length === 0, errors.join('\n'));
    pass('课程分区、12条师生路线在1440/390px无横向溢出、课程深链、无页面异常');
    fs.writeFileSync(path.join(root, '.local/workspace-check.json'), JSON.stringify({ passed: true, course_id: course.id, assignment_id: assignment.id, submission_id: submissions[0].id, task_id: task, checks, model_calls: 0, production_changed: false }, null, 2));
  } catch (e) {
    for (const [label, user] of [['teacher', teacher], ['student', student]]) if (user) await user.page.screenshot({ path: path.join(root, `.local/workspace-failure-${label}.png`), fullPage: true }).catch(() => {});
    throw e;
  } finally { for (const context of contexts) await context.close(); await browser.close(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
