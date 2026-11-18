/* Standalone interaction prototype. All records are examples held in page memory. */
'use strict';
const $ = (q, root = document) => root.querySelector(q);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
  home:'<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
  book:'<path d="M3 4h6a4 4 0 0 1 3 2 4 4 0 0 1 3-2h6v15h-6a4 4 0 0 0-3 2 4 4 0 0 0-3-2H3Z"/><path d="M12 6v15"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  list:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  chart:'<path d="M4 3v17h17M8 16v-4m5 4V7m5 9v-6"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-17a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v3"/>',
  chat:'<path d="M21 11a8 8 0 0 1-8 8H8l-5 3V7a4 4 0 0 1 4-4h6a8 8 0 0 1 8 8Z"/><path d="M7 8h9M7 12h6"/>',
  spark:'<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z"/>',
  file:'<path d="M14 2H5v20h14V7Z"/><path d="M14 2v6h5M8 12h8M8 16h6"/>',
  search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  plus:'<path d="M12 4v16M4 12h16"/>',
  arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  history:'<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v6l4 2"/>',
  settings:'<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3" fill="white"/><circle cx="16" cy="17" r="3" fill="white"/>',
  path:'<circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 5h8a5 5 0 0 1 0 10H9a4 4 0 0 0 0 8M5 7v7"/>',
  chevron:'<path d="m9 5 7 7-7 7"/>'
};
const icon = name => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.file}</svg>`;
const btn = (action, label, cls = 'button', extra = '') => `<button class="${cls}" data-action="${action}" ${extra}>${label}</button>`;
const tag = (text, tone = '') => `<span class="tag ${tone}">${esc(text)}</span>`;
const sourceSeed = [
  {id:'boundary', title:'边界值分析讲义', type:'MD', version:2, chapter:'03 · 软件测试', body:'边界值分析\n\n边界值分析关注输入范围边缘的取值。错误常出现在有效与无效范围的交界处，而不是范围中间。\n\n示例：年龄输入仅接受 18～60 的整数，且包含两端。应覆盖下边界及其相邻值 17、18、19，以及上边界及其相邻值 59、60、61。\n\n17 和 61 为无效值；18、19、59、60 为有效值。边界值测试不能替代类型、空值和其他等价类测试。', candidates:[
    {id:'k1',title:'边界值的选取',text:'对包含端点的整数区间，选择上下边界及各自相邻的内外取值。',quote:'应覆盖下边界及其相邻值 17、18、19，以及上边界及其相邻值 59、60、61。',confirmed:false},
    {id:'k2',title:'边界值与等价类的关系',text:'边界值测试关注区间交界处，应与类型、空值和其他等价类测试结合。',quote:'边界值测试不能替代类型、空值和其他等价类测试。',confirmed:false}
  ],published:false,history:[]},
  {id:'partition',title:'等价类划分',type:'MD',version:1,chapter:'03 · 软件测试',body:'等价类划分\n\n将输入域划分为若干等价类，从每类选择代表值进行测试。有效等价类满足输入要求，无效等价类违反输入要求。\n\n例如，年龄必须为 18～60 的整数。可按小于 18、18～60、大于 60、非整数和空值等类别设计测试。\n\n等价类的划分必须有需求依据；不能仅因两个输入得到相同结果就断言它们始终等价。',candidates:[],published:true,history:[{version:1,scope:'课程全体学生',time:'示例记录'}]},
  {id:'cases',title:'测试用例编写规范',type:'TXT',version:1,chapter:'03 · 软件测试',body:'测试用例编写规范\n\n每条测试用例包含编号、测试目的、前置条件、输入、执行步骤和预期结果。\n\n预期结果必须可判断。例如输入年龄 17 时，应显示超出允许范围的提示，并阻止提交；不能仅写“系统正常”。',candidates:[],published:false,history:[]}
];
const state = {
  role:'teacher', page:'content', contentTab:'materials', objectTab:'original', sourceId:'boundary',
  assistantOpen:innerWidth > 1050, assistantTab:'chat', selected:1, sourceSearch:'', editing:false,
  editDraft:'', assistantDraft:'', messages:{}, logs:[], courseTab:'directory',
  courseName:'软件工程', studentIndex:0, note:'', noteSaved:false, readDone:false,
  answer:'', answerSubmitted:false, replies:[], intervention:null, settingsSaved:false,
  grades:[{scores:[3,2,1],comment:'已识别上下边界；还需补充 19、59，并区分有效与无效取值。',status:'draft',saved:true},{scores:[4,2,2],comment:'取值覆盖较完整，请明确每条用例的预期结果。',status:'draft',saved:true}],
  sources:sourceSeed, knowledge:[], questionSaved:false
};
const teacherNav = [['overview','home','教学概览'],['content','book','课程内容'],['assessment','list','作业与批阅'],['insight','chart','学情与干预'],['course','users','课程管理'],['discussion','chat','交流与记录']];
const studentNav = [['tasks','home','我的任务'],['reading','book','课程学习'],['feedback','list','作业与反馈'],['path','path','学习路径'],['discussion','chat','课程交流']];
const source = () => state.sources.find(s => s.id === state.sourceId) || state.sources[0];
const currentPublished = s => s.published && (s.publishedVersion || 1) === s.version;
const currentGrade = () => state.grades[state.studentIndex];
const courseLabel = () => `${esc(state.courseName)} <span class="muted">/</span> `;
function record(text) { state.logs.unshift({text,role:state.role,time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}); }
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3500); }
function go(page) {
  state.page = page; state.selected = null; state.editing = false;
  $('#sidebar').classList.remove('open');
  history.replaceState(null, '', `#${state.role}/${page}`); render();
}
function context() {
  if (state.page === 'content' && state.contentTab === 'questions') return {key:'question',title:'边界值用例设计 · 题目与标准',detail:'草稿 · 03 软件测试',prompt:'检查题目和评分点是否一致',reply:'这道题要求列出六个边界附近取值。评分点应分别覆盖：取值完整性、有效性判断、预期结果。可先核对参考解答，再确认评分标准。'};
  if (state.page === 'content' || state.page === 'reading') return {key:source().id,title:source().title,detail:`v${state.role==='student'?(source().publishedVersion || 1):source().version} · ${state.selected === null ? '整篇资料' : `原文片段 ${state.selected + 1}`}`,prompt:'核对这段原文里的测试依据',reply:source().id==='boundary'?'对于包含端点的整数区间 18～60，下边界附近为 17、18、19，上边界附近为 59、60、61。17 和 61 超出范围。可以把“取值选取”和“有效性判断”分开核对。':'核对时先明确需求中的输入范围、类型和精度，再检查测试用例是否覆盖有效与无效情形。每一条预期结果都应有需求依据。'};
  if (state.role === 'student' && state.page === 'feedback') return {key:'my-answer',title:'边界值用例设计 · 我的作答',detail:state.answerSubmitted?'本页已提交':'本页作答草稿',prompt:'帮我理解题目要求',reply:'先从题干确定输入类型与范围，再说明所选取值的依据以及系统预期行为。助理示例不包含教师私有评分草稿，正式反馈以教师发布的结果为准。'};
  if (state.page === 'assessment') return {key:`grade-${state.studentIndex}`,title:`边界值用例设计 · 学生${state.studentIndex ? '乙' : '甲'}`,detail:'第 1 题 · 评分标准 v1',prompt:'核对作答与评分点的对应关系',reply:state.studentIndex?'当前作答已列出六个边界附近取值。请继续按标准核对有效性判断和预期结果，逐点确认后再发布。':'当前作答缺少 19、59。请按冻结的标准核对取值覆盖、有效性和预期结果；助理建议不能直接成为已发布成绩。'};
  if (state.page === 'insight') return {key:'insight',title:'边界值分析 · 失分证据',detail:'2 份示例作答 · 仅供界面演示',prompt:'根据这条证据安排补学',reply:'先安排阅读“边界值分析讲义”，再完成已有练习。下发前核对学生名单、资源版本和截止时间；后续回收新证据，不能用旧作答认定补学完成。'};
  return {key:state.page,title:(state.role === 'teacher' ? teacherNav : studentNav).find(n=>n[0]===state.page)?.[2] || '课程工作台',detail:state.courseName,prompt:'我当前有哪些待办？',reply:'可以从待办打开资料、作业或讨论。进入具体对象后，这里会携带当前资料版本、题目或学生上下文。'};
}
function head(title,subtitle,actions='') { return `<div class="page-title"><div><h1>${title}</h1><p class="sub">${subtitle}</p></div><div class="row">${actions}${btn('assistant-toggle',`${icon('spark')}<span>助理</span>`,'button assistant-toggle',`aria-expanded="${state.assistantOpen}" aria-controls="assistant"`)}</div></div>`; }
function tabs(items,current,action,cls='domain-tabs') { return `<nav class="${cls}" aria-label="${cls === 'object-tabs'?'资料内容':'功能分区'}">${items.map(([id,label])=>btn(action,label,current===id?'active':'',`data-value="${id}" aria-current="${current===id?'page':'false'}"`)).join('')}</nav>`; }
function render() {
  const nav = state.role === 'teacher' ? teacherNav : studentNav;
  $('#role').value = state.role; $('#avatar').textContent = state.role === 'teacher' ? '师' : '生';
  $('#sidebar').innerHTML = `<div class="brand"><span class="brand-mark">h</span>HaJi Mark</div><div class="course-switch"><span class="course-icon">${icon('book')}</span><span class="course-label"><b>${esc(state.courseName)}</b><br><span class="muted">2026 秋季 · 示例课程</span></span></div><div class="nav-label">${state.role === 'teacher'?'教学工作台':'学习工作台'}</div>${nav.map(([id,ico,label])=>btn('nav',`${icon(ico)}${label}${id==='content'?`<span class="count">${state.sources.flatMap(s=>s.candidates).filter(k=>!k.confirmed).length}</span>`:''}`,`nav-item ${state.page===id?'active':''}`,`data-page="${id}" ${state.page===id?'aria-current="page"':''}`)).join('')}<div class="sidebar-bottom">${btn('about',`${icon('settings')}原型说明`,'nav-item')}<p class="local-note">交互方案 · 数据为示例<br>操作仅保留在本页，刷新重置</p></div>`;
  $('#breadcrumb').innerHTML = `<span class="parent">${esc(state.courseName)}</span><span class="sep">/</span><b>${nav.find(n=>n[0]===state.page)?.[2] || '工作台'}</b>`;
  $('#task-center').innerHTML = `${icon('history')}<span>操作记录${state.logs.filter(l=>l.role===state.role).length?` · ${state.logs.filter(l=>l.role===state.role).length}`:''}</span>`;
  const screens = {content:renderContent,overview:renderOverview,assessment:renderAssessment,insight:renderInsight,course:renderCourse,discussion:renderDiscussion,tasks:renderTasks,reading:renderReading,feedback:renderFeedback,path:renderPath};
  $('#workspace').innerHTML = (screens[state.page] || renderContent)();
  renderAssistant();
}
function sourceItems() {
  const found = state.sources.filter(s=>s.title.toLowerCase().includes(state.sourceSearch.toLowerCase()));
  return found.map(s=>btn('source',`<span class="file-icon ${s.type==='MD'?'md':''}">${icon('file')}</span><span><span class="name">${esc(s.title)}</span><span class="meta">${esc(s.type)} · v${s.version}</span>${tag(currentPublished(s)?'已发布':s.candidates.some(k=>!k.confirmed)?'待核对':'草稿',currentPublished(s)?'green':'amber')}</span>`,`source-item ${s.id===state.sourceId?'selected':''}`,`data-id="${s.id}" aria-pressed="${s.id===state.sourceId}"`)).join('') || '<p class="empty">未找到资料</p>';
}
function renderContent() {
  let body;
  if (state.contentTab==='knowledge') body = renderLibrary();
  else if (state.contentTab==='questions') body = renderQuestion();
  else body = renderMaterial();
  return head('课程内容','03 软件测试 · 资料、知识与题目',btn('import',`${icon('plus')}导入资料`,'button primary')) + tabs([['materials','资料'],['knowledge','知识库'],['questions','题目与标准']],state.contentTab,'content-tab') + body;
}
function renderMaterial() {
  const s = source(), pending = s.candidates.filter(k=>!k.confirmed).length;
  let body = state.objectTab==='candidates' ? renderCandidates(s) : state.objectTab==='publication' ? renderPublication(s) : renderDocument(s);
  return `<section class="workbench" aria-label="资料工作区"><aside class="object-list" aria-label="资料列表"><div class="list-head"><span>本章资料 · ${state.sources.length}</span>${icon('book')}</div><div class="search">${icon('search')}<input id="source-search" aria-label="搜索资料" placeholder="搜索本章资料" value="${esc(state.sourceSearch)}"></div><div id="source-items">${sourceItems()}</div><div class="file-footer">原件和学习内容分别管理<br>示例状态仅用于交互演示</div></aside><div class="object-main"><div class="object-title"><div><h2>${esc(s.title)}</h2><div class="object-meta"><span>${esc(s.type)} 原文</span><span>·</span><span>当前修订 v${s.version}</span><span>·</span><span>教师可编辑</span></div></div>${tag(currentPublished(s)?'本地已发布':'待发布',currentPublished(s)?'green':'amber')}</div>${tabs([['original','原文核对'],['candidates',`知识候选${pending?` (${pending})`:''}`],['publication','发布与引用']],state.objectTab,'object-tab','object-tabs')}<div class="processing"><span class="done">${icon('check')} 原文就绪</span><span class="divider"></span><span class="${pending?'current':'done'}">${pending?`${pending} 条候选待核对`:'知识已核对 / 无候选'}</span><span class="divider"></span><span>检索索引：未连接</span></div>${body}</div></section>`;
}
function renderDocument(s) {
  if (state.editing) return `<form id="source-edit" class="stack"><label class="field"><span>原文内容</span><textarea name="body" id="source-editor" rows="15" required>${esc(state.editDraft)}</textarea><span class="hint">修改保存为新修订；已有知识候选需重新核对。</span></label><div class="row">${btn('cancel-edit','取消','button')}<button class="button primary" type="submit">保存修订</button></div></form>`;
  const parts = s.body.split(/\n\s*\n/);
  return `<article class="document"><h3>${esc(parts[0])}</h3>${parts.slice(1).map((p,i)=>`<div class="fragment ${state.selected===i?'selected':''}" role="button" tabindex="0" data-action="fragment" data-index="${i}" aria-pressed="${state.selected===i}">${state.selected===i?'<div class="fragment-mark">当前引用片段</div>':''}<p>${esc(p).replace(/\n/g,'<br>')}</p></div>`).join('')}${s.id==='boundary'&&s.version===2?'<table class="inline-table"><thead><tr><th scope="col">边界</th><th scope="col">外侧</th><th scope="col">边界值</th><th scope="col">内侧</th></tr></thead><tbody><tr><td>下边界</td><td>17（无效）</td><td>18（有效）</td><td>19（有效）</td></tr><tr><td>上边界</td><td>61（无效）</td><td>60（有效）</td><td>59（有效）</td></tr></tbody></table>':''}<div class="selection-hint">选择原文片段，可在右侧就当前内容提问。</div></article><div class="object-bottom"><div class="save-row"><span class="muted">${s.chapter} · ${currentPublished(s)?'当前修订已开放给学生':'当前修订仅教师可见'}</span><div class="row wrap">${btn('edit-source','编辑原文')}${btn('object-tab',s.candidates.length?'核对知识候选':'查看发布设置','button',`data-value="${s.candidates.length?'candidates':'publication'}"`)}${btn('publish-preview','预览发布','button primary')}</div></div><p class="object-note">发布学习内容与确认知识分别操作；索引未连接，不能用于真实检索。</p></div>`;
}
function renderCandidates(s) {
  if (!s.candidates.length) return `<div class="empty">当前资料没有知识候选。<br>原型未连接提炼服务。</div>${btn('object-tab','返回原文','button', 'data-value="original"')}`;
  return `<div>${s.candidates.map(k=>`<article class="candidate"><div class="row spread wrap"><h3>${esc(k.title)}</h3>${tag(k.confirmed?'已确认入库':'待教师核对',k.confirmed?'green':'amber')}</div><p>${esc(k.text)}</p><div class="evidence-quote"><b>原文依据 · v${s.version}</b><br>“${esc(k.quote)}”</div><div class="row wrap">${btn('locate-evidence','定位原文','link-button',`data-id="${k.id}"`)}${!k.confirmed?btn('edit-candidate','修改候选','button small',`data-id="${k.id}"`)+btn('confirm-candidate','确认入库','button primary small',`data-id="${k.id}"`):'<span class="muted small">仅在本页知识库中保存</span>'}</div></article>`).join('')}</div><div class="object-bottom"><div class="save-row"><span class="muted">${s.candidates.filter(k=>k.confirmed).length} / ${s.candidates.length} 条已确认</span>${btn('publish-preview','预览发布学习内容','button primary')}</div></div>`;
}
function renderPublication(s) {
  return `<div class="stack"><label class="field"><span>所属目录</span><input value="${esc(s.chapter)}" readonly></label><div class="row spread"><div><h3>学生学习内容</h3><p class="hint">发布完整的当前文本修订，不包含教师私有候选和对话。</p></div>${tag(currentPublished(s)?'本地已发布':s.published?'有新修订待发布':'尚未发布',currentPublished(s)?'green':'amber')}</div><div class="row spread"><div><h3>检索索引</h3><p class="hint">本原型未连接后台与检索服务。</p></div>${tag('未连接')}</div>${btn('publish-preview','查看发布预览','button primary')}<h3 class="m-t-15">发布记录</h3><div class="timeline">${s.history.length?s.history.map(h=>`<div><strong>v${h.version} · ${esc(h.scope)}</strong>${esc(h.time)} · ${h.time==='示例记录'?'预置示例':'仅本页演示'}</div>`).join(''):'<p class="hint">暂无发布记录</p>'}</div></div>`;
}
function renderLibrary() {
  const confirmed = state.knowledge.map(k=>({...k,source:state.sources.find(s=>s.id===k.sourceId)}));
  return `<section class="panel"><div class="panel-head"><h2>已确认知识 <span class="muted small">${confirmed.length} 条</span></h2>${tag('本页数据')}</div><div class="panel-body">${confirmed.length?confirmed.map(k=>`<article class="candidate"><div class="row spread wrap"><h3>${esc(k.title)}</h3>${btn('open-knowledge-source','打开来源','button small',`data-id="${k.source.id}" data-knowledge="${k.id}"`)}</div><p>${esc(k.text)}</p><div class="hint">来源：${esc(k.source.title)} · v${k.version} · 检索索引未连接</div></article>`).join(''):`<div class="empty">还没有已确认的知识。<br>在资料中核对候选后，知识会出现在这里。</div>${btn('content-tab','去核对资料','button', 'data-value="materials"')}`}</div></section>`;
}
function renderQuestion() {
  return `<section class="panel"><div class="panel-head"><div><h2>边界值用例设计</h2><p class="hint">第 03 章 · 简答题 · ${state.questionSaved?'本地草稿已保存':'示例草稿'}</p></div>${tag('未发布','amber')}</div><form id="question-form" class="panel-body"><label class="field"><span>题干</span><textarea name="question" rows="3" required>${esc(state.question || '某系统只接受 18～60 岁的整数年龄（包含端点）。请用边界值分析列出测试输入，标明有效性，并说明预期结果。')}</textarea></label><label class="field"><span>参考解答</span><textarea name="answer" rows="3" required>${esc(state.reference || '测试输入为 17、18、19、59、60、61。17、61 无效，应提示范围错误并阻止提交；其他值有效，应允许继续。')}</textarea></label><h3 class="m-b-15">评分标准 · v1</h3>${[['取值完整性','覆盖六个边界附近取值','4'],['有效性判断','区分 17、61 与有效值','3'],['预期结果','写明接收或拒绝行为','3']].map(r=>`<div class="rubric-row row spread"><div><b class="small">${r[0]}</b><p class="hint">${r[1]}</p></div><span class="small">${r[2]} 分</span></div>`).join('')}<div class="row spread m-t-15"><p class="hint">本地示例草稿；不会替换已发布标准。</p><button class="button primary" type="submit">保存题目草稿</button></div></form></section>`;
}
function renderOverview() {
  return head('教学概览','软件测试 · 当前待办') + `<section class="panel"><div class="panel-head"><h2>需要继续处理</h2>${tag('示例数据')}</div><div class="panel-body">${todo('book','边界值分析讲义','2 条知识候选待核对 · 当前修订 v2','进入资料','open-material')}${todo('list','作业 03 · 边界值用例设计','2 份示例提交 · 评分草稿尚未发布','继续批阅','open-grading')}${todo('chart','边界值取值覆盖不完整','从作答证据安排补学，保留学生与知识点上下文','查看证据','open-insight')}</div></section><section class="panel"><div class="panel-head"><h2>最近操作</h2></div><div class="panel-body">${logList()}</div></section>`;
}
function todo(ico,title,sub,label,action) { return `<div class="item-row"><div class="todo-icon">${icon(ico)}</div><div class="todo-main"><h3>${esc(title)}</h3><p>${esc(sub)}</p></div>${btn(action,`${label}${icon('chevron')}`,'button')}</div>`; }
function renderAssessment() {
  const g = currentGrade(), locked = g.status!=='draft', student = state.studentIndex?'乙':'甲';
  const answers = ['17、18、60、61。17 和 61 无效，18 和 60 有效。超出范围时应提示错误。','17、18、19、59、60、61。其中 17 和 61 无效；其余有效。有效输入允许继续，无效输入提示范围错误并阻止提交。'];
  return head('作业与批阅','作业 03 / 边界值用例设计 · 第 1 题') + `<section class="workbench"><aside class="object-list" aria-label="提交队列"><div class="list-head">提交队列 · 2 份示例</div>${['甲','乙'].map((n,i)=>btn('student',`学生${n}<small>${state.grades[i].status==='released'?'反馈已发布':state.grades[i].status==='confirmed'?'已确认 · 待发布':'待批阅'}</small>`,`student-select ${i===state.studentIndex?'active':''}`,`data-index="${i}" aria-pressed="${i===state.studentIndex}"`)).join('')}</aside><div class="object-main"><div class="object-title"><div><h2>学生${student} · 第 1 次提交</h2><div class="object-meta">评分依据：题目 v1 · 评分标准 v1</div></div>${tag(g.status==='released'?'已发布':g.status==='confirmed'?'已确认':'评分草稿',g.status==='draft'?'amber':'green')}</div><section class="document"><h3>原始作答</h3><div class="evidence-quote">${answers[state.studentIndex]}</div><details><summary class="small">查看题干与参考解答</summary><p class="hint">年龄为 18～60 的整数，列出边界测试输入、有效性和预期结果。参考输入为 17、18、19、59、60、61。</p></details></section><div class="row spread m-t-15"><h3>逐点评分</h3><span><b class="big-score" id="grade-total">${g.scores.reduce((a,b)=>a+b,0)}</b><span class="score-total"> / 10</span></span></div>${[['取值完整性','六个取值覆盖情况',4],['有效性判断','两侧无效值及区间内有效值',3],['预期结果','接收 / 拒绝的明确行为',3]].map(([title,desc,max],i)=>`<label class="rubric-row row spread"><span><b class="small">${title}</b><span class="hint" style="display:block">${desc}</span></span><span class="score-input"><input aria-label="${title}得分" class="grade-input" type="number" min="0" max="${max}" step="1" data-index="${i}" value="${g.scores[i]}" ${locked?'disabled':''}> / ${max}</span></label>`).join('')}<label class="field m-t-15"><span>给学生的反馈</span><textarea id="grade-comment" rows="3" ${locked?'disabled':''}>${esc(g.comment)}</textarea></label><div class="save-row"><span class="muted" id="grade-save-status">${g.saved?'草稿已保存（本页）':'有未保存修改'}</span><div class="row wrap">${g.status==='draft'?btn('save-grade','保存草稿')+btn('confirm-grade','确认评分','button primary',g.saved?'':'disabled'):g.status==='confirmed'?btn('reopen-grade','返回修改')+btn('release-grade','预览并发布','button primary'):tag('本地发布完成','green')}</div></div></div></section>`;
}
function renderInsight() {
  return head('学情与干预','按知识点查看证据，再安排后续学习')+`<section class="panel"><div class="panel-head"><h2>边界值分析 · 取值覆盖</h2>${tag('示例观察','blue')}</div><div class="panel-body"><div class="status-strip">学生甲的示例作答只列出 17、18、60、61，缺少区间内相邻值 19、59。这是一条样例证据，不代表真实班级统计。</div><h3>作答依据</h3><div class="evidence-quote">学生甲 · 作业 03 · 第 1 题<br>“17、18、60、61。17 和 61 无效，18 和 60 有效。”</div><div class="row spread wrap"><span class="hint">关联知识：边界值的选取</span>${btn('create-intervention','安排补学补练','button primary')}</div></div></section>${state.intervention?`<section class="panel"><div class="panel-head"><h2>后续任务</h2>${tag('本地已下发','green')}</div><div class="panel-body"><h3>${esc(state.intervention.title)}</h3><p class="hint">学生甲 · 截止 ${esc(state.intervention.due)} · ${esc(state.sources.find(s=>s.id===state.intervention.sourceId).title)}</p><p class="thread-body">${esc(state.intervention.note)}</p><div class="status-strip">等待任务下发后的新学习与练习证据，尚未完成复核。</div>${btn('open-material','查看关联资料','button')}</div></section>`:''}`;
}
function renderCourse() {
  let content;
  if (state.courseTab==='members') content=`<div class="table-wrap"><table class="data-table"><thead><tr><th>成员</th><th>角色</th><th>班级</th><th>状态</th></tr></thead><tbody><tr><td>示例教师</td><td>教师</td><td>软件工程</td><td>已加入</td></tr><tr><td>学生甲</td><td>学生</td><td>软件工程 1 班</td><td>已加入</td></tr><tr><td>学生乙</td><td>学生</td><td>软件工程 1 班</td><td>已加入</td></tr></tbody></table></div>`;
  else if (state.courseTab==='settings') content=`<form id="course-form"><label class="field"><span>课程名称</span><input name="name" value="${esc(state.courseName)}" maxlength="40" required></label><label class="field"><span>学期</span><input value="2026 秋季" readonly></label><div class="row spread"><span class="hint">${state.settingsSaved?'本页设置已更新':'仅修改本页原型数据'}</span><button class="button primary" type="submit">保存设置</button></div></form>`;
  else content=`${[['01','软件过程','需求与过程模型'],['02','软件设计','模块划分与设计原则']].map(([n,title,sub])=>`<div class="item-row"><div><h3>${n} · ${title}</h3><p>${sub}</p></div>${tag('目录示例')}</div>`).join('')}<div class="item-row"><div><h3>03 · 软件测试</h3><p>${state.sources.length} 份资料 · 边界值与等价类</p></div>${btn('open-material','管理内容','button')}</div>`;
  return head('课程管理','课程结构与成员权限')+tabs([['directory','课程目录'],['members','课程成员'],['settings','课程设置']],state.courseTab,'course-tab')+`<section class="panel"><div class="panel-body">${content}</div></section>`;
}
function renderDiscussion() {
  return head(state.role==='teacher'?'交流与记录':'课程交流','软件测试 / 课堂讨论')+`<section class="panel"><div class="panel-body"><div class="row spread wrap"><h2>边界值是否一定要取相邻的两个数？</h2>${tag('讨论')}</div><p class="hint">学生乙 · 示例讨论 · 关联“边界值分析讲义”</p><div class="thread-body">如果需求是整数区间，取 17、18、19 很直观。如果输入允许小数，应该怎样选择边界附近的值？</div><div class="thread-reply"><b>示例教师</b><br>需要先明确精度。例如保留一位小数时，可以在 18 附近选择 17.9、18.0、18.1；不能脱离输入精度机械地加减 1。</div>${state.replies.map(r=>`<div class="thread-reply"><b>${r.role==='teacher'?'教师':'学生甲'} · 本页回复</b><br>${esc(r.text)}</div>`).join('')}<form id="reply-form" class="reading-note"><label class="field"><span>回复讨论</span><textarea name="reply" rows="3" placeholder="补充你的理解或继续提问…" required></textarea></label><div class="row spread"><span class="hint">回复保留在当前话题内</span><button class="button primary" type="submit">发送回复</button></div></form></div></section>`;
}
function renderTasks() {
  const available = state.intervention || {title:'复习等价类划分'};
  return head('我的任务','从任务继续阅读和练习')+`<section class="panel"><div class="panel-head"><h2>本周学习</h2>${tag('示例任务')}</div><div class="panel-body">${todo('book',available.title,state.readDone?'本页已标记阅读完成':'阅读课程资料，记录一个测试输入示例',state.readDone?'再次阅读':'继续阅读','student-reading')}${todo('list','作业 03 · 边界值用例设计',state.answerSubmitted?'本页已提交 · 等待教师反馈':'1 道简答题 · 尚未提交',state.answerSubmitted?'查看作答':'开始作答','student-answer')}</div></section>`;
}
function readableSource() { return state.sources.find(s=>s.id===state.sourceId && s.published) || state.sources.find(s=>s.published); }
function renderReading() {
  const s = readableSource(); state.sourceId=s.id;
  const text = (s.publishedBody || s.body).split(/\n\s*\n/);
  return head('课程学习','03 软件测试 · 阅读与笔记')+`<section class="panel"><div class="panel-head"><div><h2>${esc(s.title)}</h2><p class="hint">学生可见文本 · v${s.publishedVersion || 1}</p></div>${tag(state.readDone?'本页已阅读':'阅读中',state.readDone?'green':'blue')}</div><div class="panel-body"><article class="document">${text.slice(1).map((p,i)=>`<div class="fragment ${state.selected===i?'selected':''}" role="button" tabindex="0" data-action="fragment" data-index="${i}"><p>${esc(p)}</p></div>`).join('')}</article><form id="note-form" class="reading-note"><label class="field"><span>我的笔记</span><textarea name="note" id="reading-note" rows="3" placeholder="记下你的理解或疑问…">${esc(state.note)}</textarea></label><div class="row spread"><span class="hint" id="note-status">${state.noteSaved?'笔记已保存在本页':'笔记仅本人视图可见'}</span><div class="row wrap"><button type="submit" class="button">保存笔记</button>${btn('complete-reading',state.readDone?'已标记阅读完成':'标记阅读完成','button primary',state.readDone?'disabled':'')}</div></div></form></div></section>`;
}
function renderFeedback() {
  const g = state.grades[0];
  return head('作业与反馈','作业 03 / 边界值用例设计')+`<section class="panel"><div class="panel-head"><h2>第 1 题 · 简答题</h2>${tag(state.answerSubmitted?'本页已提交':'作答草稿',state.answerSubmitted?'green':'amber')}</div><form id="answer-form" class="panel-body"><p class="thread-body">某系统只接受 18～60 岁的整数年龄（包含端点）。请用边界值分析列出测试输入，标明有效性，并说明预期结果。</p><label class="field"><span>我的作答</span><textarea id="student-answer" name="answer" rows="6" placeholder="列出测试输入，并解释每个输入的预期结果…" required ${state.answerSubmitted?'readonly':''}>${esc(state.answer)}</textarea></label><div class="row spread wrap"><span class="hint">${state.answerSubmitted?'提交已保留在本页演示中':'输入保留为本页草稿，提交前可继续修改'}</span>${!state.answerSubmitted?'<button class="button primary" type="submit">预览提交</button>':''}</div></form></section>${g.status==='released'?`<section class="panel"><div class="panel-head"><h2>教师反馈 · 预置作答样例</h2><span><b class="big-score">${g.scores.reduce((a,b)=>a+b,0)}</b> / 10</span></div><div class="panel-body"><p class="thread-body">${esc(g.comment)}</p><p class="hint">针对教师批阅区的预置作答，与上方新提交独立。</p></div></section>`:'<section class="panel"><div class="panel-body"><h3>教师反馈</h3><p class="hint">暂无已发布反馈。教师草稿和助理建议对学生不可见。</p></div></section>'}`;
}
function renderPath() {
  return head('学习路径','03 软件测试 · 示例学习顺序')+`<section class="panel"><div class="panel-body"><div class="path-step"><div class="path-number">1</div><div class="path-copy"><h3>理解输入域与等价类</h3><p>阅读等价类划分，区分有效类与无效类。</p>${btn('student-reading','阅读学习资料','button')}</div>${tag(state.readDone?'本页已阅读':'待学习',state.readDone?'green':'')}</div><div class="path-step"><div class="path-number">2</div><div class="path-copy"><h3>设计边界值测试用例</h3><p>结合端点、相邻值和预期结果完成作答。</p>${btn('student-answer','进入练习','button')}</div>${tag(state.answerSubmitted?'本页已提交':'待练习',state.answerSubmitted?'green':'')}</div></div></section>`;
}
function logList() { const logs=state.logs.filter(l=>l.role===state.role); return logs.length?`<div class="timeline">${logs.map(l=>`<div><strong>${esc(l.text)}</strong>${esc(l.time)} · 本页操作</div>`).join('')}</div>`:'<div class="empty">本页暂无操作记录</div>'; }
function renderAssistant() {
  const c = context();
  $('#layout').classList.toggle('without-assistant',!state.assistantOpen);
  $('#assistant').hidden = !state.assistantOpen;
  let body;
  if (state.assistantTab==='tasks') body=`<div class="section-label">本页操作记录</div>${logList()}`;
  else if (state.assistantTab==='evidence') {
    const text = (state.page==='content'||state.page==='reading') ? (state.role==='student'?(source().publishedBody || source().body):source().body).split(/\n\s*\n/).slice(1)[state.selected ?? 0] : state.role==='student' ? (state.answer || '尚未填写作答') : state.page==='assessment' && state.studentIndex ? '学生乙作答：17、18、19、59、60、61；17 和 61 无效，其余有效。' : '学生甲作答：17、18、60、61。17 和 61 无效，18 和 60 有效。';
    body=`<div class="section-label">当前引用</div><h3>${esc(c.title)}</h3><p class="hint">${esc(c.detail)}</p><div class="evidence-quote">${esc(text || '尚未选择依据')}</div><p class="hint">这里只展示当前对象的示例依据；未执行检索。</p>`;
  } else {
    const messages = state.messages[`${state.role}:${c.key}`] || [];
    body=`<div class="chat user">${esc(c.prompt)}</div><div class="chat bot"><div class="chat-brand">${icon('spark')}课程助理</div><div class="text">${esc(c.reply)}</div><div class="disclaimer">示例回复 · 未调用模型</div>${state.page==='content' && state.contentTab==='materials'?`<div class="chat-object"><div class="row spread"><b class="small">${source().candidates.filter(k=>!k.confirmed).length} 条待核对候选</b>${tag(source().candidates.some(k=>!k.confirmed)?'待核对':'已核对',source().candidates.some(k=>!k.confirmed)?'amber':'green')}</div><p class="hint">${esc(source().title)} · v${source().version}</p>${btn('object-tab','打开候选','button', 'data-value="candidates"')}</div>`:''}<div class="quick-actions">${btn('assistant-tab','查看依据','', 'data-value="evidence"')}${(state.page==='assessment')?btn('assistant-question','核对评分建议',''):btn('assistant-question','继续核对','')}</div></div>${messages.map(m=>`<div class="chat ${m.who}">${m.who==='bot'?'<div class="chat-brand">课程助理</div>':''}<div class="text">${esc(m.text)}</div>${m.who==='bot'?'<div class="disclaimer">示例回复 · 未调用模型</div>':''}</div>`).join('')}`;
  }
  $('#assistant').innerHTML=`<div class="assistant-head"><div class="assistant-title"><span class="spark">${icon('spark')}课程助理</span>${btn('assistant-close',icon('close'),'icon-button','aria-label="收起课程助理"')}</div><nav class="assistant-tabs" aria-label="助理分区">${[['chat','助理'],['evidence','依据'],['tasks','记录']].map(([id,name])=>btn('assistant-tab',name,state.assistantTab===id?'active':'',`data-value="${id}" aria-current="${state.assistantTab===id?'page':'false'}"`)).join('')}</nav></div><div class="assistant-context"><div class="context-label">${icon('file')}当前上下文</div><b>${esc(c.title)}</b><br><span class="muted">${esc(c.detail)}</span></div><div class="assistant-body">${body}</div><form id="assistant-form" class="assistant-compose"><div class="composer"><label class="sr-only" for="assistant-message">向课程助理提问</label><textarea id="assistant-message" name="message" rows="2" placeholder="就当前对象提问…" required>${esc(state.assistantDraft)}</textarea><div class="row"><span>携带当前对象与选中依据</span><button class="button primary" type="submit">发送 ${icon('arrow')}</button></div></div><div class="compose-note">交互演示 · 未连接模型或后端服务</div></form>`;
}
function showDialog(title,body,foot='',form='') {
  const d=$('#modal');
  d.innerHTML=`${form?`<form id="${form}">`:''}<div class="dialog-head"><h2 id="modal-title">${title}</h2>${btn('modal-close',icon('close'),'icon-button','type="button" aria-label="关闭弹窗"')}</div><div class="dialog-body">${body}</div><div class="dialog-foot">${btn('modal-close','取消','button','type="button"')}${foot}</div>${form?'</form>':''}`;
  d.showModal();
}
function importDialog() {
  showDialog('导入资料',`<label class="field"><span>本地文件</span><input class="file-input" type="file" id="import-file" accept=".txt,.md,text/plain,text/markdown"><span class="hint">本原型支持读取 TXT / Markdown。PDF、图片解析需接入后台。</span></label><label class="field"><span>资料标题</span><input name="title" id="import-title" placeholder="例如：白盒测试讲义" maxlength="80" required></label><label class="field"><span>原文内容</span><textarea name="body" id="import-body" rows="7" placeholder="选择文本文件，或直接粘贴原文…" required></textarea></label><p id="import-error" class="form-error" role="alert"></p>`,`<button class="button primary" type="submit">导入到本页</button>`,'import-form');
}
function publishDialog() {
  const s=source();
  showDialog('发布学习内容',`<div class="row spread m-b-15"><h3>${esc(s.title)}</h3>${tag(`v${s.version}`,'blue')}</div><p class="hint m-b-15">以下文本将作为学习内容呈现。候选、教师对话和私有笔记不会出现在学生页面。</p><article class="document preview-document">${s.body.split(/\n\s*\n/).map(p=>`<p>${esc(p)}</p>`).join('')}</article><label class="field m-t-15"><span>可见范围</span><select name="scope"><option>课程全体学生</option><option>软件工程 1 班</option></select></label><p class="hint">确认只改变本页原型状态；不会写入服务器，检索索引仍未连接。</p>`,`<button class="button primary" type="submit">确认本地发布</button>`,'publish-form');
}
function selectSource(id) { state.sourceId=id; state.objectTab='original'; state.selected=null; state.editing=false; state.sourceSearch=''; }
document.addEventListener('click', async event => {
  const b=event.target.closest('[data-action]'); if(!b) return;
  const action=b.dataset.action, value=b.dataset.value;
  if (['modal-close','cancel-edit'].includes(action)) event.preventDefault();
  switch(action) {
    case 'nav': go(b.dataset.page); return;
    case 'menu': $('#sidebar').classList.toggle('open'); return;
    case 'assistant-toggle': state.assistantOpen=!state.assistantOpen; render(); return;
    case 'assistant-close': state.assistantOpen=false; render(); return;
    case 'assistant-tab': state.assistantTab=value; renderAssistant(); return;
    case 'tasks': state.assistantOpen=true; state.assistantTab='tasks'; render(); return;
    case 'content-tab': state.contentTab=value; render(); return;
    case 'object-tab': state.objectTab=value; state.editing=false; render(); return;
    case 'course-tab': state.courseTab=value; render(); return;
    case 'source': selectSource(b.dataset.id); render(); return;
    case 'fragment': state.selected=Number(b.dataset.index); render(); document.querySelector(`.fragment[data-index="${state.selected}"]`)?.focus({preventScroll:true}); return;
    case 'import': importDialog(); return;
    case 'modal-close': $('#modal').close(); return;
    case 'edit-source': state.editing=true; state.editDraft=source().body; render(); $('#source-editor').focus(); return;
    case 'cancel-edit': state.editing=false; render(); return;
    case 'confirm-candidate': {
      const k=source().candidates.find(k=>k.id===b.dataset.id); k.confirmed=true; state.knowledge.push({...k,sourceId:source().id,version:source().version,sourceBody:source().body});
      record(`确认知识：${k.title}`); render(); toast('已确认到本页知识库；索引未连接'); return;
    }
    case 'edit-candidate': {
      const k=source().candidates.find(k=>k.id===b.dataset.id);
      showDialog('修改知识候选',`<input type="hidden" name="id" value="${k.id}"><label class="field"><span>知识名称</span><input name="title" value="${esc(k.title)}" required maxlength="80"></label><label class="field"><span>知识表述</span><textarea name="text" rows="4" required>${esc(k.text)}</textarea></label><div class="evidence-quote">原文依据：${esc(k.quote)}</div>`,`<button type="submit" class="button primary">保存候选</button>`,'candidate-form'); return;
    }
    case 'locate-evidence': {
      const k=source().candidates.find(k=>k.id===b.dataset.id), parts=source().body.split(/\n\s*\n/).slice(1);
      state.selected=Math.max(0,parts.findIndex(p=>p.includes(k.quote))); state.objectTab='original'; render(); return;
    }
    case 'publish-preview': publishDialog(); return;
    case 'open-material': state.contentTab='materials'; selectSource('boundary'); go('content'); return;
    case 'open-knowledge-source': {
      const k=state.knowledge.find(k=>k.id===b.dataset.knowledge && k.sourceId===b.dataset.id);
      if(k && k.version!==state.sources.find(s=>s.id===k.sourceId).version) {
        showDialog(`来源原文 · v${k.version}`,`<p class="hint m-b-15">此知识确认时的原文快照；当前资料已有新修订。</p><article class="document">${k.sourceBody.split(/\n\s*\n/).map(p=>`<p>${esc(p)}</p>`).join('')}</article>`);return;
      }
      state.contentTab='materials';selectSource(b.dataset.id);state.objectTab='candidates';go('content');return;
    }
    case 'open-grading': go('assessment'); return;
    case 'open-insight': go('insight'); return;
    case 'student': state.studentIndex=Number(b.dataset.index); render(); return;
    case 'save-grade': {
      const inputs=[...document.querySelectorAll('.grade-input')];
      if(!inputs.every(i=>i.reportValidity())) return;
      currentGrade().saved=true; record(`保存学生${state.studentIndex?'乙':'甲'}评分草稿`); render(); toast('评分草稿已保存在本页'); return;
    }
    case 'confirm-grade': if(currentGrade().saved) { currentGrade().status='confirmed'; record('确认评分，尚未发布'); render(); toast('已确认，学生暂不可见'); } return;
    case 'reopen-grade': currentGrade().status='draft'; render(); return;
    case 'release-grade': showDialog('发布评分反馈',`<h3>学生${state.studentIndex?'乙':'甲'} · 第 1 题</h3><p class="thread-body">得分：${currentGrade().scores.reduce((a,b)=>a+b,0)} / 10</p><div class="evidence-quote">${esc(currentGrade().comment)}</div><p class="hint">发布后在本原型学生视图可见。仅针对预置的示例作答。</p>`,btn('release-grade-confirm','确认本地发布','button primary')); return;
    case 'release-grade-confirm': currentGrade().status='released'; record('发布示例作答的评分反馈'); $('#modal').close(); render(); toast('反馈已在本页学生视图开放'); return;
    case 'create-intervention': showDialog('安排补学补练',`<div class="status-strip">已携带：学生甲 · 边界值分析 · 作业 03 第 1 题</div><label class="field"><span>任务名称</span><input name="title" value="复习边界值取值与有效性判断" required></label><label class="field"><span>学习资料</span><select name="source">${state.sources.filter(s=>s.published).map(s=>`<option value="${s.id}">${esc(s.title)} · v${s.publishedVersion || 1}</option>`).join('')}</select><span class="hint">只列出已发布内容。若需选择边界值讲义，请先在课程内容中发布。</span></label><label class="field"><span>截止日期</span><input type="date" name="due" value="2026-11-26" required></label><label class="field"><span>学习要求</span><textarea name="note" rows="3" required>阅读所选资料，补全 19、59 对应的测试用例，再完成已有练习。</textarea></label><p class="hint">演示创建后续任务，不会调用模型自动出题或真实下发。</p>`,`<button type="submit" class="button primary">确认本地下发</button>`,'intervention-form'); return;
    case 'student-reading': state.sourceId=state.intervention?.sourceId || 'partition'; go('reading'); return;
    case 'student-answer': go('feedback'); return;
    case 'complete-reading': state.readDone=true; record(`标记阅读：${source().title}`); render(); toast('已标记阅读完成；不等于已掌握'); return;
    case 'submit-answer-confirm': state.answerSubmitted=true; record('提交本页练习作答'); $('#modal').close(); render(); toast('已在本页提交，未生成教师评分'); return;
    case 'assistant-question': state.assistantDraft=context().prompt; renderAssistant(); $('#assistant-message').focus(); return;
    case 'about': showDialog('课程工作台交互原型','<p class="prototype-info">用于评审前端排布与操作链路。所有课程、师生、作答、评分和回复均为示例。可以导入本地文本、核对知识候选、预览发布、批阅和切换学生视图。所有更改只保留在当前页面内存，刷新后重置。未连接数据库、解析服务、检索或模型，不代表线上功能已实现。</p>'); return;
  }
});
document.addEventListener('keydown', event => {
  if ((event.key==='Enter'||event.key===' ') && event.target.matches('.fragment')) { event.preventDefault(); event.target.click(); }
});
document.addEventListener('input', event => {
  const e=event.target;
  if(e.id==='source-search') { state.sourceSearch=e.value; $('#source-items').innerHTML=sourceItems(); }
  if(e.id==='source-editor') state.editDraft=e.value;
  if(e.id==='assistant-message') state.assistantDraft=e.value;
  if(e.id==='student-answer') state.answer=e.value;
  if(e.id==='reading-note') {state.note=e.value;state.noteSaved=false;$('#note-status').textContent='有未保存的笔记';}
  if(e.matches('.grade-input') || e.id==='grade-comment') {
    if(e.id==='grade-comment') currentGrade().comment=e.value;
    else { currentGrade().scores[Number(e.dataset.index)]=e.validity.valid?Number(e.value):0; $('#grade-total').textContent=currentGrade().scores.reduce((a,b)=>a+b,0); }
    currentGrade().saved=false; $('#grade-save-status').textContent='有未保存修改'; $('[data-action="confirm-grade"]').disabled=true;
  }
});
document.addEventListener('change', async event => {
  const e=event.target;
  if(e.id==='role') { state.role=e.value; state.assistantDraft=''; state.assistantTab='chat'; go(state.role==='teacher'?'content':'tasks'); }
  if(e.id==='import-file') {
    const file=e.files[0]; if(!file) return;
    if(!/\.(md|txt)$/i.test(file.name)) {$('#import-error').textContent='请选择 .txt 或 .md 文件；本原型不解析 PDF 或图片。';return;}
    if(file.size>1024*1024) {$('#import-error').textContent='请选择小于 1 MB 的文本文件。';return;}
    try {$('#import-body').value=await file.text();$('#import-title').value=file.name.replace(/\.[^.]+$/,'');$('#import-error').textContent='';}
    catch {$('#import-error').textContent='无法读取该文件，请重新选择或粘贴原文。';}
  }
});
document.addEventListener('submit', event => {
  event.preventDefault(); const form=event.target, data=new FormData(form);
  if(!form.reportValidity()) return;
  const text=name=>String(data.get(name)||'').trim();
  switch(form.getAttribute('id')) {
    case 'import-form': {
      if(!text('title')||!text('body')) {$('#import-error').textContent='标题和原文内容不能只包含空格。';return;}
      const s={id:`local-${state.sources.length}`,title:text('title'),type:'TXT',version:1,chapter:'03 · 软件测试',body:text('body'),candidates:[],published:false,history:[]};
      state.sources.push(s); state.contentTab='materials'; selectSource(s.id); state.page='content'; $('#modal').close(); record(`导入资料：${s.title}`); render(); toast('文本已导入本页，未执行提炼或索引'); return;
    }
    case 'source-edit': {
      if(!text('body')) {toast('原文内容不能为空');return;}
      const s=source(); if(s.body===text('body')) {state.editing=false;render();return;}
      if(s.published&&!s.publishedBody){s.publishedBody=s.body;s.publishedVersion=s.version;} s.body=text('body');s.version++;s.candidates=[];state.editing=false;state.selected=null;
      record(`保存${s.title}修订 v${s.version}`);render();toast('已保存本页新修订；已确认知识保留旧版本；新修订需重新核对');return;
    }
    case 'candidate-form': {
      if(!text('title')||!text('text')) {toast('知识名称和表述不能为空');return;}
      const k=source().candidates.find(k=>k.id===text('id'));k.title=text('title');k.text=text('text');$('#modal').close();render();toast('候选已修改，尚未确认入库');return;
    }
    case 'publish-form': {
      const s=source();s.published=true;s.publishedBody=s.body;s.publishedVersion=s.version;
      s.history.unshift({version:s.version,scope:text('scope'),time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})});
      record(`发布${s.title} v${s.version}（本页）`);$('#modal').close();state.objectTab='publication';render();toast('学习内容已本地发布；检索索引仍未连接');return;
    }
    case 'assistant-form': {
      if(!text('message'))return;
      const c=context(), list=state.messages[`${state.role}:${c.key}`] ||= [];
      list.push({who:'user',text:text('message')},{who:'bot',text:`本原型未调用模型，因此不会生成新的业务结论。你可以在当前工作区核对原文、修改草稿或执行显式确认；这些操作保留在本页。`});
      state.assistantDraft='';state.assistantTab='chat';renderAssistant();$('.assistant-body').scrollTop=$('.assistant-body').scrollHeight;return;
    }
    case 'question-form': state.question=text('question');state.reference=text('answer');state.questionSaved=true;record('保存题目与参考解答草稿');render();toast('题目草稿已保存在本页');return;
    case 'intervention-form': state.intervention={title:text('title'),due:text('due'),note:text('note'),sourceId:text('source')};state.readDone=false;record('创建学生甲的补学补练任务');$('#modal').close();render();toast('后续任务已创建在本页；等待新证据');return;
    case 'course-form': if(!text('name'))return;state.courseName=text('name');state.settingsSaved=true;render();toast('课程名称已更新在本页');return;
    case 'reply-form': if(!text('reply'))return;state.replies.push({text:text('reply'),role:state.role});record('在当前话题回复');render();toast('回复已添加到当前话题（本页）');return;
    case 'note-form': state.note=text('note');state.noteSaved=true;record('保存阅读笔记');render();toast('笔记已保存在本页');return;
    case 'answer-form': if(!text('answer'))return;state.answer=text('answer');showDialog('确认提交作答',`<div class="evidence-quote">${esc(state.answer)}</div><p class="hint">确认后锁定本页作答。不会生成分数或真实提交到服务器。</p>`,btn('submit-answer-confirm','确认本地提交','button primary'));return;
  }
});
render();
