const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { folder, choose, selectFile } = require('./core.cjs');
const { selectRoot } = require('../browser-ui.cjs');
const button = (p, name) => p.getByRole('button', { name, exact: true });
const label = (p, name) => p.getByLabel(name, { exact: true });
const materialTitle = '事务、并发控制与恢复';

async function course(d) {
  let p = await d.go('teacher', 'courses');
  if (!d.objects.course_id) {
    await d.step('创建数据库系统原理课程', async () => {
      await label(p, '新课程名称').fill(d.state.course_title);
      const row = await d.mutate('course.create', p, '/learning/courses', () => button(p, '新建课程').click());
      d.object('course_id', row.id);
    });
  }
  p = await d.go('teacher', 'courses');
  if (!(d.state.steps['course.member']?.state === 'done')) {
    await p.getByRole('tab', { name: '课程成员', exact: true }).click();
    await label(p, '学生用户名').fill('st');
    await d.step('加入演示学生账号', () => d.mutate('course.member', p, '/members', () => button(p, '加入课程').click()));
  }
  await d.go('teacher', 'courses', 'tab=settings');
  if (!(d.state.steps['course.publish']?.state === 'done')) await d.step('发布课程', () => d.mutate('course.publish', p, '/publish', () => button(p, '发布课程').click()));
  const chapters = ['数据模型与关系代数','SQL与模式设计','存储与索引','查询处理与优化','事务与并发控制','日志与故障恢复'];
  p = await d.go('teacher', 'curriculum');
  for (let i = 0; i < chapters.length; i++) {
    if (d.state.steps['course.chapter.' + i]?.state === 'done') continue;
    await d.step('维护课程目录 · ' + chapters[i], async () => {
      await choose(label(p, '目录类型'), '章节'); await choose(label(p, '所属目录'), '顶层目录');
      await label(p, '节点名称').fill(chapters[i]);
      const row = await d.mutate('course.chapter.' + i, p, '/points', () => button(p, '添加节点').click());
      if (i === 4) d.object('chapter_id', row.id);
    });
  }
  for (const title of ['事务隔离与并发异常','锁与死锁','WAL与故障恢复']) {
    const key = 'course.point.' + title;
    if (d.state.steps[key]?.state === 'done') continue;
    await d.step('添加知识点 · ' + title, async () => {
      await choose(label(p, '目录类型'), '知识点'); await choose(label(p, '所属目录'), '事务与并发控制');
      await label(p, '节点名称').fill(title);
      const row = await d.mutate(key, p, '/points', () => button(p, '添加节点').click());
      if (title.startsWith('事务隔离')) d.object('point_id', row.id);
    });
  }
  const me = await d.read('/me', 'student'); d.object('student_id', me.user?.id || me.id); d.object('student_name', me.user?.display_name || me.display_name);
  return d.database(['courses','knowledge_points','enrollments']);
}
async function materials(d) {
  let jobs = d.state.steps['materials.upload']?.result;
  if (!jobs) {
    const p = await d.go('teacher', 'materials');
    await button(p, '导入资料').click();
    const drawer = p.getByRole('dialog', { name: '导入资料', exact: true });
    await d.step('上传自编数据库讲义并提交真实解析', async () => {
      await selectFile(button(drawer, '课程文件'), path.join(__dirname, 'course.md'));
      await label(drawer, '资料来源').fill('数据库系统原理课程自编讲义；自动演示使用的教学材料，非真实学生资料。');
      await drawer.getByLabel('允许从本资料提炼知识候选', { exact: true }).check();
      jobs = await d.mutate('materials.upload', p, '/sources', () => button(drawer, '上传并解析').click());
    });
  }
  for (const job of jobs) await d.job(job);
  const source = (await d.api('/sources')).find(s => s.filename === 'course.md'); assert(source, '原件未保存'); d.object('source_id', source.id);
  const details = await d.api('/sources/' + source.id); assert(details.fragments?.length > 0, '没有解析片段');
  if (!d.state.steps['materials.publish']?.result) {
    const p = await d.go('teacher', 'materials', 'source=' + source.id);
    await d.step('核对解析片段并发布完整学习资料', async () => {
      await button(p, '选择已核对片段').click();
      await label(p, '发布标题').fill(materialTitle);
      await p.getByLabel('发布完整原件（须选中全部片段）', { exact: true }).check();
      const row = await d.mutate('materials.publish', p, '/sources/' + source.id + '/publish', () => button(p, '确认并发布到课程学习').click());
      d.object('resource_id', row.id);
    });
  }
  if (!d.objects.resource_id) d.object('resource_id', d.state.steps['materials.publish'].result.id);
  await d.step('构建真实向量索引', () => d.index('materials.index'));
  return d.database(['material_sources','material_fragments','resources','retrieval_chunks','chunk_embeddings']);
}
async function knowledge(d) {
  let job = d.state.steps['knowledge.extract']?.result;
  if (!job) {
    const p = await d.go('teacher', 'materials', 'source=' + d.objects.source_id);
    const fragments = p.locator('.rag-fragments > article').filter({ hasText: /3\.2 不可重复读|3\.3 幻读|六、日志与恢复/ });
    const checkboxes = fragments.locator('input[type=checkbox]');
    await checkboxes.first().waitFor();
    for (let i = 0; i < Math.min(await checkboxes.count(), 5); i++) await checkboxes.nth(i).check();
    job = await d.step('AI根据原文提炼知识候选', () => d.mutate('knowledge.extract', p, '/jobs', () => button(p, 'AI提炼知识候选').click()));
  }
  await d.job(job);
  const rows = (await d.api('/knowledge')).filter(k => k.origin !== 'teacher_example'); assert(rows.length, 'AI未生成可核对知识');
  d.object('knowledge_ids', rows.map(k => k.id));
  for (const k of rows.slice(0, 4)) {
    const p = await d.go('teacher', 'knowledge');
    const card = p.locator('#knowledge-' + k.id);
    if (!d.state.steps['knowledge.edit.' + k.id]?.result) {
      await d.step('核对知识用途与课程关联 · ' + k.title, async () => {
        await button(card, '编辑候选').click();
        const editor = p.getByRole('dialog');
        await label(editor, '学生可见').check(); await label(editor, '用于学习检索').check();
        const select = editor.getByRole('combobox', { name: '关联课程知识点', exact: true });
        if (!(k.knowledge_point_ids || []).includes(d.objects.point_id)) {
          await select.click();
          await p.locator('.ant-select-dropdown:visible').getByText('事务隔离与并发异常', { exact: true }).click(); await select.press('Escape');
        }
        await d.mutate('knowledge.edit.' + k.id, p, '/knowledge/' + k.id, () => button(editor, '保存待审核版本').click(), 'PUT');
        await editor.waitFor({ state: 'hidden' });
      });
    }
    if (!d.state.steps['knowledge.confirm.' + k.id]?.result) await d.step('确认知识 · ' + k.title, () => d.mutate('knowledge.confirm.' + k.id, p, '/knowledge/' + k.id + '/state', () => button(card, '确认知识').click()));
  }
  if (!d.state.steps['knowledge.example']?.result) {
    const p = await d.go('teacher', 'knowledge');
    await button(p, '新建知识').click();
    const editor = p.getByRole('dialog');
    await choose(label(editor, '内容来源'), '教师自编教学示例');
    await label(editor, '标题').fill('双连接锁等待与死锁实验');
    await label(editor, '知识正文').fill('教师自编实验：建立两个连接和可恢复的A、B两行数据。连接一先更新A，连接二先更新B，再分别尝试更新另一行。记录每条语句、等待和回滚结果，对比两个连接统一按A、B顺序更新的情况。未复现死锁不能证明死锁不存在。');
    await label(editor, '适用条件与限制').fill('独立教学环境；具体锁行为需结合数据库产品、版本和事务设置核验，不作为评分依据。');
    await label(editor, '学生可见').check();
    const select = editor.getByRole('combobox', { name: '关联课程知识点', exact: true }); await select.click();
    await p.locator('.ant-select-dropdown:visible').getByText('锁与死锁', { exact: true }).click(); await select.press('Escape');
    const example = await d.step('保存独立的教师自编锁实验提示', () => d.mutate('knowledge.example', p, '/knowledge', () => button(editor, '保存待审核版本').click()));
    d.object('example_id', example.id);
    await editor.waitFor({ state: 'hidden' });
  }
  const exampleID = d.state.steps['knowledge.example'].result.id;
  if (!d.state.steps['knowledge.example.confirm']?.result) {
    const p = await d.go('teacher', 'knowledge');
    await d.step('确认自编教学示例，仅用于学习', () => d.mutate('knowledge.example.confirm', p, '/knowledge/' + exampleID + '/state', () => button(p.locator('#knowledge-' + exampleID), '确认知识').click()));
  }
  await d.step('为已确认知识更新索引', () => d.index('knowledge.index'));
  return d.database(['knowledge_entries','retrieval_chunks','chunk_embeddings']);
}
async function questions(d) {
  let p = await d.go('teacher', 'question-bank', 'new=1&source_id=' + d.objects.source_id);
  let job = d.state.steps['questions.generate']?.result;
  if (!job) {
    await label(p, '依据检索词').fill('不可重复读 隔离级别 双连接');
    await button(p, '查找依据').click();
    const checks = p.locator('.bank-evidence .rag-hit input[type=checkbox]'); await checks.first().waitFor();
    for (let i = 0; i < Math.min(await checks.count(), 4); i++) await checks.nth(i).check();
    await label(p, 'AI出题要求').fill('生成一道10分主观题，必须使用以下确定情境：T1在同一事务第一次读到账户余额1000元；T2把同一行余额改为900元并提交；T1再次读到900元。要求识别并发异常、说明为何不是脏读、比较读已提交与可重复读、给出双连接验证步骤。不要把隔离级别的标准语义与具体数据库实现混为一谈。评分点分别覆盖上述四部分，总分10分。');
    job = await d.step('AI生成题目、参考解答和评分标准', () => d.mutate('questions.generate', p, '/question-bank/jobs', () => button(p, 'AI出题').click()));
  }
  const finished = await d.job(job);
  let version = d.state.steps['questions.save']?.result;
  if (!version) {
    await label(p, 'AI出题要求').fill(finished.input.requirements);
    if (!await p.locator('.bank-evidence .rag-hit input[type=checkbox]').count()) {
      await label(p, '依据检索词').fill('不可重复读 隔离级别 双连接');
      await button(p, '查找依据').click();
      for (const ref of finished.input.evidence_refs || []) {
        const hit = p.locator('.bank-evidence .rag-hit').filter({ has: p.getByText(ref.body, { exact: true }) });
        await hit.locator('input[type=checkbox]').check();
      }
    }
    // Keep the original generation conditions in the editor so stale candidates cannot be adopted.
    await button(p, '载入编辑区').waitFor();
    await button(p, '载入编辑区').click();
    const modal = p.getByRole('dialog').filter({ hasText: '载入AI候选并替换当前编辑？' });
    await button(modal, '确认').click();
    await label(p, '题目名称').fill('同一事务两次读取余额变化的分析');
    await choose(label(p, '关联知识点'), '事务隔离与并发异常');
    version = await d.step('保存题目与标准候选', () => d.mutate('questions.save', p, '/question-bank', () => button(p, '保存题目草稿').click()));
  }
  d.object('bank_id', version.bank_id); d.object('bank_version_id', version.id);
  if (d.state.steps['questions.save']?.result && !p.url().includes('bank=')) p = await d.go('teacher', 'question-bank', 'bank=' + version.bank_id);
  if (!d.state.steps['questions.confirm']?.result) await d.step('确认题目版本', () => d.mutate('questions.confirm', p, '/question-bank/versions/' + version.id + '/confirm', () => button(p, '确认题目').click()));
  if (!d.state.steps['questions.answer']?.result) await d.step('独立确认参考解答', () => d.mutate('questions.answer', p, '/question-bank/versions/' + version.id + '/reference/confirm', () => button(p, '确认参考解答').click()));
  await p.getByRole('tab', { name: '评分标准', exact: true }).click();
  const rubrics = await d.api('/question-bank/versions/' + version.id + '/rubrics'); const rubric = rubrics[0]; assert(rubric, '标准草稿未保存'); d.object('rubric_id', rubric.id);
  if (!d.state.steps['questions.rubric']?.result) await d.step('逐点核对并确认评分标准', () => d.mutate('questions.rubric', p, '/rubrics/' + rubric.id + '/confirm', () => button(p, '确认标准 v1').click()));
  return d.database(['bank_question_versions','rubric_versions']);
}
async function assignments(d) {
  let p = await d.go('teacher', 'homework/new');
  let assignment = d.state.steps['assignments.homework']?.result;
  if (!assignment) {
    await label(p, '作业标题').fill('事务隔离分析与双连接验证');
    await label(p, '任务说明').fill('根据题干情境分析并发异常，区分标准语义与具体实现，写出可以复现的两连接操作顺序。');
    await button(p, '从题库选题').click();
    const picker = p.getByRole('dialog', { name: '从题库选题', exact: true });
    await choose(label(picker, '题目'), '同一事务两次读取余额变化的分析'); await button(picker, '加入作业').click();
    assignment = await d.step('保存绑定题目与标准版本的作业', () => d.mutate('assignments.homework', p, '/assignments', () => button(p, '保存草稿').click()));
  }
  d.object('assignment_id', assignment.id);
  d.object('question_id', (await d.api('/assignments/' + assignment.id)).questions[0].id);
  let quiz = d.state.steps['assignments.quiz']?.result;
  if (!quiz) {
    p = await d.go('teacher', 'quiz/new');
    await label(p, '测验标题').fill('事务隔离概念自测');
    await label(p, '题目要求').fill('T1第二次读到T2已经提交的更新，同一行两次读取不同，主要属于哪种异常？');
    await label(p, '评分标准').fill('单选题：选择“不可重复读”得10分，其余选项0分；按确认的选项规则判分。');
    await label(p, '选项（每行一个）').fill('脏读\n不可重复读\n丢失更新\n死锁');
    await choose(label(p, '正确答案'), '不可重复读');
    await choose(label(p, '关联知识点'), '事务隔离与并发异常');
    quiz = await d.step('保存客观规则测验', () => d.mutate('assignments.quiz', p, '/assignments', () => button(p, '保存草稿').click()));
  }
  d.object('quiz_id', quiz.id); d.object('quiz_question_id', (await d.api('/assignments/' + quiz.id)).questions[0].id);
  for (const [kind, row] of [['homework', assignment], ['quiz', quiz]]) {
    const detail = await d.api('/assignments/' + row.id);
    if (detail.assignment.status === 'draft') {
      p = await d.go('teacher', kind === 'quiz' ? 'quiz' : 'homework');
      const card = p.locator('.live-row').filter({ hasText: row.title });
      await d.step('发布 · ' + row.title, () => d.mutate('assignments.publish.' + kind, p, '/assignments/' + row.id + '/state', () => button(card, '发布').click()));
    }
    assert.equal((await d.api('/assignments/' + row.id)).assignment.status, 'published');
  }
  return d.database(['assignments','questions']);
}
async function submissions(d) {
  let p = await d.go('student', 'course-content', 'resource=' + d.objects.resource_id);
  await d.step('学生阅读资料、保存笔记与收藏', async () => {
    await label(p, '我的笔记').fill('区分异常时先看是否读到了未提交数据，再看同一行两次读取是否变化；隔离级别还要核对具体实现。');
    await p.getByLabel('收藏这份资料', { exact: true }).check();
    await d.mutate('submissions.note', p, '/resources/' + d.objects.resource_id + '/note', () => button(p, '保存笔记与收藏').click(), 'PUT');
  });
  const answer = 'T1在同一事务里先读1000元、后读900元，这是不可重复读。因为T2在T1第二次读取之前已经提交，所以不是脏读。其余部分我认为可以给所有操作加锁，事务会自动解决并发问题。';
  d.object('answer_text', answer);
  if (!d.state.steps['submissions.answer']?.result) {
    p = await d.go('student', 'homework/' + d.objects.assignment_id);
    await label(p, '我的作答').fill(answer);
    const draft = await d.mutate('submissions.draft', p, '/draft', () => button(p, '保存作答草稿').click(), 'PUT');
    assert.equal(draft.answer_text, answer, '服务端保存的草稿与输入不同');
    await button(p, '提交本题').click();
    const row = await d.step('学生提交主观作答并保存不可变原文', () => d.mutate('submissions.answer', p, '/assignments/' + d.objects.assignment_id + '/submissions', () => button(p, '确认提交').click()));
    d.object('submission_id', row.id);
  } else d.object('submission_id', d.state.steps['submissions.answer'].result.id);
  if (!d.state.steps['submissions.quiz']?.result) {
    p = await d.go('student', 'homework/' + d.objects.quiz_id);
    await p.getByRole('radio', { name: '不可重复读', exact: true }).check(); await button(p, '提交本题').click();
    const row = await d.step('提交客观测验并读取真实规则判分', () => d.mutate('submissions.quiz', p, '/assignments/' + d.objects.quiz_id + '/submissions', () => button(p, '确认提交').click()));
    d.object('quiz_submission_id', row.id);
  }
  return d.database(['learning_events','learning_notes','submissions']);
}
async function grading(d) {
  let p = await d.go('teacher', 'homework/submissions/' + d.objects.submission_id + '/grade');
  let job = d.state.steps['grading.generate']?.result;
  if (!job) job = await d.step('按绑定标准真实生成逐点评阅草稿', () => d.mutate('grading.generate', p, '/jobs', () => button(p, 'AI生成评阅草稿').click()));
  await d.job(job);
  let revision = d.state.steps['grading.save']?.result;
  if (!revision) {
    await button(p, '载入编辑区').click();
    revision = await d.step('核对逐点得分、引用与反馈后保存草稿', () => d.mutate('grading.save', p, '/submissions/' + d.objects.submission_id + '/revisions', () => button(p, '保存逐点评分草稿').click()));
  }
  d.object('revision_id', revision.id);
  if (!d.state.steps['grading.confirm']?.result) await d.step('教师确认评分', () => d.mutate('grading.confirm', p, '/revisions/' + revision.id + '/state', () => button(p, '确认评分').click()));
  if (!d.state.steps['grading.release']?.result) await d.step('发布正式反馈', () => d.mutate('grading.release', p, '/revisions/' + revision.id + '/state', () => button(p, '发布正式反馈').click()));
  p = await d.go('student', 'homework/submissions/' + d.objects.submission_id + '/feedback');
  await p.getByText(d.objects.answer_text, { exact: true }).first().waitFor();
  p = await d.go('teacher', 'dashboard', 'view=evidence');
  await d.step('导出已发布的正式结果CSV', async () => {
    const downloadPromise = p.waitForEvent('download');
    await button(p, '导出当前正式结果').click();
    const download = await downloadPromise; const file = path.join(folder, d.state.id, '正式反馈.csv'); await download.saveAs(file);
    assert(fs.readFileSync(file, 'utf8').includes(d.objects.submission_id), '导出结果没有本次正式提交'); d.object('export_file', file);
  });
  return d.database(['grading_revisions','submissions']);
}
async function learning(d) {
  let p = await d.go('student', 'retrieval');
  if (!d.state.steps['learning.answer']?.result) {
    await label(p, '课程问题').fill('如何区分脏读、不可重复读和幻读？请结合讲义给出判断依据与一个时序例子。');
    await d.step('学生发起真实检索并查看原文依据', () => d.mutate('learning.search', p, '/retrieval', () => button(p, '检索依据').click()));
    const answer = await d.step('调用真实模型回答并保存引用历史', () => d.mutate('learning.answer', p, '/assist', () => button(p, '根据资料回答').click()));
    assert(answer.sources?.length, '问答没有返回资料依据');
  }
  p = await d.go('student', 'learning');
  if (!d.state.steps['learning.path']?.result) await d.step('按正式学情生成规则路径', () => d.mutate('learning.path', p, '/path', () => button(p, '生成学习路径').click()));
  let report = d.state.steps['learning.ranking']?.result;
  if (!report) report = await d.step('对规则筛选出的授权内容进行AI排序', () => d.mutate('learning.ranking', p, '/intelligence', () => button(p, 'AI排序').click()));
  const detail = await d.wait('学习推荐', () => d.api('/intelligence/' + report.id, 'student'), v => v.report.job_state === 'succeeded', v => v.report.job_state);
  assert(detail.report.output.ranking.length, '没有可推荐内容'); d.object('recommendation_id', report.id);
  await d.step('保存学生推荐偏好', () => d.mutate('learning.choice', p, '/intelligence/' + report.id + '/choice', () => button(p, '收藏').first().click(), 'PUT'));
  const saved = await d.api('/intelligence/' + report.id, 'student'); assert(saved.choices.some(c => c.choice === 'saved'));
  return d.database(['assist_turns','study_paths','intelligence_reports','recommendation_choices']);
}
async function intervention(d) {
  let p = await d.go('teacher', 'dashboard', 'view=overview');
  let report = d.state.steps['intervention.diagnosis']?.result;
  if (!report) {
    const q = (await d.api('/assignments/' + d.objects.assignment_id)).questions[0];
    await choose(label(p, '分析题目与标准'), `${q.prompt.slice(0,55)} · 标准v1`);
    report = await d.step('基于正式失分作答生成有原句的诊断', () => d.mutate('intervention.diagnosis', p, '/intelligence', () => button(p, '分析正式失分作答').click()));
  }
  const detail = await d.wait('问题诊断', () => d.api('/intelligence/' + report.id), v => v.report.job_state === 'succeeded', v => v.report.job_state);
  for (const finding of detail.report.output.findings || []) for (const e of finding.evidence) assert(d.objects.answer_text.includes(e.quote), '诊断引用不能定位');
  d.object('diagnosis_id', report.id);
  if (!d.state.steps['intervention.confirm']?.result) {
    for (let i = 0; i < (detail.report.output.findings || []).length; i++) {
      if (detail.report.output.findings[i].label_id) continue;
      const key = 'intervention.label.' + i;
      const created = d.state.steps[key]?.result;
      if (created) await choose(label(p, '问题标签' + (i + 1)), created.title);
      else await d.step('维护诊断建议标签', () => d.mutate(key, p, '/diagnosis-labels', () => button(p, '建立此标签').first().click()));
    }
    await d.step('核对证据并确认本批诊断', () => d.mutate('intervention.confirm', p, '/intelligence/' + report.id + '/confirm', () => button(p, '确认本批诊断').click()));
  }
  let task = d.state.steps['intervention.create']?.result;
  if (!task) {
    p = await d.go('teacher', 'intervention', 'new=1');
    await choose(label(p, '指定学生'), d.objects.student_name);
    await label(p, '任务标题').fill('补学：把隔离概念落实为执行时序');
    await label(p, '补学资料、练习及完成要求').fill('重读并发异常与隔离级别两节，写清两个连接的BEGIN、SELECT、UPDATE和COMMIT顺序，并解释为什么仅说“加锁”不足以完成分析。');
    await choose(label(p, '关联补学资料'), materialTitle + ' · v1');
    task = await d.step('建立关联资料的补学任务', () => d.mutate('intervention.create', p, '/interventions', () => button(p, '保存任务草稿').click()));
  }
  d.object('intervention_id', task.id);
  p = await d.go('teacher', 'intervention', 'task=' + task.id);
  if (!d.state.steps['intervention.assign']?.result) await d.step('教师确认下发补学任务', () => d.mutate('intervention.assign', p, '/interventions/' + task.id + '/state', () => button(p, '确认下发').click()));
  if (!d.state.steps['intervention.learn']?.result) {
    p = await d.go('student', 'course-content', 'resource=' + d.objects.resource_id + '&task=' + task.id);
    await d.step('学生在任务下发后完成新的资料学习', () => d.mutate('intervention.learn', p, '/resources/' + d.objects.resource_id + '/events', () => button(p, '标记完成').click()));
  }
  if (!d.state.steps['intervention.submit']?.result) {
    p = await d.go('student', 'intervention', 'task=' + task.id);
    await label(p, '执行结果与新学习证据').fill('已重新学习讲义。T1先BEGIN并SELECT得到1000；T2在另一连接UPDATE后COMMIT；T1再次SELECT得到900。T2已提交，所以不是脏读。在可重复读的一般定义下应避免同一行的两次读取变化，具体锁或快照行为仍需核对数据库实现。');
    await d.step('提交补学结果并由系统核对新证据', () => d.mutate('intervention.submit', p, '/interventions/' + task.id + '/state', () => button(p, '提交执行结果').click()));
  }
  p = await d.go('teacher', 'intervention', 'task=' + task.id);
  if (!d.state.steps['intervention.review']?.result) {
    await label(p, '复查意见').fill('本次新学习完成记录与执行说明可核对，已补充事务边界及提交顺序。此为脚本化教学演示复核，不代表独立教学效果评测。');
    await d.step('教师复查完成，闭合补学任务', () => d.mutate('intervention.review', p, '/interventions/' + task.id + '/state', () => button(p, '确认复查完成').click()));
  }
  return d.database(['intelligence_reports','interventions','learning_events']);
}
async function agent(d) {
  let p = await d.go('teacher', 'assistant', d.objects.conversation_id ? 'conversation=' + d.objects.conversation_id : '');
  if (!d.objects.conversation_id) {
    const conversation = await d.mutate('agent.conversation', p, '/agent/conversations', () => button(p, '新对话').click());
    d.object('conversation_id', conversation.id);
    await p.waitForURL(u => u.searchParams.get('conversation') === conversation.id);
  }
  const prefix = '/agent/conversations/' + d.objects.conversation_id;
  if (!d.state.steps['agent.message']?.result) {
    const file = path.join(__dirname, 'agent-material.md');
    await label(p, '消息').fill('帮我导入附件并等待解析完成，不发布、不提炼。来源说明为“数据库系统原理课程自编补充资料”，允许后续提炼。导入前请先用问题卡询问资料名称：字段key=title，标签为资料名称，text必填。回答后以该标题导入，完成后查询原文片段并报告实际原件ID。');
    await selectFile(button(p, '上传文件'), file);
    await p.locator('.agent-composer .ant-tag').filter({ hasText: 'agent-material.md' }).waitFor();
    await d.step('附件进入私有会话，真实协调者识别导入意图', () => d.mutate('agent.message', p, prefix + '/messages', () => button(p, '发送').click()));
  }
  const start = Date.now(); let previousState;
  while (Date.now() - start < 360000) {
    await d.gate();
    const snap = await d.api(prefix); const run = snap.runs[0];
    assert(run, '未创建助理运行'); d.object('agent_run_id', run.id);
    if (run.state !== previousState) { d.event('waiting', { flow: 'agent', label: '对话助理', state: run.state }); previousState = run.state; }
    if (['failed','unknown','canceled'].includes(run.state)) throw Error('助理运行 ' + run.state + ': ' + run.error);
    if (run.state === 'succeeded') {
      assert(snap.requests.some(r => r.kind === 'input' && r.state === 'answered'), '没有完成问题卡输入');
      assert(snap.requests.some(r => r.kind === 'approval' && r.state === 'answered'), '没有完成导入审批');
      assert(snap.steps.some(s => s.tool === 'source_read' && s.state === 'succeeded'), '没有读取原文核对');
      const source = (await d.api('/sources')).find(s => s.filename === 'agent-material.md');
      assert(source?.parse_state === 'ready'); d.object('agent_source_id', source.id); break;
    }
    for (const request of snap.requests.filter(r => r.state === 'pending')) {
      if (request.kind === 'input') {
        const fields = request.fields;
        if (fields?.length !== 1 || fields[0].key !== 'title' || fields[0].kind !== 'text' || fields[0].label !== '资料名称' || !fields[0].required) throw Error('助理提出计划外输入，已保留问题卡供人工处理');
        await label(p, '资料名称').fill('恢复日志与提交结果未知');
        await d.step('填写助理提出的问题卡', () => d.mutate('agent.request.' + request.id, p, '/agent/requests/' + request.id + '/respond', () => button(p, '提交回答').click()));
      } else if (request.kind === 'approval') {
        assert.equal(request.snapshot.tool, 'source_import', '计划外操作审批交由人工处理');
        assert.equal(request.snapshot.arguments.source_note, '数据库系统原理课程自编补充资料');
        assert.equal(request.snapshot.arguments.title, '恢复日志与提交结果未知');
        assert.equal(request.snapshot.arguments.allow_derived, true);
        assert(snap.attachments.some(a => a.id === request.snapshot.arguments.attachment_id && a.kind === 'upload' && a.filename === 'agent-material.md'), '审批附件不属于本次导入');
        await d.step('核对附件导入审批卡并授权本次操作', () => d.mutate('agent.request.' + request.id, p, '/agent/requests/' + request.id + '/respond', () => button(p, '确认执行').click()));
      }
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  assert(d.objects.agent_source_id, '助理尚未结束；保留原运行等待检查');
  return d.database(['agent_runs','agent_steps','agent_requests','material_sources']);
}
async function regrade(d) {
  let p = await d.go('teacher', 'question-bank', 'bank=' + d.objects.bank_id);
  await p.getByRole('tab', { name: '评分标准', exact: true }).click();
  let rubric = d.state.steps['regrade.rubric']?.result;
  if (!rubric) {
    await button(p, '复制到新标准版本').first().click();
    const rule = label(p, '给分规则').last();
    await rule.fill((await rule.inputValue()) + '；验证步骤必须区分两个连接，写清事务开始与提交位置，不能仅以“加锁”替代操作顺序。');
    rubric = await d.step('另建相同满分的澄清标准版本', () => d.mutate('regrade.rubric', p, '/question-bank/versions/' + d.objects.bank_version_id + '/rubrics', () => button(p, '保存标准草稿').click()));
  }
  d.object('regrade_rubric_id', rubric.id);
  if (!d.state.steps['regrade.rubric.confirm']?.result) await d.mutate('regrade.rubric.confirm', p, '/rubrics/' + rubric.id + '/confirm', () => button(p, '确认标准 v2').click());
  if (!d.state.steps['regrade.close']?.result) {
    p = await d.go('teacher', 'homework');
    const row = p.locator('.live-row').filter({ hasText: '事务隔离分析与双连接验证' });
    await d.step('关闭作业，保留原提交与旧正式结果', () => d.mutate('regrade.close', p, '/assignments/' + d.objects.assignment_id + '/state', () => button(row, '关闭').click()));
  }
  let batch = d.state.steps['regrade.create']?.result;
  if (!batch) {
    p = await d.go('teacher', 'regrades'); await button(p, '建立重评批次').click();
    await choose(label(p, '已关闭作业'), '事务隔离分析与双连接验证');
    const question = (await d.api('/assignments/' + d.objects.assignment_id)).questions[0];
    await selectRoot(label(p, '重评题目').and(p.getByRole('combobox'))).click();
    const questionPopup = await p.locator('.ant-select-dropdown:visible').elementHandle();
    await p.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: question.prompt.slice(0,30) }).click();
    await questionPopup.waitForElementState('hidden');
    await choose(label(p, '统一新标准'), '标准 v2 · ' + rubric.criteria.map(c => c.title).join('、'));
    await label(p, '重评原因').fill('补充双连接验证步骤的部分分口径，题干与满分不变；按统一新版标准复核整组有效提交。');
    await d.mutate('regrade.preview', p, '/regrades', () => button(p, '预览范围').click());
    batch = await d.step('冻结有效提交、哈希与评分基线', () => d.mutate('regrade.create', p, '/regrades', () => button(p, '确认冻结并建立批次').click()));
  }
  d.object('regrade_id', batch.id);
  p = await d.go('teacher', 'regrades', 'batch=' + batch.id);
  if (!d.state.steps['regrade.item']?.result) {
    const old = d.state.steps['grading.save'].result;
    for (let i = 0; i < rubric.criteria.length; i++) {
      const criterion = rubric.criteria[i]; const score = old.point_scores?.find(s => s.criterion_id === criterion.id);
      await label(p, '得分').nth(i).fill(String(score?.score || 0));
      await label(p, '学生原文引用').nth(i).fill(score?.quote || '');
      await label(p, '逐点反馈').nth(i).fill(score?.feedback || '根据新版标准逐点复核，原文未提供相应步骤则不得补推。');
    }
    await label(p, '总反馈').fill('已按澄清后的统一标准核对。保留原作答与旧评分，双连接验证步骤仍需补充。脚本化教学演示复核。');
    await d.step('逐份复核并确认本份', () => d.mutate('regrade.item', p, '/regrades/' + batch.id + '/items/' + d.objects.submission_id, () => button(p, '确认本份').click(), 'PUT'));
  }
  if (!d.state.steps['regrade.release']?.result) {
    await button(p, '整组发布').click();
    await d.step('统一发布整组新结果，旧记录继续保留', () => d.mutate('regrade.release', p, '/regrades/' + batch.id + '/state', () => button(p.getByRole('dialog'), '确认').click()));
  }
  const detail = await d.api('/regrades/' + batch.id); assert.equal(detail.batch.state, 'released');
  return d.database(['rubric_versions','regrade_batches','regrade_items','grading_revisions']);
}
async function community(d) {
  let p = await d.go('teacher', 'interaction');
  if (!d.state.steps['community.notice']?.result) {
    await label(p, '标题').fill('事务并发实验安排');
    await label(p, '内容').fill('本周使用两个数据库连接记录读写时序，提交异常判断、隔离级别说明和可执行步骤。先阅读事务、并发控制与恢复讲义。');
    await d.step('教师发布课程公告', () => d.mutate('community.notice', p, '/interactions', () => button(p, '发布').click()));
  }
  if (!d.state.steps['community.question']?.result) {
    p = await d.go('student', 'interaction');
    await label(p, '标题').fill('T2已提交为何仍是并发异常？');
    await label(p, '内容').fill('T2已经提交后T1第二次读到900，为什么还能称为不可重复读，而不是正确读取？');
    await d.step('学生提出课程问题', () => d.mutate('community.question', p, '/interactions', () => button(p, '发布').click()));
  }
  if (!d.state.steps['community.reply']?.result) {
    p = await d.go('teacher', 'interaction');
    const card = p.locator('.ant-card').filter({ has: p.getByText('T2已提交为何仍是并发异常？', { exact: true }) });
    await button(card, '回复').click();
    await label(p, '内容').fill('提交与否区分脏读；同一事务两次读取同一行发生变化区分不可重复读。读已提交允许后一种情况，需要结合隔离要求判断。');
    await d.step('教师回复并保存问题关联', () => d.mutate('community.reply', p, '/interactions', () => button(p, '发布').click()));
  }
  if (!d.state.steps['community.research']?.result) {
    p = await d.go('teacher', 'research');
    await label(p, '标题').fill('事务异常判断的教学观察');
    await label(p, '教研内容').fill('本演示使用预设作答区分异常判断、隔离解释和验证步骤。后续真实教学应以匿名样本和人工参照检查评分与反馈质量；本条不声称已验证学习效果。');
    await d.step('保存教研观察记录', () => d.mutate('community.research', p, '/research', () => button(p, '保存记录').click()));
  }
  if (!d.state.steps['community.industry']?.result) {
    p = await d.go('teacher', 'industry-intelligence');
    await label(p, '标题').fill('数据库开发能力：并发故障定位');
    await label(p, '原始来源链接').fill('https://www.postgresql.org/docs/current/transaction-iso.html');
    await label(p, '技能要求').fill('教师整理的课程能力关联：能阅读数据库隔离文档、设计双连接复现步骤、区分事务异常并说明重试与幂等边界。非岗位抓取或招聘统计。');
    await d.step('保存课程与数据库工程能力关联', () => d.mutate('community.industry', p, '/industry', () => button(p, '保存记录').click()));
  }
  return d.database(['interactions','research_records','industry_records']);
}
const pages = {course:['teacher','curriculum'], materials:['teacher','materials'], knowledge:['teacher','knowledge'], questions:['teacher','question-bank'], assignments:['teacher','homework'], submissions:['student','homework'], grading:['student','homework/submissions/'],learning:['student','learning'], intervention:['teacher','intervention'],agent:['teacher','assistant'],regrade:['teacher','regrades'],community:['teacher','interaction']};
async function show(d, id) {
  const [role, route] = pages[id];
  const extra = { materials: ['source', d.objects.source_id], knowledge: ['knowledge', d.objects.knowledge_ids?.[0]], questions: ['bank', d.objects.bank_id], intervention: ['task', d.objects.intervention_id], agent: ['conversation', d.objects.conversation_id], regrade: ['batch', d.objects.regrade_id] }[id];
  await d.go(role, id === 'grading' ? route + d.objects.submission_id + '/feedback' : route, extra ? new URLSearchParams([extra]).toString() : '');
}
module.exports = { course, materials, knowledge, questions, assignments, submissions, grading, learning, intervention, agent, regrade, community, show };
