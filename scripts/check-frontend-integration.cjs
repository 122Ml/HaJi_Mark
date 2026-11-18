// Isolated real application acceptance. Fixture models test plumbing, never AI quality.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const { choose, selectFile } = require('./browser-ui.cjs');
const root = path.resolve(__dirname, '..');
const folder = path.join(root, '.local/frontend-integration-2026-11-19');
const base = process.env.INTEGRATION_BASE || 'http://127.0.0.1:18082';
if (new URL(base).hostname !== '127.0.0.1' || new URL(base).port !== '18082') throw Error('Use the isolated localhost:18082 environment');
const accounts = JSON.parse(fs.readFileSync(path.join(folder, 's1-accounts.json'), 'utf8')).accounts;
const phase = process.argv[2] || 'materials';
const fixtureFile = path.join(folder, 'browser-fixtures.json');
const ids = fs.existsSync(fixtureFile) ? JSON.parse(fs.readFileSync(fixtureFile, 'utf8')) : {};
const report = { phase, started_at: new Date().toISOString(), model: 'local deterministic fixture; not AI quality evidence', checks: [], errors: [], server_errors: [] };
const save = () => { report.objects = { ...ids }; fs.writeFileSync(fixtureFile, JSON.stringify(ids, null, 2)); fs.writeFileSync(path.join(folder, `browser-${phase}.json`), JSON.stringify(report, null, 2)); };
const pass = title => { report.checks.push(title); save(); console.log('PASS', title); };
const until = async (title, read, predicate, timeout = 60000) => {
  const end = Date.now() + timeout; let value;
  while (Date.now() < end) { value = await read(); if (predicate(value)) return value; await new Promise(r => setTimeout(r, 700)); }
  throw Error(`Timeout ${title}: ${JSON.stringify(value).slice(0, 700)}`);
};
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let t;
  try {
    const login = async (username, role) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', e => report.errors.push(e.message));
      page.on('response', r => { if (r.status() >= 500 && r.url().includes('/api/') && r.headers()['x-acceptance-injected'] !== '1') report.server_errors.push(`${r.status()} ${new URL(r.url()).pathname}`); });
      page.on('dialog', d => d.accept());
      await page.goto(base + '/login');
      await page.getByLabel('用户名', { exact: true }).fill(username);
      await page.getByLabel('密码', { exact: true }).fill(accounts.find(a => a.username === username).password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.waitForURL(u => u.pathname === `/${role}/${role === 'teacher' ? 'dashboard' : 'home'}`);
      const me = (await (await page.request.get(base + '/api/v1/me')).json()).data;
      const call = async (method, route, data, expected = 200) => {
        const res = await page.request.fetch(base + '/api/v1' + route, { method, data, headers: { Origin: base, 'X-CSRF-Token': me.csrf_token } });
        const body = await res.text(); assert.equal(res.status(), expected, `${method} ${route}: ${body.slice(0, 700)}`);
        return body ? JSON.parse(body).data : null;
      };
      return { page, call };
    };
    const teacher = await login('s1-teacher', 'teacher'); t = teacher.page;
    const student = await login('s1-student-a', 'student'); const s = student.page;
    const tc = (method, route, data, expected) => teacher.call(method, '/learning/courses/' + ids.course + route, data, expected);
    const sc = (method, route, data, expected) => student.call(method, '/learning/courses/' + ids.course + route, data, expected);
    const url = (role, route, params = {}) => `${base}/${role}/${route}?${new URLSearchParams({ course: ids.course, ...params })}`;
    const go = async (route, params = {}) => t.goto(url('teacher', route, params));
    const shot = async name => { const file = path.join(folder, `${phase}-${name}.png`); await t.screenshot({ path: file, fullPage: true }); };
    const confirm = async () => { const modal = t.locator('.ant-modal-confirm'); await modal.waitFor(); await modal.getByRole('button', { name: /确|继/ }).last().click(); await modal.waitFor({ state: 'hidden' }); };
    const response = suffix => t.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(suffix));
    if (!ids.course) {
      const course = await teacher.call('POST', '/learning/courses', { title: '前后端协同隔离验收（构造数据）' }); ids.course = course.id;
      await tc('POST', '/members', { username: 's1-student-a' }); await tc('POST', '/members', { username: 's1-student-b' });
      await tc('POST', '/publish', {});
      ids.point = (await tc('POST', '/points', { title: '边界值分析', kind: 'point', position: 0 })).id;
      save();
    }
    if (phase === 'materials') {
      await go('materials', { tab: 'published' });
      await t.locator('#workspace-nav .ant-menu-item').first().waitFor();
      assert.equal(await t.locator('#workspace-nav .ant-menu-item').count(), 7); // six domains plus account
      await t.getByRole('button', { name: '新增资料', exact: true }).click();
      const editor = t.getByRole('dialog');
      const title = '同页手工资料 ' + Date.now();
      await editor.getByLabel('资料标题', { exact: true }).fill(title);
      await editor.getByLabel('资料原文', { exact: true }).fill('边界值分析应覆盖区间内与区间外的边界。年龄允许18到60时，检查17、18、19、59、60、61。');
      await editor.getByLabel('来源说明', { exact: true }).fill('自动化隔离验收构造文本');
      await choose(editor.getByLabel('关联知识点', { exact: true }), '边界值分析');
      const created = response('/resources');
      await editor.getByRole('button', { name: /保存/ }).click();
      const manual = (await (await created).json()).data; ids.manual = manual.id; save();
      await editor.waitFor({ state: 'hidden' });
      await until('select newly created resource', async () => new URL(t.url()).searchParams.get('resource'), v => v === manual.id);
      await t.getByText(title, { exact: true }).first().waitFor();
      const previousIndexJobs = new Set((await tc('GET', '/jobs?kind=index')).map(j => j.id));
      await t.getByRole('button', { name: '审核通过并发布', exact: true }).click(); await confirm();
      await until('resource published', () => tc('GET', '/resources'), rows => rows.some(r => r.id === manual.id && r.status === 'published'));
      await until('new publication index succeeded', () => tc('GET', '/jobs?kind=index'), rows => rows.some(j => !previousIndexJobs.has(j.id) && j.state === 'succeeded'));
      await until('new resource actually indexed', () => tc('GET', '/retrieval/status?resource_id=' + manual.id), v => v.object_index.keyword_chunks > 0 && v.object_index.vector_chunks > 0);
      pass('F03/F05/F06 手工创建后选中确切草稿，同页确认发布，真实worker完成索引');
      await s.goto(url('student', 'course-content', { resource: manual.id, task: 'retained-return-context' }));
      await s.locator('#workspace-nav .ant-menu-item').first().waitFor();
      assert.equal(await s.locator('#workspace-nav .ant-menu-item').count(), 6); // five domains plus account
      await s.getByText('就本资料提问', { exact: true }).click();
      await s.getByLabel('课程问题', { exact: true }).fill('边界值分析');
      await s.getByRole('button', { name: '检索依据', exact: true }).click();
      await s.locator('.rag-hit').first().waitFor();
      assert.equal(new URL(s.url()).searchParams.get('resource'), manual.id);
      const search = await sc('POST', '/retrieval', { query: '边界值分析', resource_id: manual.id, purpose: 'learning' });
      assert(search.hits.length && search.hits.every(h => h.resource_id === manual.id));
      await s.getByRole('button', { name: '根据资料回答', exact: true }).click();
      await s.getByText('依据当前学习资料说明[R1]。', { exact: true }).waitFor();
      assert(await s.getByRole('link', { name: '返回补学补练任务，检查完成条件' }).count());
      pass('F12/F16 学生阅读内检索及构造模型引用问答保留资料与任务上下文');

      await go('materials');
      await t.getByRole('button', { name: '导入资料', exact: true }).click();
      const upload = t.getByRole('dialog');
      let posts = 0;
      let releaseUpload;
      await t.route('**/sources', async route => {
        if (route.request().method() === 'POST' && posts === 0) {
          posts++;
          await new Promise(resolve => { releaseUpload = resolve; });
          return route.continue();
        }
        if (route.request().method() === 'POST' && ++posts === 2) return route.fulfill({ status: 422, headers: { 'X-Acceptance-Injected': '1' }, contentType: 'application/json', body: JSON.stringify({ error: { code: 'verification_failure', message: '验收注入：第二份未接收' } }) });
        return route.continue();
      });
      await selectFile(upload.getByRole('button', { name: '课程文件', exact: true }), [
        { name: '协同边界讲义.txt', mimeType: 'text/plain', buffer: Buffer.from(`边界值分析要求检验允许区间内和区间外的边界。本次隔离验收编号${Date.now()}。\n\n未发布私有说明：只供教师核对，不允许出现在学生检索中。`) },
        { name: '验收失败文件.txt', mimeType: 'text/plain', buffer: Buffer.from('这份文件将被浏览器注入拒绝。') },
      ]);
      await upload.getByLabel('资料来源', { exact: true }).fill('自动化构造文件，非真实教学资料');
      await upload.getByRole('checkbox', { name: '允许从本资料提炼知识候选' }).check();
      await upload.getByRole('button', { name: '上传并解析', exact: true }).click();
      await until('first upload held', async () => typeof releaseUpload, v => v === 'function');
      await upload.getByRole('button', { name: '上传中…', exact: true }).waitFor();
      assert.equal(await upload.locator('.ant-drawer-close').count(), 0);
      assert.equal(await upload.getByRole('tab', { name: '公开网址', exact: true }).getAttribute('aria-disabled'), 'true');
      await t.keyboard.press('Escape');
      assert(await upload.isVisible());
      releaseUpload();
      await upload.getByText('协同边界讲义.txt：已接收，解析任务已登记', { exact: true }).waitFor();
      await upload.getByText('验收失败文件.txt：未完成／结果待核对', { exact: true }).waitFor();
      assert.equal(posts, 2); assert(await upload.getByRole('button', { name: '上传并解析', exact: true }).isDisabled());
      await shot('partial-upload');
      await upload.getByRole('button', { name: '查看此文件处理', exact: true }).click();
      await upload.waitFor({ state: 'hidden' }); await t.unroute('**/sources');
      ids.source = new URL(t.url()).searchParams.get('source'); save(); assert(ids.source);
      assert.equal(new URL(t.url()).searchParams.get('source_view'), 'tasks');
      const source = await until('parse completes', () => tc('GET', '/sources/' + ids.source), v => v.source.parse_state === 'ready');
      assert(source.fragments.length >= 2);
      await t.getByText('原文已落库，尚需核对、发布和确认知识。索引状态独立查看。', { exact: true }).waitFor();
      pass('F03/F04/F14 多文件一成一败保留逐份回执，不自动重传，选中首份原件及真实解析记录');
      await t.getByRole('tab', { name: '原文核对', exact: true }).click();
      const fragment = t.locator('.rag-fragment').first();
      await fragment.getByRole('checkbox').first().check();
      ids.publishedTitle = '仅发布第一段的学习资料 ' + Date.now(); save();
      await t.getByLabel('发布标题', { exact: true }).fill(ids.publishedTitle);
      await choose(t.getByLabel('发布关联知识点', { exact: true }), '边界值分析');
      const publication = response('/sources/' + ids.source + '/publish');
      await t.getByRole('button', { name: '确认并发布到课程学习', exact: true }).click(); await confirm();
      const published = (await (await publication).json()).data; ids.published = published.id; save();
      assert.equal(published.knowledge_point_id, ids.point);
      await t.getByRole('link', { name: '查看已发布学习内容与学生可见文本', exact: true }).click();
      await t.getByText(published.content, { exact: true }).first().waitFor();
      assert.equal(new URL(t.url()).searchParams.get('resource'), published.id);
      const visible = (await sc('GET', '/resources')).find(r => r.id === published.id);
      assert(visible && !visible.content.includes('未发布私有说明'));
      const privateSearch = await sc('POST', '/retrieval', { query: '私有说明', purpose: 'learning', resource_id: published.id });
      assert(!JSON.stringify(privateSearch).includes('未发布私有说明'));
      pass('F07/F12 原文只选第一片段发布，知识点和确切版本回执保留，学生检索不展开私有原件');
      await t.getByRole('tab', { name: '原文核对', exact: true }).click();
      await t.locator('.rag-fragment').first().getByRole('checkbox').first().check();
      await t.getByRole('button', { name: 'AI提炼知识候选', exact: true }).click();
      const extraction = await until('extraction finishes', () => tc('GET', '/jobs?kind=extract&source_id=' + ids.source), v => v[0]?.state === 'succeeded');
      ids.extraction = extraction[0].id; save();
      await t.getByRole('tab', { name: '处理记录', exact: true }).click();
      await t.getByRole('link', { name: '核对本次知识候选', exact: true }).click();
      await t.getByText('构造验收边界知识候选', { exact: true }).waitFor();
      assert.equal(new URL(t.url()).searchParams.get('job'), ids.extraction);
      await shot('source-knowledge');
      pass('F04/F07 提炼任务真实终态后按原件及candidate_ids进入候选审核，不把排队当完成');
      const candidateID = extraction[0].output.candidate_ids[0];
      assert(!(await sc('GET', '/knowledge')).some(k => k.id === candidateID));
      const knowledgeCard = t.locator('#knowledge-' + candidateID);
      await knowledgeCard.getByRole('button', { name: '编辑候选', exact: true }).click();
      const knowledgeEditor = t.getByRole('dialog');
      await knowledgeEditor.getByRole('checkbox', { name: '学生可见', exact: true }).check();
      await knowledgeEditor.getByRole('checkbox', { name: '用于学习检索', exact: true }).check();
      await knowledgeEditor.getByRole('button', { name: /保存/ }).click();
      await knowledgeEditor.waitFor({ state: 'hidden' });
      await knowledgeCard.getByRole('button', { name: '确认知识', exact: true }).click();
      await until('confirmed knowledge visible', () => sc('GET', '/knowledge'), rows => rows.some(k => k.id === candidateID && k.state === 'confirmed'));
      await s.goto(url('student', 'knowledge', { knowledge_search: '构造验收边界知识候选' }));
      await s.locator('#knowledge-' + candidateID).waitFor();
      assert.equal(new URL(t.url()).searchParams.get('source'), ids.source);
      pass('F07 候选在原件内编辑用途并确认，确认前学生不可见、确认后学生页面读取真实入库条目');
      await t.getByRole('tab', { name: '原文核对', exact: true }).click();
      const sourceURL = t.url();
      await t.getByRole('button', { name: '在此拆分试卷', exact: true }).click();
      const paperDrawer = t.getByRole('dialog');
      await paperDrawer.getByText('当前原件 · 整卷拆题', { exact: true }).waitFor();
      assert.equal(t.url(), sourceURL);
      await paperDrawer.locator('.ant-drawer-close').click();
      assert.equal(t.url(), sourceURL);
      pass('F07 整卷拆题在当前原件抽屉内打开与收起，保留原件和URL；不作为整卷生成效果验收');
      await go('materials', { search: '协同', source: ids.source, source_view: 'knowledge' });
      await t.getByLabel('搜索原始资料', { exact: true }).waitFor(); await t.reload();
      assert.equal(await t.getByLabel('搜索原始资料', { exact: true }).inputValue(), '协同');
      assert.equal(new URL(t.url()).searchParams.get('source'), ids.source);
      pass('F13 原件筛选、对象和工作页签刷新恢复');
      await t.route('**/assist', route => route.request().method() === 'GET' ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { configured: false } }) }) : route.continue());
      await go('materials', { tab: 'published', resource: ids.manual });
      await t.getByText('就本资料提问', { exact: true }).click();
      await t.getByLabel('课程问题', { exact: true }).fill('边界值');
      assert(await t.getByRole('button', { name: '根据资料回答', exact: true }).isDisabled());
      await t.getByRole('button', { name: '检索依据', exact: true }).click(); await t.locator('.rag-hit').first().waitFor();
      await t.unroute('**/assist');
      pass('F16 模型不可用时禁用生成回答，当前发布资料文内检索仍可用');
    }
    if (phase === 'agent') {
      await tc('POST', '/agent/conversations', { mode: 'auto-review', profile_id: 'verification-chat' });
      await go('materials', { tab: 'published', resource: ids.manual });
      const before = t.url();
      await t.getByRole('button', { name: '助理协作', exact: true }).click();
      const drawer = t.getByRole('dialog');
      await drawer.getByLabel('消息', { exact: true }).waitFor();
      assert.equal(t.url(), before);
      assert.equal(await drawer.getByRole('link', { name: '完整会话记录', exact: true }).count(), 0);
      await drawer.getByLabel('消息', { exact: true }).fill('构造验收创建草稿');
      const sent = response('/messages');
      await drawer.getByRole('button', { name: '发送', exact: true }).click();
      const sentResponse = await sent; assert(sentResponse.ok(), await sentResponse.text());
      const association = await until('context conversation', () => drawer.getByRole('link', { name: '完整会话记录', exact: true }).getAttribute('href'), Boolean);
      ids.conversation = new URL(association, base).searchParams.get('conversation'); save();
      const snapshot = await until('agent actual tool loop', () => tc('GET', '/agent/conversations/' + ids.conversation), v => v.runs.some(r => r.state === 'succeeded'));
      assert(snapshot.messages.some(m => m.role === 'user' && m.content.includes('服务端已核验访问权限') && m.content.includes(ids.manual)));
      assert(snapshot.steps.some(step => step.tool === 'resource_create' && step.state === 'succeeded'));
      await drawer.getByLabel('业务处理回执').getByText('学习资料 · 构造验收Agent草稿', { exact: true }).waitFor();
      const target = await drawer.getByLabel('业务处理回执').getByRole('link', { name: '打开业务对象', exact: true }).getAttribute('href');
      ids.agentResource = new URL(target, base).searchParams.get('resource'); save();
      assert((await tc('GET', '/resources')).some(r => r.id === ids.agentResource && r.status === 'draft'));
      await shot('context-receipt');
      pass('F01/F02 资料内助理不跳页、不接无关会话；服务端核验引用，真实工具草稿有确定对象回执卡');
      await drawer.getByLabel('消息', { exact: true }).fill('保留的当前对象草稿');
      await drawer.locator('.ant-drawer-close').click(); await confirm();
      await go('materials', { tab: 'published', resource: ids.agentResource });
      await t.getByRole('button', { name: '助理协作', exact: true }).click();
      await drawer.getByLabel('消息', { exact: true }).waitFor();
      assert.equal(await drawer.getByLabel('消息', { exact: true }).inputValue(), '');
      assert.equal(await drawer.getByRole('link', { name: '完整会话记录', exact: true }).count(), 0);
      await drawer.getByLabel('消息', { exact: true }).fill('另一个对象的独立草稿');
      await drawer.locator('.ant-drawer-close').click(); await confirm();
      await go('materials', { tab: 'published', resource: ids.manual });
      await t.getByRole('button', { name: '助理协作', exact: true }).click();
      assert.equal(await drawer.getByLabel('消息', { exact: true }).inputValue(), '保留的当前对象草稿');
      await drawer.getByLabel('消息', { exact: true }).fill('');
      await drawer.locator('.ant-drawer-close').click();
      if (await t.locator('.ant-modal-confirm').count()) await confirm();
      await t.reload(); await t.getByRole('button', { name: '助理协作', exact: true }).click();
      await drawer.getByLabel('业务处理回执').waitFor();
      assert.equal(new URL(await drawer.getByRole('link', { name: '完整会话记录', exact: true }).getAttribute('href'), base).searchParams.get('conversation'), ids.conversation);
      pass('F13 不同对象助理草稿与会话隔离，同一对象在关闭、刷新后恢复');
    }
    if (phase === 'assessment') {
      const evidence = await tc('POST', '/question-bank/evidence', { source_id: ids.source, query: '边界值' });
      assert(evidence.hits.length);
      const bank = await tc('POST', '/question-bank', { title: '选题器就地核对 ' + Date.now(), prompt: '系统允许18到60整数年龄，说明范围外测试目的。', type: 'subjective', max_score: 10, reference_answer: '检查系统拒绝超范围输入。', knowledge_point_id: ids.point, evidence_ids: [evidence.hits[0].id] });
      ids.bank = bank.bank_id; ids.bankVersion = bank.id; save();
      await go('homework/new');
      const assignmentTitle = '上下文保留作业 ' + Date.now();
      await t.getByLabel('作业标题', { exact: true }).fill(assignmentTitle);
      await t.getByLabel('任务说明', { exact: true }).fill('打开选题工作台后仍须保留这份未保存说明。');
      await t.getByRole('button', { name: '从题库选题', exact: true }).click();
      const picker = t.getByRole('dialog', { name: '从题库选题', exact: true });
      await choose(picker.getByLabel('题目', { exact: true }), bank.title);
      await picker.getByRole('button', { name: '就地核对题目、参考解答与标准', exact: true }).click();
      const work = t.getByRole('dialog').last();
      await work.getByRole('button', { name: '确认题目', exact: true }).click();
      await work.getByRole('button', { name: '确认参考解答', exact: true }).click();
      await work.getByRole('tab', { name: '评分标准', exact: true }).click();
      await work.getByRole('button', { name: '新建标准版本', exact: true }).click();
      await work.getByLabel('评分点名称', { exact: true }).fill('测试目的');
      await work.getByLabel('给分规则', { exact: true }).fill('明确说明检查系统拒绝超范围输入得10分，目的不完整得部分分。');
      const rubricResponse = response('/versions/' + bank.id + '/rubrics');
      await work.getByRole('button', { name: '保存标准草稿', exact: true }).click();
      ids.rubric = (await (await rubricResponse).json()).data.id; save();
      await work.getByRole('button', { name: '确认标准 v1', exact: true }).click();
      await until('confirmed rubric', () => tc('GET', '/question-bank/versions/' + bank.id + '/rubrics'), rows => rows.some(r => r.id === ids.rubric && r.state === 'confirmed'));
      await work.locator('.ant-drawer-close').click();
      await picker.getByRole('button', { name: '加入作业', exact: true }).click();
      await picker.waitFor({ state: 'hidden' });
      assert.equal(await t.getByLabel('作业标题', { exact: true }).inputValue(), assignmentTitle);
      assert.equal(await t.getByLabel('任务说明', { exact: true }).inputValue(), '打开选题工作台后仍须保留这份未保存说明。');
      assert(await t.getByLabel('题目要求', { exact: true }).evaluate(el => el.readOnly));
      const assignmentResponse = response('/assignments');
      await t.getByRole('button', { name: '保存草稿', exact: true }).click();
      ids.assignment = (await (await assignmentResponse).json()).data.id;
      delete ids.newRubric; delete ids.changedSource; delete ids.batch; save();
      const detail = await tc('GET', '/assignments/' + ids.assignment); ids.question = detail.questions[0].id; save();
      assert.equal(detail.questions[0].bank_question_version_id, ids.bankVersion);
      assert.equal(detail.questions[0].bound_rubric_id, ids.rubric);
      pass('F11 作业选题器内独立确认题目、解答和新标准，返回后保留原作业草稿与确切版本绑定');
      // Prepare formal results via real authorized APIs; these are labelled fixture answers.
      await tc('POST', '/assignments/' + ids.assignment + '/state', { state: 'published' });
      const submission = await sc('POST', '/assignments/' + ids.assignment + '/submissions', { question_id: ids.question, answer_text: '构造学生作答：17到61全部是合法年龄，系统应该全部接受。', request_id: crypto.randomUUID() });
      ids.submission = submission.id; save();
      const grade = await tc('POST', '/submissions/' + submission.id + '/revisions', { score: 4, feedback: '构造正式结果：范围外合法性有误。', rubric_id: ids.rubric, request_id: crypto.randomUUID(), points: [{ criterion_id: 'D1', score: 4, feedback: '范围外不应全部接受', quote: '系统应该全部接受' }] });
      for (const state of ['confirmed', 'released']) await tc('POST', '/revisions/' + grade.id + '/state', { state });
      for (const view of ['overview', 'students', 'evidence', 'gaps']) {
        await go('dashboard', { view }); await t.getByRole('tab', { name: '评分缺口', exact: true }).waitFor();
        if (view === 'gaps') await t.getByText('共性问题分析', { exact: true }).waitFor();
        else assert.equal(await t.getByText('共性问题分析', { exact: true }).count(), 0);
      }
      pass('F08 看板四页签各自展示，只有评分缺口页签挂载共性诊断');
      await choose(t.getByLabel('分析题目与标准', { exact: true }), `${assignmentTitle} · ${bank.prompt.slice(0, 55)} · 标准v1`);
      await t.getByRole('button', { name: '分析正式失分作答', exact: true }).click();
      const diagnosis = await until('diagnosis actual worker', async () => { const rows = await tc('GET', '/intelligence?kind=diagnosis'); return rows[0] ? tc('GET', '/intelligence/' + rows[0].id) : {}; }, v => v.report?.job_state === 'succeeded');
      ids.diagnosis = diagnosis.report.id; save();
      assert(diagnosis.report.input.answers.some(a => a.submission_id === ids.submission), 'diagnosis selected a different assignment question');
      await t.getByRole('button', { name: '确认本批诊断', exact: true }).waitFor();
      assert.equal(await t.getByRole('button', { name: '为此学生安排补学补练', exact: true }).count(), 0);
      await t.getByRole('button', { name: '确认本批诊断', exact: true }).click();
      await t.getByRole('button', { name: '为此学生安排补学补练', exact: true }).click();
      const taskEditor = t.getByRole('dialog');
      assert(await taskEditor.getByRole('combobox', { name: '指定学生', exact: true }).isDisabled());
      await taskEditor.getByLabel('任务标题', { exact: true }).fill('由确切诊断安排的补学任务');
      await taskEditor.getByLabel('补学资料、练习及完成要求', { exact: true }).fill('重读边界值说明，区分允许范围和范围外拒绝。');
      await choose(taskEditor.getByLabel('关联补学资料', { exact: true }), (ids.publishedTitle || '仅发布第一段的学习资料') + ' · v1');
      const taskResponse = response('/interventions');
      await taskEditor.getByRole('button', { name: '保存任务草稿', exact: true }).click();
      const task = (await (await taskResponse).json()).data; ids.task = task.id; save();
      assert.equal(task.diagnosis_report_id, ids.diagnosis); assert.equal(task.source_submission_id, ids.submission); assert.equal(task.diagnosis_label_id, 'concept'); assert.equal(task.status, 'draft');
      assert(!(await sc('GET', '/interventions')).some(v => v.id === ids.task));
      await taskEditor.getByRole('button', { name: '确认下发', exact: true }).click();
      await until('assigned task', () => sc('GET', '/interventions'), rows => rows.some(v => v.id === ids.task && v.status === 'assigned'));
      await shot('diagnosis-task');
      pass('F09 已确认诊断按作答就地建任务，报告/标签/学生严格关联；草稿对学生隐藏，单独下发后可见');
      await taskEditor.locator('.ant-drawer-close').click();
      await t.reload();
      assert.equal(new URL(t.url()).searchParams.get('diagnosis_report'), ids.diagnosis);
      await t.getByText('教师已确认', { exact: true }).waitFor();
      pass('F13 诊断报告选择刷新恢复');
    }
    if (phase === 'impact') {
      const currentAssignment = await tc('GET', '/assignments/' + ids.assignment);
      if (currentAssignment.assignment.status !== 'closed') await tc('POST', '/assignments/' + ids.assignment + '/state', { state: 'closed' });
      if (!ids.newRubric) {
        const rubric = await tc('POST', '/question-bank/versions/' + ids.bankVersion + '/rubrics', { criteria: [{ id: 'D1', title: '测试目的', max_score: 10, rule: '构造更正规则：按范围内外区别明确程度给部分分。' }] });
        await tc('POST', '/rubrics/' + rubric.id + '/confirm', {}); ids.newRubric = rubric.id; save();
      }
      if (!ids.changedSource) {
      await go('materials', { source: ids.source, source_view: 'original' });
      await t.getByRole('button', { name: '上传原件新版本', exact: true }).click();
      await selectFile(t.getByRole('button', { name: '课程文件', exact: true }), { name: `更正后的边界讲义-${ids.source.slice(0,8)}.txt`, mimeType: 'text/plain', buffer: Buffer.from(`更正后的构造讲义：区间外应当拒绝。保留旧讲义与原评分历史。本次更正来源${ids.source}。`) });
      await t.getByLabel('资料来源', { exact: true }).fill('构造验收原件v2，不代表正式课程修订');
      await t.getByRole('checkbox', { name: '允许从本资料提炼知识候选', exact: true }).check();
      await t.getByRole('button', { name: '上传并解析', exact: true }).click();
      await t.getByRole('button', { name: '查看此文件处理', exact: true }).click();
      ids.changedSource = new URL(t.url()).searchParams.get('source'); save(); assert.notEqual(ids.changedSource, ids.source);
      await until('replacement parse', () => tc('GET', '/sources/' + ids.changedSource), v => v.source.parse_state === 'ready');
      assert.equal(new URL(t.url()).searchParams.get('source_view'), 'tasks');
      }
      await go('content-impact');
      const changedSource = await tc('GET', '/sources/' + ids.changedSource);
      await t.locator('.live-row').filter({ has: t.getByText(changedSource.source.title, { exact: true }) }).getByRole('button', { name: '查看影响', exact: true }).click();
      await t.getByLabel('处理原因', { exact: true }).fill('更正旧讲义引用，复核本题统一评分口径。');
      await choose(t.getByLabel('处理决定', { exact: true }), '安排整组重评');
      const impact = await tc('GET', '/impact?source_id=' + ids.source);
      assert(impact.items.some(v => v.kind === 'assignment_question' && v.id === ids.question && v.parent_id === ids.assignment));
      // Duplicate prior failed test runs are retained; choose the exact assignment-question row by its link.
      const questionRow = t.locator('.live-row').filter({ has: t.locator(`a[href*="/homework/${ids.assignment}"]`) }).filter({ has: t.getByRole('button', { name: '就此题建立整组重评', exact: true }) });
      await questionRow.getByRole('button', { name: '就此题建立整组重评', exact: true }).click();
      const panel = t.getByRole('dialog');
      assert((await panel.getByLabel('重评原因', { exact: true }).inputValue()).includes(ids.changedSource));
      const payloads = [];
      t.on('request', req => { if (req.method() === 'POST' && new URL(req.url()).pathname.endsWith('/regrades')) payloads.push(req.postDataJSON()); });
      await choose(panel.getByLabel('统一新标准', { exact: true }), '标准 v2 · 测试目的');
      await panel.getByRole('button', { name: '预览范围', exact: true }).click();
      await panel.getByRole('button', { name: '确认冻结并建立批次', exact: true }).waitFor();
      assert.equal(payloads.at(-1).question_id, ids.question);
      await choose(panel.getByLabel('统一新标准', { exact: true }), '标准 v1 · 测试目的');
      assert.equal(await panel.getByRole('button', { name: '确认冻结并建立批次', exact: true }).count(), 0);
      await choose(panel.getByLabel('统一新标准', { exact: true }), '标准 v2 · 测试目的');
      await panel.getByRole('button', { name: '预览范围', exact: true }).click();
      const batchResponse = response('/regrades');
      await panel.getByRole('button', { name: '确认冻结并建立批次', exact: true }).click();
      ids.batch = (await (await batchResponse).json()).data.id; save();
      await panel.getByRole('button', { name: '整组发布', exact: true }).waitFor();
      assert(await panel.getByRole('button', { name: '整组发布', exact: true }).isDisabled());
      assert.equal((await sc('GET', '/submissions/' + ids.submission)).revisions[0].score, 4);
      await panel.getByLabel('得分', { exact: true }).fill('8');
      await panel.getByLabel('学生原文引用', { exact: true }).fill('系统应该全部接受');
      await panel.getByLabel('逐点反馈', { exact: true }).fill('构造复核：澄清部分分口径后更正为8分。');
      await panel.getByLabel('总反馈', { exact: true }).fill('构造整组重评结果。');
      await panel.getByRole('button', { name: '确认本份', exact: true }).click();
      await until('regrade confirmed', () => tc('GET', '/regrades/' + ids.batch), v => v.items.every(i => i.confirmed));
      await panel.getByRole('button', { name: '整组发布', exact: true }).click(); await confirm();
      await until('atomic feedback released', () => sc('GET', '/submissions/' + ids.submission), v => v.revisions[0].score === 8 && v.revisions.length >= 2);
      await shot('impact-regrade');
      pass('F10 原件版本变更按确切作业题目同页发起重评；切换标准使预览失效，冻结/复核/发布分离且旧成绩保留');
      await panel.locator('.ant-drawer-close').click();
      // Save the decision separately: regrade publication must not pretend to record an impact decision.
      await t.getByRole('button', { name: '保存处理决定', exact: true }).click();
      await t.reload();
      assert.equal(new URL(t.url()).searchParams.get('change'), ids.changedSource);
      await t.getByLabel('处理原因', { exact: true }).waitFor();
      await go('insight', { view: 'gaps', diagnosis_report: ids.diagnosis });
      await t.getByText(/正式结果已变化/).waitFor();
      assert.equal(await t.getByRole('button', { name: '为此学生安排补学补练', exact: true }).count(), 0);
      pass('F09/F13 影响对象刷新恢复；正式评分更新后旧诊断过期且不能继续安排任务');
    }
    if (phase === 'interaction') {
      const thread = await tc('POST', '/interactions', { kind: 'discussion', title: '就地回复构造讨论 ' + Date.now(), content: '这条原帖应始终与回复编辑框相邻。' });
      await go('interaction');
      const card = t.locator('.ant-card').filter({ has: t.getByText(thread.title, { exact: true }) });
      await card.getByRole('button', { name: '回复', exact: true }).click();
      await card.getByLabel('回复内容', { exact: true }).fill('保留的线程回复草稿');
      await card.getByRole('button', { name: '收起回复', exact: true }).click();
      await card.getByRole('button', { name: '回复', exact: true }).click();
      assert.equal(await card.getByLabel('回复内容', { exact: true }).inputValue(), '保留的线程回复草稿');
      await card.getByRole('button', { name: '发布回复', exact: true }).click();
      await card.locator('blockquote').getByText('保留的线程回复草稿', { exact: true }).waitFor();
      assert.equal(await card.getByLabel('回复内容', { exact: true }).count(), 0);
      const posts = await tc('GET', '/interactions');
      assert(posts.some(p => p.parent_id === thread.id && p.content === '保留的线程回复草稿'));
      pass('F15 在原讨论下编辑/收起恢复/发布回复，真实parent_id正确且不跳页首');
      await shot('inline-reply');
    }
    if (phase === 'navigation') {
      const teacherRoutes = ['dashboard', 'materials', 'knowledge', 'question-bank', 'retrieval', 'content-impact', 'homework', 'quiz', 'regrades', 'insight', 'intervention', 'courses', 'curriculum', 'interaction', 'research', 'industry-intelligence', 'assistant', 'profile'];
      const studentRoutes = ['home', 'course-content', 'knowledge', 'retrieval', 'homework', 'quiz', 'learning', 'intervention', 'interaction', 'assistant', 'profile'];
      for (const [page, role, routes] of [[t, 'teacher', teacherRoutes], [s, 'student', studentRoutes]]) {
        for (const route of routes) {
          const status = [];
          const failed = res => { if (res.url().includes('/api/') && res.status() >= 400) status.push(res.status() + ' ' + new URL(res.url()).pathname); };
          page.on('response', failed);
          await page.goto(url(role, route));
          await page.locator('#workspace-nav .ant-menu-item').first().waitFor();
          await until('page loaded ' + route, () => page.locator('main').innerText(), v => v.trim().length > 10 && !v.includes('正在读取课程'));
          await page.waitForLoadState('networkidle');
          assert(!/页面暂时无法显示|发生错误|404|页面不存在/.test(await page.locator('main').innerText()), route);
          assert.deepEqual(status, [], `${role}/${route}`);
          page.off('response', failed);
        }
        pass(`${role} ${routes.length}个导航与原路由实际加载，无4xx/5xx及页面异常`);
      }
      await go('materials', { search: '协同' });
      await t.getByLabel('搜索原始资料', { exact: true }).waitFor();
      await t.locator('.material-object-list .rag-source').first().click();
      await t.getByLabel('搜索原始资料', { exact: true }).fill('不存在的资料');
      await t.goBack();
      await until('back restores filter', () => t.getByLabel('搜索原始资料', { exact: true }).inputValue(), v => v === '协同');
      await go('question-bank', { search: '选题器', state: 'confirmed', type: 'subjective', point: ids.point });
      await t.getByLabel('搜索题目', { exact: true }).waitFor(); await t.reload();
      assert.equal(await t.getByLabel('搜索题目', { exact: true }).inputValue(), '选题器');
      assert.equal(new URL(t.url()).searchParams.get('state'), 'confirmed');
      await go('knowledge', { knowledge_search: '边界', knowledge_state: 'draft' });
      await t.getByLabel('搜索知识', { exact: true }).waitFor(); await t.reload();
      assert.equal(await t.getByLabel('搜索知识', { exact: true }).inputValue(), '边界');
      pass('F13 原件后退恢复、题库和知识筛选刷新恢复');
      const cases = [
        ['materials', { source: ids.source, source_view: 'original' }, '发布标题'],
        ['materials', { source: ids.source, source_view: 'knowledge' }, '搜索知识'],
        ['materials', { tab: 'published', resource: ids.manual }, null],
        ['insight', { view: 'gaps', diagnosis_report: ids.diagnosis }, '分析历史'],
        ['content-impact', { change: ids.changedSource, change_kind: 'source' }, '处理原因'],
        ['question-bank', { bank_version: ids.bankVersion }, '题目版本'],
      ];
      for (const width of [1440, 375, 812]) {
        await t.setViewportSize({ width, height: width === 812 ? 375 : 1000 });
        for (const [route, params, label] of cases) {
          await go(route, params);
          if (label) await t.getByLabel(label, { exact: true }).first().waitFor();
          else await t.getByRole('button', { name: '助理协作', exact: true }).first().waitFor();
          await t.evaluate(() => document.fonts.ready);
          assert(await t.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${route} horizontal overflow at ${width}`);
          if (width !== 812) await shot(`${route}-${params.source_view || params.view || params.tab || 'detail'}-${width}`);
        }
        await go('materials', { tab: 'published', resource: ids.manual });
        await t.getByRole('button', { name: '助理协作', exact: true }).click();
        const drawer = t.getByRole('dialog');
        await drawer.getByLabel('消息', { exact: true }).waitFor();
        assert(await drawer.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `Agent drawer horizontal overflow at ${width}`);
        await drawer.getByLabel('消息', { exact: true }).fill('小屏输入仍可操作');
        await drawer.getByRole('button', { name: '发送', exact: true }).scrollIntoViewIfNeeded();
        assert(await drawer.getByRole('button', { name: '发送', exact: true }).isVisible());
        await drawer.getByLabel('消息', { exact: true }).fill('');
        await shot(`agent-${width}`);
        await drawer.locator('.ant-drawer-close').click();
        if (await t.locator('.ant-modal-confirm').count()) await confirm();
      }
      pass('1440px桌面、375px窄屏、812×375横屏：关键工作区无整页横向溢出，助理输入与发送可操作');
      await t.setViewportSize({ width: 1440, height: 1000 });
      await t.route('**/retrieval/status**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { configured: true, indexed: false, object_index: { keyword_chunks: 0, vector_chunks: 0 }, latest_index_job: { state: 'failed', error: '验收注入：索引暂不可用', created_at: new Date().toISOString() } } }) }));
      await go('materials', { tab: 'published', resource: ids.manual });
      await t.getByText('就本资料提问', { exact: true }).click();
      await t.getByText('最近一次课程索引：失败 · 验收注入：索引暂不可用', { exact: true }).waitFor();
      await t.getByLabel('课程问题', { exact: true }).fill('边界值分析');
      await t.getByRole('button', { name: '检索依据', exact: true }).click();
      await t.locator('.rag-hit').first().waitFor();
      await t.unroute('**/retrieval/status**');
      pass('F16 浏览器注入索引失败时显示失败与零计数，正文及当前资料文内检索仍可使用');
    }
    assert.deepEqual(report.errors, []); assert.deepEqual(report.server_errors, []);
    report.passed = true;
  } catch (e) {
    report.passed = false; report.failure = e.stack;
    if (t) { await t.screenshot({ path: path.join(folder, `browser-${phase}-failure.png`), fullPage: true }).catch(() => {}); fs.writeFileSync(path.join(folder, `browser-${phase}-failure.txt`), await t.locator('body').innerText().catch(() => 'unavailable')); }
    console.error(e.stack); process.exitCode = 1;
  } finally { report.finished_at = new Date().toISOString(); save(); await browser.close(); }
})();
