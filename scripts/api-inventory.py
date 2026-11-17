"""Generate the current HTTP route inventory from mounted registration files; no network or secrets."""
from pathlib import Path
import collections
import json
import re
import hashlib

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs'
FILES = ['server/router.go', 'course/http.go', 'identity/session.go', 'identity/context.go',
         'learning/http.go', 'learning/materials.go', 'learning/question_bank.go', 'learning/topics.go', 'agent/http.go']
DESCRIPTIONS = {
    'login':'登录并创建数据库会话', 'myCourses':'列出本人可访问课程', 'logout':'注销当前会话',
    'courseContext':'角色路由下读取课程上下文', 'createCourse':'创建课程草稿', 'profile':'修改本人资料',
    'password':'修改本人密码', 'context':'读取当前课程及成员上下文', 'publishCourse':'发布课程',
    'renameCourse':'修改课程名称', 'importCurriculum':'导入课程目录', 'createPoint':'创建目录节点/知识点',
    'graph':'读取目录与知识点依赖图', 'edge':'维护知识点依赖', 'path':'读取本人学习路径',
    'planPath':'按已发布证据与前置关系生成规则学习路径（非模型调用）', 'members':'查询选课成员',
    'enroll':'添加选课关系', 'createStudent':'创建学生并加入课程', 'resources':'读取可见学习资料',
    'createResource':'创建学习资料/新增资料修订', 'publishResource':'发布学习资料版本',
    'event':'记录本人的资料学习事件', 'events':'读取可授权学习事件', 'activity':'读取学习活动时间线',
    'notes':'读取本人笔记', 'note':'保存本人资料笔记', 'assignments':'读取可见作业',
    'assignmentWorklist':'读取作业工作清单', 'submissionWorklist':'分页查询教师批阅队列',
    'interventionEvidence':'读取补学补练任务的完成证据', 'createAssignment':'创建/修改未发布作业',
    'assignment':'读取授权作业详情', 'assignmentState':'发布/关闭等作业状态转换',
    'submissions':'读取授权范围内的作答', 'roster':'查询作业提交名单及未交情况',
    'submit':'提交本人答案；客观题可按教师答案规则判分', 'draft':'读取本人逐题草稿',
    'saveDraft':'保存本人逐题草稿', 'submission':'读取授权作答详情与可见评阅结果',
    'rubrics':'读取作业题目的评分标准版本', 'createRubric':'保存作业题目标准草稿/采纳AI草稿',
    'confirmRubric':'确认评分标准版本', 'grade':'保存评分修订/采纳AI评分草稿',
    'gradeState':'确认或发布评分修订', 'interventions':'读取授权补学补练任务',
    'createIntervention':'创建补学补练任务草稿', 'interventionState':'按角色下发、提交完成、复核任务',
    'interactions':'读取课程答疑互动', 'createInteraction':'按角色提交问题/回复',
    'overview':'查询班级学情汇总', 'evidence':'读取授权评分表现及证据', 'assistStatus':'查询助教是否配置',
    'assist':'课程RAG问答；检索后一次生成，校验原文引用', 'research':'读取教研记录',
    'createResearch':'新增/修改人工教研记录', 'deleteResearch':'删除教研记录',
    'industry':'读取行业案例', 'createIndustry':'新增/修改人工行业案例', 'deleteIndustry':'删除行业案例',
    'models':'查询模型profile及预算/调用台账（没有配置修改接口）', 'sources':'查询原件列表',
    'sourceDetail':'读取原件及解析片段/指定历史片段版本', 'uploadSources':'上传原件并建立解析任务',
    'correctFragments':'人工校正原文并创建解析修订', 'publishFragments':'选择原文片段发布为学习资料',
    'archiveSource':'归档来源并限制未来使用', 'sourceDerivation':'设置或撤回知识提炼许可',
    'downloadSource':'下载原件；按资料发布范围/角色校验', 'knowledge':'读取权限允许的知识条目',
    'saveKnowledge':'新增/修改知识草稿或新版本', 'knowledgeState':'知识确认等状态转换',
    'createRAGJob':'提交解析/索引/提炼/标准/评分/视觉等后台任务', 'jobs':'查询处理任务',
    'job':'读取任务状态与候选结果', 'cancelJob':'请求取消后台任务', 'retryJob':'显式新建失败任务重试',
    'retrieval':'按学习/评分/比较用途检索；可调用查询Embedding', 'retrievalStatus':'查询检索配置/索引状态',
    'questionBank':'查询独立题库', 'saveBankQuestion':'创建题目或新题目版本', 'bankDetail':'读取题目与版本详情',
    'bankProvenance':'读取题目版本来源与证据', 'archiveBank':'停用题库题目',
    'confirmBankQuestion':'确认题目版本', 'confirmBankReference':'单独确认参考解答',
    'bankRubrics':'读取题目版本的标准', 'createBankRubric':'保存题库标准草稿/采纳AI候选',
    'createBankJob':'提交出题/题目分析/题库标准草稿任务', 'bankEvidence':'检索题目可用的评分依据',
    'topics':'读取专题库', 'saveTopic':'新增/修改专题库', 'contentLinks':'维护专题、标签及知识点关联',
    'decisions':'读取知识加工决定', 'searchBank':'搜索题库', 'importURL':'抓取公开单页或直链文档后排队解析',
    'sourceAssets':'读取来源图片/公式/图表资产', 'saveAssetRevision':'保存人工识别校正或确认版本',
    'cropAsset':'裁剪所选图像资产', 'knowledgeDecision':'采纳/合并/条件并存/替换等知识决定',
    'adoptSuggestions':'采纳目录/专题/关联建议', 'adoptPaper':'采纳经教师校正的整卷拆题结果',
    'impact':'查询来源或知识变更影响', 'impactDecision':'保存影响处理决定',
    'regrades':'读取整组重评批次', 'createRegrade':'创建冻结作答与新版标准的重评批次',
    'regradeDetail':'读取重评批次详情', 'saveRegradeItem':'保存/确认一份重评结果',
    'regradeState':'整组发布等重评状态转换', 'regradeAI':'按冻结的重评输入排队生成评分草稿',
    'assetFile':'读取授权图像资产文件', 'resourceAssets':'读取学习资料关联资产',
    'questionAssets':'读取作业题目关联资产',
}

