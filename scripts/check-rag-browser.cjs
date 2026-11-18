const { choose, selectedText, selectFile } = require('./browser-ui.cjs');
// Local browser acceptance; genuine model calls use the shared database budget.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:18080';
const accounts = JSON.parse(fs.readFileSync(path.join(root, '.local/s1-accounts.json'), 'utf8')).accounts;
const httpReport = JSON.parse(fs.readFileSync(path.join(root, '.local/rag-acceptance.json'), 'utf8'));
const assert = (ok, message) => { if (!ok) throw Error(message); };
const continuing = process.argv.includes('--continue-run');
const report = continuing ? JSON.parse(fs.readFileSync(path.join(root, '.local/rag-browser.json'), 'utf8')) : { checks: [], screenshots: [] };
delete report.error;
const save = () => fs.writeFileSync(path.join(root, '.local/rag-browser.json'), JSON.stringify(report, null, 2));
const pass = message => { if (!report.checks.includes(message)) report.checks.push(message); save(); console.log('PASS', message); };
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [], contexts = [];
  try {
    async function login(username, role) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      contexts.push(context);
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', e => errors.push(e.message));
      page.on('dialog', d => d.accept());
      await page.goto(base + '/login');
      await page.getByLabel('用户名', { exact: true }).fill(username);
      await page.getByLabel('密码', { exact: true }).fill(accounts.find(a => a.username === username).password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.waitForURL(u => u.pathname === `/${role}/${role === 'teacher' ? 'dashboard' : 'home'}`);
      const me = (await (await page.request.get(base + '/api/v1/me')).json()).data;
      async function call(method, url, data) {
        const r = await page.request.fetch(base + '/api/v1' + url, { method, data, headers: { Origin: base, 'X-CSRF-Token': me.csrf_token } });
        assert(r.status() === 200, `${method} ${url}: ${r.status()} ${(await r.text()).slice(0, 250)}`);
        return (await r.json()).data;
      }
      return { page, call, me };
    }
    const teacher = await login('s1-teacher', 'teacher');
    const student = await login('s1-student-a', 'student');
    const { page: t, call: tc } = teacher, { page: s, call: sc } = student;
    const course = continuing ? { id: report.course_id } : await tc('POST', '/learning/courses', { title: '资料与知识库界面验收 ' + Date.now() });
    report.course_id = course.id;
    const api = '/learning/courses/' + course.id;
    if (!continuing) {
      await tc('POST', api + '/members', { username: 's1-student-a' });
      await tc('POST', api + '/publish', {});
    }
    const url = (role, route, extra = '') => `${base}/${role}/${route}?course=${course.id}${extra}`;
    async function screenshot(name, page = t) {
      const file = path.join(root, '.local', name + '.png');
      await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
      report.screenshots = [...new Set([...report.screenshots, file])]; save();
    }
    async function waitJobs(kind) {
      let previous = '';
      for (let i = 0; i < 65; i++) {
        const jobs = (await tc('GET', api + '/jobs')).filter(j => j.kind === kind);
        const state = jobs.map(j => j.state).join(',');
        if (state !== previous) { console.log(kind, state); previous = state; }
        assert(!jobs.some(j => j.state === 'failed'), 'Job failed: ' + JSON.stringify(jobs.filter(j => j.state === 'failed').map(j => j.error)));
        if (jobs.length && jobs.every(j => j.state === 'succeeded')) return;
        await t.waitForTimeout(1500);
      }
      throw Error(kind + ' timeout');
    }
    await t.goto(url('teacher', 'materials'));
    if (!(await tc('GET', api + '/sources')).length) {
    await t.getByRole('button', { name: '导入资料', exact: true }).click();
    const upload = t.getByRole('dialog');
    await selectFile(upload.getByRole('button', { name: '课程文件', exact: true }), path.join(root, '.local/rag-fixtures/boundary.txt'));
    await upload.getByLabel('资料来源', { exact: true }).fill('本地浏览器验收构造资料');
    await upload.getByLabel('允许从本资料提炼知识候选', { exact: true }).check();
    await upload.getByRole('button', { name: '上传并解析', exact: true }).click();
    await upload.waitFor({ state: 'hidden' });
    }
    await waitJobs('parse');
    await t.getByRole('button', { name: '刷新', exact: true }).click();
    await t.locator('.rag-source').filter({ hasText: 'boundary.txt' }).click();
    const sourceDrawer = t.getByRole('dialog');
    if (!(await tc('GET', api + '/resources')).length) {
    await sourceDrawer.locator('.rag-fragment input[type=checkbox]').first().check();
    await sourceDrawer.getByLabel('发布标题', { exact: true }).fill('边界值分析公开学习资料');
    const publication = t.waitForResponse(r => r.url().endsWith('/publish') && r.request().method() === 'POST');
    await sourceDrawer.getByRole('button', { name: '确认并发布到课程学习', exact: true }).click();
    const publicationResponse = await publication;
    assert(publicationResponse.status() === 200, 'Publication failed: ' + publicationResponse.status());
    }
    const resource = (await tc('GET', api + '/resources'))[0];
    assert(resource.status === 'published', 'Publication did not persist');
    await screenshot('rag-source-desktop');
    pass('Browser upload, parse preview, selection and publication persist through real APIs');

    if (!(await tc('GET', api + '/knowledge')).length) {
      await sourceDrawer.getByRole('button', { name: 'AI提炼知识候选', exact: true }).click();
      await waitJobs('extract');
    }
    await sourceDrawer.getByRole('link', { name: '审核知识候选', exact: true }).click();
    await t.getByRole('button', { name: '新建知识', exact: true }).waitFor();
    const knowledge = await tc('GET', api + '/knowledge');
    const item = knowledge.find(k => k.id === report.knowledge_id) || knowledge.find(k => k.student_visible && k.use_for_grading) || knowledge[0];
    report.knowledge_id = item.id; save();
    const candidate = t.locator('.rag-knowledge').filter({ has: t.getByText(item.title, { exact: true }) });
    if (item.state === 'draft') {
    await candidate.getByRole('button', { name: '编辑候选', exact: true }).click();
    const editor = t.getByRole('dialog');
    await editor.getByLabel('学生可见', { exact: true }).check();
    await editor.getByLabel('用于评分依据', { exact: true }).check();
    await editor.getByRole('button', { name: '保存待审核版本', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    await candidate.getByRole('button', { name: '确认知识', exact: true }).click();
    await candidate.getByText('已确认 · v1', { exact: true }).waitFor();
    }
    const confirmed = (await tc('GET', api + '/knowledge')).find(k => k.id === item.id);
    assert(confirmed.student_visible && confirmed.use_for_grading, 'Knowledge settings lost');
    await screenshot('rag-knowledge-desktop');
    await s.goto(url('student', 'knowledge'));
    await s.getByText(confirmed.title, { exact: true }).waitFor();
    assert(await s.getByRole('button', { name: '编辑候选', exact: true }).count() === 0, 'Student got editor');
    pass('Genuine AI candidates can be edited, confirmed and opened to students through the UI');

    await t.goto(url('teacher', 'retrieval'));
    await t.getByLabel('课程问题', { exact: true }).fill('年龄边界值分析');
    await t.getByRole('button', { name: '检索依据', exact: true }).click();
    await t.locator('.rag-hit').first().waitFor();
    await t.locator('.rag-hit').filter({ has: t.getByRole('link', { name: '查看原文', exact: true }) }).first().getByRole('link', { name: '查看原文', exact: true }).click();
    await t.getByRole('dialog').getByText('原文修订', { exact: false }).waitFor();
    await screenshot('rag-source-reference');
    await s.goto(url('student', 'retrieval'));
    await s.getByLabel('课程问题', { exact: true }).fill('ALPHA_PRIVATE_731');
    await s.getByRole('button', { name: '检索依据', exact: true }).click();
    await s.getByText(/检索依据 ·/).waitFor();
    assert(!(await s.locator('.rag-hit').allTextContents()).some(v => v.includes('ALPHA_PRIVATE_731')), 'Private source leaked');
    if (!report.qa_checked) {
    await s.getByRole('textbox', { name: /^课程问题/ }).fill('年龄18到60，为什么要测17和61？');
    await s.getByRole('button', { name: '根据资料回答', exact: true }).click();
    await s.getByText('AI回答', { exact: true }).waitFor({ timeout: 100000 });
    assert(await s.locator('.card-panel').filter({ has: s.getByText('AI回答', { exact: true }) }).locator('blockquote').count() > 0, 'Grounded answer did not render citations');
    await screenshot('rag-qa-desktop', s);
    report.qa_checked = true; save();
    }
    pass('Retrieval links return to original fragments; student search and Q&A preserve publication boundaries');

    if (!report.rubric_checked) {
      await t.goto(`${base}/teacher/homework/${httpReport.assignment_id}?course=${httpReport.course_id}`);
      await t.locator('.ant-collapse-header').filter({ hasText: '逐点评分标准' }).click();
      const requestedRubric = t.waitForResponse(r => r.url().endsWith('/jobs') && r.request().method() === 'POST');
      await t.getByRole('button', { name: 'AI起草标准', exact: true }).click();
      const rubricJob = (await (await requestedRubric).json()).data;
      await t.getByRole('button', { name: '载入编辑区', exact: true }).waitFor({ timeout: 100000 });
      await t.getByRole('button', { name: '载入编辑区', exact: true }).click();
      await t.reload();
      await t.locator('.ant-collapse-header').filter({ hasText: '逐点评分标准' }).click();
      await t.getByRole('button', { name: '新建标准版本', exact: true }).click();
      await t.getByText('已恢复上次未保存的编辑。', { exact: true }).waitFor();
      const savedRubric = t.waitForResponse(r => /\/questions\/[^/]+\/rubrics$/.test(r.url()) && r.request().method() === 'POST');
      await t.getByRole('button', { name: '保存标准草稿', exact: true }).click();
      const rubricResponse = await savedRubric;
      assert(rubricResponse.status() === 200, 'Rubric save failed: ' + await rubricResponse.text());
      const rubric = (await rubricResponse.json()).data;
      const frozen = await tc('GET', `/learning/courses/${httpReport.course_id}/jobs/${rubricJob.id}`);
      assert(rubric.state === 'draft' && rubric.evidence_refs.length === frozen.output.evidence_refs.length, 'Rubric provenance did not persist');
      report.rubric_checked = true; save();
      pass('AI rubric adoption survives reload and preserves frozen evidence in a separate draft version');
    }

    if (!report.checks.includes('AI grading adoption survives reload and saves a linked private revision without publishing')) {
    const gradingURL = `${base}/teacher/homework/submissions/${httpReport.submission_id}/grade?course=${httpReport.course_id}`;
    await t.goto(gradingURL);
    await t.getByRole('button', { name: '基于当前评分修改', exact: true }).click();
    const response = t.waitForResponse(r => r.url().endsWith('/jobs') && r.request().method() === 'POST');
    await t.getByRole('button', { name: 'AI生成评阅草稿', exact: true }).click();
    const job = (await (await response).json()).data;
    report.grade_job_id = job.id; save();
    await t.getByRole('button', { name: '载入编辑区', exact: true }).waitFor({ timeout: 100000 });
    await t.getByRole('button', { name: '载入编辑区', exact: true }).click();
    await t.reload();
    await t.getByRole('button', { name: '基于当前评分修改', exact: true }).click();
    await t.getByText('已恢复上次未保存的编辑。', { exact: true }).waitFor();
    const keys = await t.evaluate(() => Object.keys(sessionStorage).filter(k => k.includes('grade:')).map(k => JSON.parse(sessionStorage.getItem(k))));
    assert(keys.some(k => k.ai_job_id === job.id), 'AI provenance lost on reload');
    const savedGrade = t.waitForResponse(r => r.url().endsWith('/revisions') && r.request().method() === 'POST');
    await t.getByRole('button', { name: '保存逐点评分草稿', exact: true }).click();
    const gradeResponse = await savedGrade;
    assert(gradeResponse.status() === 200, 'Grade save failed: ' + await gradeResponse.text());
    const detail = await tc('GET', `/learning/courses/${httpReport.course_id}/submissions/${httpReport.submission_id}`);
    assert(detail.revisions[0].ai_job_id === job.id && detail.revisions[0].state === 'draft', 'Adopted AI job is not linked to draft');
    const formal = await sc('GET', `/learning/courses/${httpReport.course_id}/submissions/${httpReport.submission_id}`);
    assert(formal.revisions.every(r => r.state === 'released'), 'Unconfirmed AI draft leaked');
    pass('AI grading adoption survives reload and saves a linked private revision without publishing');
    }

    let newDraftCalls = 0;
    const countDraftCalls = request => {
      if (request.method() === 'POST' && request.url().endsWith('/jobs')) newDraftCalls++;
    };
    t.on('request', countDraftCalls);
    await t.setViewportSize({ width: 1440, height: 1000 });
    await t.goto(`${base}/teacher/homework/${httpReport.assignment_id}?course=${httpReport.course_id}`);
    await t.locator('.ant-collapse-header').filter({ hasText: '逐点评分标准' }).click();
    await t.getByRole('button', { name: '载入编辑区', exact: true }).waitFor();
    await t.reload();
    await t.locator('.ant-collapse-header').filter({ hasText: '逐点评分标准' }).click();
    await t.getByRole('button', { name: '载入编辑区', exact: true }).waitFor();
    await t.getByText('查看AI草稿', { exact: true }).click();
    const frozen = t.locator('.rag-draft-preview');
    await frozen.locator('.ant-collapse-header').filter({ hasText: '引用依据' }).click();
    await frozen.locator('.rag-hit').first().waitFor();
    await screenshot('rag-frozen-rubric-evidence');
    await frozen.getByRole('link', { name: '查看引用原文', exact: true }).first().click();
    await t.getByRole('dialog').getByText('原文修订', { exact: false }).waitFor();
    await t.goto(`${base}/teacher/homework/submissions/${httpReport.submission_id}/grade?course=${httpReport.course_id}`);
    await t.getByRole('button', { name: '基于当前评分修改', exact: true }).click();
    await t.getByRole('button', { name: '载入编辑区', exact: true }).waitFor();
    await t.reload();
    await t.getByRole('button', { name: '基于当前评分修改', exact: true }).click();
    await t.getByRole('button', { name: '载入编辑区', exact: true }).waitFor();
    assert(newDraftCalls === 0, 'Reload triggered another paid draft generation');
    t.off('request', countDraftCalls);
    pass('Completed rubric and grading jobs recover from database after reload without model calls; frozen evidence links open original text');

    const sourceID = (await tc('GET', api + '/sources'))[0].id;
    const original = (await tc('GET', api + '/resources'))[0];
    if (!report.history_checked) {
      await t.goto(url('teacher', 'materials', '&source=' + sourceID));
      const fragment = t.getByRole('dialog').locator('.rag-fragment').first();
      await fragment.getByRole('button', { name: '校正原文', exact: true }).click();
      const edit = fragment.locator('textarea');
      await edit.fill((await edit.inputValue()) + ' 本次校对保留历史版本。');
      const corrected = t.waitForResponse(r => r.url().endsWith('/fragments') && r.request().method() === 'PUT');
      await fragment.getByRole('button', { name: '保存新修订并确认原文', exact: true }).click();
      assert((await corrected).status() === 200, 'Fragment correction failed');
      await t.goto(url('teacher', 'materials', '&source=' + sourceID + '&fragment=' + original.fragment_ids[0]));
      await t.getByText('正在查看引用时的历史原文。', { exact: false }).waitFor();
      assert(await t.getByRole('button', { name: '校正原文', exact: true }).count() === 0, 'Historical fragment is editable');
      await screenshot('rag-history-reference');
      await tc('PUT', api + '/sources/' + sourceID + '/derivation', { allow_derived: false });
      assert((await sc('GET', api + '/knowledge')).length === 0, 'Revoked derivation remained student-visible');
      await tc('PUT', api + '/sources/' + sourceID + '/derivation', { allow_derived: true });
      report.history_checked = true; save();
      pass('Corrections preserve read-only historical citations; revoked derivation immediately hides dependent knowledge');
    }

    for (const [page, role, route] of [[t, 'teacher', 'materials'], [t, 'teacher', 'knowledge'], [t, 'teacher', 'retrieval'], [s, 'student', 'knowledge'], [s, 'student', 'retrieval']]) {
      await page.setViewportSize({ width: 375, height: 900 });
      await page.goto(url(role, route));
      await page.locator('main .live-page').waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${role}/${route} overflows 375px`);
      await screenshot(`rag-${role}-${route}-mobile`, page);
    }
    await t.goto(url('teacher', 'materials'));
    await t.locator('.rag-source').first().click();
    await t.waitForFunction(() => {
      const e = document.querySelector('[role=dialog]');
      const r = e?.getBoundingClientRect();
      return r && r.width > 300 && r.left >= -1 && r.right <= innerWidth + 1;
    });
    await screenshot('rag-source-mobile');
    assert(errors.length === 0, errors.join('\n'));
    pass('375px teacher/student pages and source drawer fit; no page errors');
    report.completed_at = new Date().toISOString();
    delete report.page_errors; delete report.failure_pages;
    save();
  } catch (error) {
    report.error = String(error);
    report.page_errors = errors;
    report.failure_pages = [];
    for (let i = 0; i < contexts.length; i++) {
      const page = contexts[i].pages()[0];
      if (!page) continue;
      report.failure_pages.push({ url: page.url(), text: (await page.locator('body').innerText()).slice(0, 3000) });
      await page.screenshot({ path: path.join(root, '.local', `rag-failure-${i}.png`), fullPage: true });
    }
    save(); throw error;
  } finally {
    for (const context of contexts) await context.close();
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