rows = []
for file in FILES:
    for line_number, line in enumerate((ROOT/'backend/internal'/file).read_text(encoding='utf-8').splitlines(), 1):
        match = re.search(r'\b(r|api|protected|base|g|t|student|group)\.(GET|POST|PUT|DELETE|PATCH)\("([^"]*)"', line)
        if not match:
            continue
        variable, method, path = match.groups()
        handlers = re.findall(r'\b[hs]\.(\w+)', line)
        handler = handlers[-1] if handlers else 'inline'
        roles = ['student', 'teacher'] if file == 'identity/context.go' and variable == 'group' else [None]
        for expanded_role in roles:
            role = '已登录；对象级权限按业务过滤'
            if file == 'agent/http.go':
                full = '/api/v1/learning/courses/:courseID/agent' + path
                description = {'status':'读取可用模型、工具及运行上限','conversations':'列出本人课程对话','createConversation':'新建对话','conversation':'读取消息、运行、步骤及问题卡','options':'切换模型与权限模式（空闲时）','send':'幂等提交消息并创建持久运行','upload':'上传会话私有附件','download':'授权下载附件／反馈CSV','stream':'按游标重放运行事件并保持SSE连接','cancel':'请求停止运行，保留已完成业务','resume':'显式恢复可恢复检查点','respond':'提交问题答案或批准／拒绝具体操作'}[handler]
                role = '师生；本人对话；本课程；写入仍按业务身份授权'
            elif file == 'server/router.go':
                full = path
                description = '进程存活探针' if path.endswith('/live') else '数据库与Redis就绪探针'
                role = '公开'
            elif file == 'course/http.go':
                full = '/api/v1'+path
                description = '公开已发布课程元数据'
                role = '公开'
            elif file == 'identity/session.go':
                full = '/api/v1'+path
                description = '读取本人身份及CSRF令牌' if handler == 'inline' else DESCRIPTIONS[handler]
                role = '公开登录入口' if handler == 'login' else '本人会话'
            elif file == 'identity/context.go':
                if expanded_role:
                    full = '/api/v1/'+expanded_role+'/courses/:courseID'+path
                    description = '权限检查示例；不执行业务写入' if path == '/access-check' else DESCRIPTIONS['courseContext']
                    role = expanded_role+'；课程归属'
                else:
                    full = '/api/v1/student/users/:studentID'+path
                    description = '读取本人用户上下文；路由使用RequireSelf'
                    role = '本人'
            else:
                full = '/api/v1/learning'+('' if variable == 'base' else '/courses/:courseID')
                if file == 'learning/question_bank.go':
                    full += '/question-bank'
                full += path
                if handler == 'inline':
                    description = '读取指定题库版本'
                else:
                    description = DESCRIPTIONS[handler]
                if 'RequireRole("teacher")' in line or variable == 't':
                    role = '教师；本课程'
                elif 'RequireRole("student")' in line:
                    role = '学生；本人/本课程'
                elif variable != 'base':
                    role = '师生；本课程；按对象/可见性过滤'
            mode = 'HTTP JSON；同步业务处理'
            if method == 'GET': mode = 'HTTP JSON；同步读取'
            if handler in ['downloadSource', 'assetFile']: mode = 'HTTP文件响应'
            if handler == 'uploadSources': mode = 'multipart上传 → PG任务 → Asynq解析'
            if handler == 'importURL': mode = 'HTTP JSON → 同步公开网页抓取 → 异步解析'
            if handler in ['createRAGJob','createBankJob','regradeAI','retryJob']: mode = 'HTTP JSON返回任务ID → Asynq → 前端轮询'
            if handler in ['jobs','job']: mode = 'HTTP JSON；后台状态读取/轮询'
            if handler == 'assist': mode = 'HTTP同步；RAG＋非流式Chat；返回JSON'
            if handler in ['retrieval','bankEvidence']: mode = 'HTTP同步；关键词/向量检索；可能调用Embedding'
            if file == 'agent/http.go':
                mode = 'HTTP JSON；持久对话及权限门禁'
                if handler == 'send': mode = 'HTTP JSON返回run_id → PostgreSQL检查点 → 多Agent工具循环'
                if handler == 'stream': mode = '业务事件SSE；游标重放、心跳与重连；非模型token流'
                if handler == 'upload': mode = 'multipart上传；私有文件卷＋数据库元数据'
                if handler == 'download': mode = '授权HTTP文件响应'
                if handler == 'respond': mode = 'HTTP JSON → 参数／业务快照核验 → 恢复原运行'
            csrf = method not in ['GET','HEAD','OPTIONS'] and handler != 'login'
            rows.append(dict(method=method, path=full, function=description, access=role,
                             invocation=mode, csrf=csrf, handler=handler, source='backend/internal/'+file,
                             line=line_number, rag_gate=file == 'learning/materials.go'))

assert len(rows) == len({(r['method'],r['path']) for r in rows})
source_hash=hashlib.sha256(''.join((ROOT/'backend/internal'/f).read_text(encoding='utf-8') for f in FILES).encode()).hexdigest()
counts = dict(collections.Counter(r['method'] for r in rows))
artifact = {'date':'2026-11-17','source_sha256':source_hash,'basis':'mounted source registrations; not runtime/network frequency',
            'route_count':len(rows),'method_counts':counts,'routes':rows}
(OUT/'api-inventory.json').write_text(json.dumps(artifact,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
parts = ['# 当前 API 全量清单', '', f'盘点日期：2026-11-17；注册入口内容 SHA256：`{source_hash}`。', '',
         f'共 **{len(rows)} 个 method + path**，方法统计：`{json.dumps(counts)}`。', '',
         '依据 server.New 实际调用的注册入口展开角色循环；这是源码入口清单，不是线上调用量、生产启用证明或安全审计结论。', '',
         '所有路径已展开 `/api/v1` 前缀。认证写请求使用CSRF；登录是独立公开入口。',
         'learning课程路由还会核对课程授权；表中角色只概括路由层，业务处理器继续校验对象归属、发布状态、版本和所有权。',
         'materials.go 中全部入口还经过 h.rag 非空门禁；其他AI入口在处理器内检查，不能把“路由已注册”理解为“模型已配置”。',
         'Agent审批和业务状态转换分别执行；审批通过后仍走原业务路由。events为SSE，其余入口为HTTP JSON或文件；模型工具推理使用非流式chat/completions。',
         '写入后部分路径会附带排队索引；“同步业务处理”描述主响应，不表示完全没有后台副作用。', '']
for file in FILES:
    group=[r for r in rows if r['source']=='backend/internal/'+file]
    parts.extend(['## '+file, '', '| 方法 | 完整路径 | 功能 | 访问范围 | 调用方式 | CSRF | 代码 |',
                  '|---|---|---|---|---|---|---|'])
    for r in group:
        link=f"[{r['handler']}:{r['line']}](../{r['source']})"
        parts.append(f"| {r['method']} | `{r['path']}` | {r['function']} | {r['access']} | {r['invocation']} | {'是' if r['csrf'] else '—'} | {link} |")
    parts.append('')
(OUT/'api-inventory.md').write_text('\n'.join(parts).rstrip()+'\n',encoding='utf-8')
print(json.dumps({'routes':len(rows),'methods':counts,'source_sha256':source_hash,'outputs':['api-inventory.md','api-inventory.json']},ensure_ascii=False))
