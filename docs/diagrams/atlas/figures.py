"""Source-checked, purpose-specific graph content (not a uniform row summary)."""
from drawing import Diagram


def build(fid,title,question,nodes,edges,*,cols=4,rows=4,evidence,boundary,row_step=360):
    d=Diagram(fid,title,question,cols,rows,evidence,boundary,row_step=row_step)
    for key,c,r,name,role,body,*layout in nodes:
        d.node(key,c,r,name,body.split('|') if body else [],role,**(layout[0] if layout else {}))
    for edge in edges:
        d.edge(*edge)
    return d


def context():
    return build('F01','系统上下文图','围绕一个教学系统，谁提供输入、谁接收结果、哪些连接是可选的？',[
        ('teacher',0,0,'教师','teacher','维护本人课程、成员与教学内容|审核知识、题目、解答与评分标准|复核发布成绩；下发干预与复查'),
        ('student',2,0,'学生','external','只访问所选课程与本人学习记录|阅读、记笔记、提交作业与测验|查看正式反馈；完成老师任务'),
        ('file',0,1,'教师持有的教学文件','external','PDF / DOCX / PPTX / 文本 / 表格|原卷与原图作为出处，不等于标准答案|原件下载受发布范围与权限限制'),
        ('system',1,1,'HaJi Mark 教学系统','system','课程内容 → 学习作答 → 正式评价|资料与知识分开审核和版本管理|教师保留采纳、确认、发布的决定权|本地可选 RAG，默认人工平台'),
        ('model',2,1,'外部模型供应商','external','百炼北京：生成与向量配置分开|仅本地显式启用后按所选范围出站|带出处候选 / 逐点评分草稿|调用失败、预算与未知费用保留记录'),
        ('url',0,2,'公开网页 / 文档地址','external','单页正文、图片快照或直链文档|记录原网址、内容快照、来源说明|不代表任意站点爬取或登录站点接入'),
        ('export',1,2,'教师导出的评价证据','external','CSV 与正式反馈来自已发布评分|回查原始作答、确切标准和来源|未确认 AI 草稿不作为正式成绩'),
        ('ops',2,2,'运行与维护环境','external','浏览器同源访问，数据库不直连用户|持久卷保存业务库、队列和原件|生产与本地配置、版本相互区分'),
        ('future',0,3,'当前没有对外教学系统集成','pending','未接学校统一身份认证或教务平台|不画自动同步学籍、成绩回传链路|无代码执行判题或 AI 自动发成绩'),
        ('public',2,3,'公网范围的仓库记录','external','11/05 发布记录：应用 f40872a|生产配置 AI_ENABLED=false|新本地能力不能据此宣称已上线'),
    ],[
        ('teacher','system','课程、内容、规则与审核决定'),('system','teacher','候选、提交队列、证据与变更影响'),
        ('student','system','学习行为、私人草稿与正式作答'),('system','student','可见内容、正式反馈与任务'),
        ('file','system','人工导入原件'),('url','system','教师发起单页 / 直链快照'),
        ('system','model','授权片段 / 固定规则 / 所选模型',True),('model','system','候选、引用与调用结果',True),
        ('system','export','正式结果导出'),('ops','system','配置、运行与持久化'),
    ],cols=3,evidence='learning/http.go；materials.go；rag/models.go；compose*.yaml；deploy/compose.production.yaml；AGENTS.md',boundary='本图只画系统边界及外部交互；模型连接是本地可选路径。公网版本取自仓库部署记录，本轮没有执行生产复查或部署。')


def conceptual():
    return build('F02','概念 ER 图','区分原件、学习资料、知识、题库、作业实例和评价修订，追踪它们的业务关联。',[
        ('teacher',0,0,'教师','data','创建并拥有课程|审定教学内容|人工评阅作答|下发干预任务',{'y':315,'w':240,'status':'概念角色'}),
        ('student',0,0,'学生','data','通过选课加入课程|保存本人学习记录|完成正式作答|执行教师任务',{'x':370,'y':315,'w':240,'status':'概念角色'}),
        ('course',1,0,'课程与选课','data','课程承载教学内容、成员与评价|教师创建；课程下学生由成员关系关联'),
        ('point',2,0,'章节 / 节 / 知识点','data','目录树形成课程教学组织|知识点之间可维护前置依赖'),
        ('topic',3,0,'专题与标签','data','跨原件、知识、题目组织内容|专题不是章节；关联不复制正文'),
        ('source',0,1,'来源原件与解析修订','data','原始内容、许可、版本与定位|一份原件含多个可核对片段'),
        ('resource',1,1,'学习资料版本','data','教师选段或全文编排发布|保留来源与确切知识点关联'),
        ('knowledge',2,1,'精炼知识版本','data','带适用条件、证据与独立用途|多个原文出处可支撑一个条目'),
        ('bank',3,1,'独立题库与题目版本','data','同一题库条目保留多个题目版本|题目与参考解答分别确认'),
        ('asset',0,2,'原图与核对转写','data','原图片段可有多次转写修订|题目版本可引用多个图像证据'),
        ('assignment',1,2,'作业 / 测验与题目实例','data','一个任务包含多道作业题|题库选用固定题目与标准组合'),
        ('rubric',2,2,'评分标准版本','data','属于确切题目版本或旧作业题|多个评分点与依据形成冻结规则'),
        ('chunk',3,2,'检索块与向量空间','data','源自原件、资料或知识三者之一|向量空间隔离模型、维度和切块配置'),
        ('note',0,3,'笔记与学习事件','data','记录阅读、完成、笔记和收藏|事件与正式提交可关联追溯'),
        ('submission',1,3,'正式作答','data','同一学生同题可以多次正式提交|每次原文与任务版本保持不可变'),
        ('grade',2,3,'评分修订','data','每次提交可有多次评分修订|学生只见已发布的正式结果'),
        ('batch',3,3,'整组重评批次与逐份项','data','一个关闭作业中的一道题|冻结每人最新正式提交及评分基线'),
        ('path',0,4,'学习路径与条目','data','学生的规则路径快照|路径条目关联知识点及选择理由'),
        ('intervention',1,4,'教师干预任务','data','属于课程、学生与下发教师|可关联已发布资料和补练作业'),
        ('job',2,4,'处理任务与模型调用','data','记录任务输入快照、结果与失败|模型调用与预算独立计费留痕'),
        ('decision',3,4,'内容处理决定','data','保留比较、采纳和变更处理的依据|记录输入、输出与决定理由'),
    ],[
        ('teacher','course','授课 1:N'),('student','course','选课 M:N',False,('b','l')),('course','point','1:N'),('course','source','1:N'),('course','assignment','1:N'),
        ('point','resource','0:N 关联'),('point','assignment','题目可选关联'),('topic','bank','M:N'),('topic','knowledge','M:N'),('topic','source','M:N'),
        ('source','resource','1:0..N'),('source','knowledge','M:N 证据'),('source','asset','1:N'),('asset','bank','M:N 题图'),
        ('bank','rubric','版本 1:0..N'),('bank','assignment','一个版本可多次选用'),('rubric','assignment','绑定确切标准'),
        ('resource','chunk','1:0..N'),('knowledge','chunk','1:0..N'),('source','chunk','1:0..N'),
        ('assignment','submission','题目实例 1:N'),('student','submission','作答 1:N'),('submission','grade','1:N'),('teacher','grade','人工复核 1:N'),
        ('rubric','grade','采用确切标准'),('batch','submission','批次逐份冻结'),('batch','grade','发布追加新修订'),
        ('resource','note','1:N'),('student','note','本人 1:N'),('student','path','本人 1:N'),('point','path','路径条目关联'),
        ('teacher','intervention','下发 1:N'),('student','intervention','执行 1:N'),
        ('assignment','intervention','可选补练'),('resource','intervention','可选补学'),('grade','path','正式结果作为证据'),
        ('job','grade','可选 AI 草稿来源'),('decision','knowledge','决定产生或关联版本'),
    ],rows=5,row_step=390,evidence='backend/db/migrations/00001–00012；learning/materials.go；question_bank.go；regrade.go；path.go',boundary='教师与学生拆为概念角色，不表示拆分实际用户表。业务证据引用不冒充物理 FK；F14 分图给出 41 张表、103 条真实外键及非外键说明。')


def domains():
    return build('F03','数据主题域与写权','按业务事实划分数据归属；跨域通过服务端命令和受控证据读取衔接。',[
        ('identity',0,0,'身份与会话域','system','所有者：identity|写：登录、退出、会话校验|用户角色与会话事实唯一来自数据库'),
        ('course',1,0,'课程与成员域','system','所有者：learning/http 与 workspace|写：建课、发布、选课、课程目录|为其他域提供课程、成员与知识点'),
        ('content',2,0,'资料与原文域','system','所有者：learning/materials、assets|写：导入、校正、发布、许可与归档|worker 追加解析修订和片段'),
        ('knowledge',3,0,'精炼知识与组织域','system','所有者：materials / decisions / topics|写：草稿、确认、合并与专题采纳|worker 只产生待采纳知识候选'),
        ('bank',0,1,'题库与规则域','system','所有者：question_bank、rubrics、paper|写：题目/解答/标准分别确认|确切版本、满分和依据快照受控'),
        ('assessment',1,1,'作业与原始作答域','system','所有者：assessment、drafts|写：任务版本、私人草稿、正式提交|正式原文、次数与哈希不可覆盖'),
        ('grading',2,1,'评价与重评域','system','所有者：feedback、regrade|写：评分修订、确认、发布与批次|AI 任务结果不直接成为正式评分'),
        ('evidence',3,1,'证据与干预域','system','所有者：activity、path、feedback|写：学习事件、路径、任务与复查|表现统计只消费已发布评分证据'),
        ('retrieval',0,2,'检索投影域','system','所有者：rag/index、retrieval|写：块、向量与检索空间|内容资格来自原域，索引不授予权限'),
        ('job',1,2,'异步任务与调用域','system','所有者：rag/jobs、models|API：创建/取消/重试；worker：执行|预算预留、费用结算与恢复均留痕'),
        ('manual',2,2,'交流与人工记录域','system','所有者：communication、records|写：课程互动、教研和行业记录|人工录入，不伪称自动情报采集'),
        ('audit',3,2,'版本与决定审计','data','来源、知识、题目与评分保留历史|content_decisions 保存采纳与处理|跨域修订使用明确版本和并发校验'),
        ('client',0,3,'浏览器的写入边界','external','用户意图经 API 鉴权、校验后入库|页面状态和编辑恢复不是数据库事实|浏览器不直写数据库或模型预算'),
        ('store',1,3,'统一持久化边界','data','一个 PostgreSQL，sqlc/store 访问|域划分是代码内职责，不是微服务|原件文件卷与 Redis 队列分别管理'),
    ],[
        ('identity','course','角色与身份'),('course','content','课程归属'),('course','assessment','课程与名单'),('course','evidence','成员与知识点'),
        ('content','knowledge','合法原文证据'),('knowledge','bank','确认知识与出处'),('bank','assessment','冻结题目与标准'),
        ('assessment','grading','不可变作答'),('grading','evidence','仅正式发布结果'),('content','retrieval','可索引可靠内容'),
        ('knowledge','retrieval','确认 / 用途 / 许可'),('job','content','解析产物'),('job','knowledge','候选结果'),('job','grading','评分草稿'),
        ('client','course','通过受控 API 发业务命令'),('grading','audit','追加修订'),('knowledge','audit','教师决定'),
    ],evidence='backend/internal/identity；learning/{http,materials,knowledge_decisions,question_bank,assessment,feedback,path,regrade}.go；rag',boundary='“所有者”表示数据语义和合法写入口归属，不宣称一个文件独占所有 SQL；API 与 worker 对同一处理任务承担不同状态转换。')


def architecture():
    return build('F04','总体结构与依赖','从活动前端到业务处理、异步执行与持久化，标清运行进程与代码内模块。',[
        ('browser',0,0,'浏览器与角色工作台','external','教师 / 学生路由，顶栏课程选择|访问同源 Web，携带会话与 CSRF'),
        ('web',1,0,'React / TypeScript / Ant Design','system','app：登录、布局、导航与主题|live：课程、内容、作业与反馈页面'),
        ('client',2,0,'共享 API / 会话客户端','system','shared/api 与 session 统一请求|live/context 注入角色和课程上下文'),
        ('proxy',3,0,'Web Nginx','system','静态资源与 SPA 路由回退|同源 /api 反向代理到 Gin API'),
        ('api',3,1,'Go API 进程','system','cmd/api → server 统一装配路由|健康检查、identity 与 learning 注册'),
        ('auth',2,1,'identity 认证与授权','system','Session → Role / Course|认证写请求校验 CSRF；对象再查归属'),
        ('learning',1,1,'learning 业务处理器','system','课程 / 资料知识 / 题库与任务|提交 / 标准 / 评分 / 重评 / 干预'),
        ('ragapi',0,1,'rag 共享能力','system','模型配置、合法证据与检索服务|同步检索 / 问答；创建持久处理任务'),
        ('store',1,2,'pgx + sqlc/store','system','db/queries 编写 SQL、生成类型|事务内锁定与版本校验由业务发起'),
        ('pg',2,2,'PostgreSQL + pgvector','data','业务事实、任务与预算持久化|检索块、向量空间、版本与审计'),
        ('redis',3,2,'Redis / Asynq','data','队列投递任务 ID，AOF 持久化|不是任务事实或正式成绩存储'),
        ('worker',3,3,'Go worker 进程','system','cmd/worker → rag.Process / Recover|领取任务、执行、记录成功或失败'),
        ('parser',2,3,'Python 本地解析工具','system','worker 子进程调用 parse.py|PDF / Office / OCR / 表格与定位'),
        ('files',1,3,'materials-data 文件卷','data','原件、快照、图像与裁剪文件|API 与 worker 共用，浏览器受控读取'),
        ('model',0,3,'外部生成 / Embedding','external','profile 分开；空间绑定模型和维度|按预算调用；凭据由本地忽略文件注入'),
        ('jobs',0,2,'持久任务与恢复','system','PG outbox 先落地，再投递队列|Redis 故障后扫描补投；DB 原子领取|生成中断显式重试，解析索引幂等恢复'),
    ],[
        ('browser','web','HTTP'),('web','client','页面调用'),('client','proxy','/api/v1'),('proxy','api','同源代理'),
        ('api','auth','路由中间件'),('auth','learning','受控业务请求'),('learning','ragapi','复用能力'),('learning','store','类型化 SQL'),
        ('ragapi','jobs','CreateJob'),('jobs','pg','持久输入快照'),('jobs','redis','投递 ID'),('redis','worker','领取任务'),
        ('worker','pg','领取、产物和预算'),('store','pg','pgxpool'),('worker','parser','本地解析'),('parser','files','读取原件 / 产出图像'),
        ('learning','files','受控上传与下载'),('ragapi','model','同步检索 / 问答'),('worker','model','异步生成 / 索引'),('worker','jobs','Recover 扫描'),
    ],evidence='web/src/{app,live,shared}；web/nginx.conf；backend/{cmd,internal/server,internal/identity,internal/learning,internal/rag}；compose*.yaml',boundary='一个应用内按 Go 包组织；API 和 worker 是两个运行进程。Python 只是解析工具，不是独立教学业务服务。')


def overall():
    return build('F05','总体流程 v2：阶段与交付物','按教学闭环连接阶段，突出每次交接产生的内容与正式成果。',[
        ('setup',0,0,'01 课程与教学组织','teacher','创建课程、成员与章节知识点|维护前置关系、专题与教学要求'),
        ('import',1,0,'02 原件与可核对原文','system','导入教学文件或单页快照|解析、原图核对与定位修订'),
        ('publish',2,0,'03 学习资料与知识审定','teacher','编排并发布完整内容或选段资料|精炼知识经审核，单独设置用途'),
        ('learn',3,0,'04 学生学习与检索','external','阅读资料、精炼知识与引用问答|留下笔记、收藏与学习完成记录'),
        ('author',0,1,'05 命题与规则形成','teacher','手工录题、整卷采纳或 AI 候选|题目、参考解答、评分标准分别审定'),
        ('task',1,1,'06 发布作业与测验','teacher','选定确切题目、标准与依据组合|形成全体作答一致的任务版本'),
        ('answer',2,1,'07 作答与正式提交','external','私人草稿与正式作答明确区分|服务端回执确认不可变提交'),
        ('review',3,1,'08 形成评分与教师复核','teacher','规则结果 / 人工评分 / AI 草稿|主观评价由教师核对、确认和发布'),
        ('feedback',3,2,'09 正式反馈与学情证据','system','学生查看已发布反馈；教师可导出|班级与个人证据视图回溯原文'),
        ('intervene',2,2,'10 教师干预与补学补练','teacher','按证据选学生、资料与已有练习|明确要求后下发，学生执行'),
        ('check',1,2,'11 新证据与教师复查','teacher','收集下发后的学习与正式提交|复查结果可引出下一轮干预'),
        ('change',0,2,'12 内容与评价持续修订','teacher','新内容版本保留来源和历史|评估影响；必要时整组统一重评'),
    ],[
        ('setup','import','课程与目录'),('import','publish','可靠原文 + 出处'),('publish','learn','可见教学内容'),
        ('publish','author','合法依据与考查要求'),('author','task','确认题目 + 匹配标准'),('task','answer','任务版本与作答要求'),
        ('learn','answer','理解与原始作答'),('answer','review','原文、次数、哈希'),('review','feedback','正式评分修订'),
        ('feedback','intervene','可追溯评价证据'),('intervene','check','下发任务与新证据'),('check','change','复查与修订需求'),
        ('change','import','来源内容更新'),('change','author','未来任务选择新版本'),('check','intervene','继续跟进'),
    ],rows=3,evidence='docs/architecture.md；learning/{assessment,materials,question_bank,feedback,path,regrade}.go',boundary='本图只交代阶段和交付物；审核条件、异常分支与状态分别展开在 F06–F11，关键事务与失败兜底见 F15。')


def answering():
    return build('F08','作答与提交工作流程','从可见任务到不可变原始作答，区分草稿、重发、重新作答和正式回执。',[
        ('task',0,0,'进入本人课程的已发布任务','external','课程成员身份由服务端确认|读取题目与截止时间，不下发私有规则'),
        ('load',1,0,'恢复私人答题草稿','system','按当前学生与题目读取本人草稿|自动保存与恢复独立于正式提交'),
        ('write',2,0,'学生编辑并确认作答','external','草稿可改，正式提交内容另行确认|正文非空且不超过服务端长度上限'),
        ('request',3,0,'发送正式提交请求','system','提交作答正文、所选题目与请求标识|同一标识用于识别网络重发'),
        ('auth',3,1,'身份、CSRF 与课程归属','system','学生角色、会话和所选课程均合法|题目必须属于该任务；只写本人作答'),
        ('lock',2,1,'锁定任务并查重复请求','system','事务内锁任务，查询本人的请求标识|优先识别已成功提交的同一次请求'),
        ('same',1,1,'同请求号、相同内容','data','作业、题目和原文全部相同|返回原提交，不新增 attempt'),
        ('conflict',0,1,'相同请求号内容已改变','system','拒绝同请求标识携带不同内容|旧提交保持不变，页面需重新确认'),
        ('gate',2,2,'新请求检查任务可提交性','system','状态必须 published 且未过截止|重读任务版本，验证题目归属'),
        ('reject',3,2,'关闭 / 截止 / 越权拒绝','system','服务端返回明确错误|当前编辑内容不冒充已提交记录'),
        ('freeze',1,2,'写入新的正式 attempt','data','保存原始文本、SHA256 与提交时间|固定任务版本与递增作答次数|同步写入正式提交事件'),
        ('type',0,2,'按题型决定后续评价','system','客观 quiz：固定答案规则|主观 / 代码题：等待评阅，不执行代码'),
        ('rule',0,3,'客观题同事务判分','data','按教师已定答案产生 released 修订|标记已评分；规则失败则整体回滚'),
        ('commit',1,3,'事务提交成功','system','正式作答与事件同时落地|失败不返回成功回执'),
        ('receipt',2,3,'回执与个人提交历史','external','展示服务端保存的 attempt 与时间|回执丢失可用原请求号重发确认'),
        ('again',3,3,'再次作答采用新请求号','external','允许期间可再产生新的 attempt|保留每次原文；不覆盖旧提交'),
    ],[
        ('task','load','打开题目'),('load','write','本人草稿'),('write','request','确认正式提交'),('request','auth','正式提交'),
        ('auth','lock','校验通过'),('lock','same','已存在且完全一致'),('lock','conflict','已存在但不一致'),('lock','gate','尚无该请求'),
        ('same','receipt','复用原回执'),('gate','reject','不可提交'),('gate','freeze','允许新提交'),('freeze','type','按题型分支'),
        ('type','rule','客观题'),('rule','commit','正式规则结果'),('type','commit','主观题待评阅'),('commit','receipt','事务成功后返回'),
        ('receipt','again','需要重新作答'),('again','request','新请求，重新校验'),
    ],rows=4,evidence='learning/assessment.go:submit；drafts.go；db/queries/{learning,workspace}.sql；00003、00008 迁移',boundary='幂等重发先识别旧成功请求，再判断新提交窗口；草稿不等于正式作答。原文只追加；教师批量导入学生作答尚未实现，不能把题库 JSON 导入当作答案导入。')


def grading():
    return build('F09','评阅与发布工作流程','冻结依据、分离草稿与正式结果，并在教师发布前阻断越界规则和过期修订。',[
        ('queue',0,0,'教师读取本人课程待评提交','teacher','查看原文、attempt、哈希与任务版本|客观题已有固定规则结果，另走规则分支'),
        ('binding',1,0,'核对确切题目与标准绑定','system','新题库题必须匹配已绑定 rubric|旧作业仍按原题归属，不改写历史'),
        ('basis',2,0,'冻结当时规则与依据','data','题目、满分、逐点规则与依据快照|正式评阅不临时检索增加扣分点'),
        ('ai',3,0,'可选 AI 逐点草稿','ai','仅输入该提交原文与固定标准|输出逐点得分、学生原句、依据与反馈'),
        ('manual',0,1,'教师人工评分路径','teacher','AI 关闭、失败或不采纳时可人工评|有逐点标准时必须按点给分'),
        ('review',1,1,'原文、标准、出处同屏核对','teacher','修改分项、接受表达与反馈|确认学生原句与依据吻合，人工判断语义'),
        ('machine',2,1,'机械一致性检查','system','逐点范围、总分加和、引用与归属|AI job 的提交、哈希、标准须吻合'),
        ('failed',3,1,'AI 或校验失败留痕','system','不生成或发布正式成绩|教师修正、人工评阅或显式重试任务'),
        ('managed',0,2,'保存前查整组重评管理边界','system','本题进入重评管理后阻断普通评分|后续更正也经独立批次统一处理'),
        ('draft',1,2,'追加评分修订 draft','data','事务锁作业与提交；请求重发幂等|保留评阅人、版本、逐点分与任务来源'),
        ('confirm',2,2,'教师确认最新 draft','teacher','仅最新修订可转 confirmed|旧草稿、重复状态或并发冲突拒绝'),
        ('release',3,2,'教师单独发布已确认评分','teacher','再次检查当前修订与题目管理状态|事务转 released 并标记提交 graded'),
        ('student',3,3,'学生只读正式反馈','external','本人作答、已发布修订与逐点说明|看不到教师草稿和私有评分标准'),
        ('evidence',2,3,'正式结果统一供学情消费','data','按题去重选择有效 released 证据|新未评分 attempt 不抹掉旧正式结果'),
        ('history',1,3,'修订与依据历史保留','data','后续评分是新修订，不覆盖原始作答|来源新版本不改变既有冻结依据'),
        ('regrade',0,3,'内容影响需要整组更正','teacher','关闭作业、一道题、统一新规则|逐份确认 → 事务全组发布，见 F09-1'),
    ],[
        ('queue','binding','所选提交'),('binding','basis','确认匹配'),('basis','ai','可选异步任务'),('queue','manual','直接人工'),
        ('ai','review','可核对候选'),('ai','failed','任务失败 / 无有效输出'),('failed','manual','人工兜底'),
        ('manual','review','人工给分'),('review','machine','保存前检查'),('machine','failed','范围 / 引用 / 绑定不符'),
        ('machine','managed','内容检查通过'),('managed','draft','未进入批次管理'),('draft','confirm','保存后确认最新修订'),
        ('managed','regrade','已进入批次管理'),('confirm','release','教师再发发布命令'),('release','student','正式反馈'),
        ('release','evidence','去重证据'),('release','history','保留历史'),('history','regrade','需要统一更正'),
    ],evidence='learning/feedback.go:{grade,gradeState}；rubrics.go:scorePoints；materials.go:createRAGJob；regrade.go；db/queries/learning.sql',boundary='系统机械核对不替代教师语义审核。主观题 AI 草稿永不自动发布；客观测验按固定答案直接产生规则 released 结果。')


def intervention():
    return build('F10','诊断证据与教师干预流程','准确区分证据汇总、规则路径、教师决定和仍未接通的 AI 诊断。',[
        ('released',0,0,'已发布评价证据','data','按题聚合有效正式结果，回查原文|保留得分、满分与知识点关联'),
        ('activity',1,0,'真实学习与作答记录','data','阅读、完成、笔记、正式提交|未交、部分提交、已交由队列汇总'),
        ('view',2,0,'班级 / 个人证据视图','system','呈现已有评价和学习事实|缺证据单独显示，不冒充 0 分能力'),
        ('teacher',3,0,'教师解释问题并选干预对象','teacher','结合题目、原文和来源决定跟进|当前没有自动 AI 共性错因结论'),
        ('graph',0,1,'知识点前置依赖','data','教师维护无环依赖边|章节组织与前置关系分别维护'),
        ('rule',1,1,'学生生成规则学习路径','system','无评价证据或得分率低于 0.6 入选|补齐前置知识，拓扑排序后保存快照|供学生安排学习，不自动生成教师任务'),
        ('draft',2,1,'教师建立干预草稿','teacher','选学生、已发布资料、已有补练作业|填写执行要求与完成说明'),
        ('assign',3,1,'教师下发任务 assigned','teacher','教师执行 draft → assigned|记录 assigned_at 作为新证据起点'),
        ('learn',3,2,'学生执行补学与补练','external','完成关联资料学习，提交关联练习|执行动作和任务说明均留痕'),
        ('gate',2,2,'校验下发之后的新证据','system','资料须有下发后 completed 记录|补练须有下发后正式提交|历史完成记录不能顶替本轮执行'),
        ('submit',1,2,'学生提交任务完成说明','external','证据条件满足才转 submitted|只允许任务本人提交，正文必填'),
        ('review',0,2,'教师复查 reviewed','teacher','查看执行证据和学生说明|填写复查内容后结束本次任务'),
        ('more',0,3,'需要时新建下一轮干预','teacher','按新证据继续调整学习内容|不把 reviewed 伪画成自动成绩改善'),
        ('ai',1,3,'AI 共性错因诊断','pending','E4 尚未接通正式自动诊断|不将规则聚合改名为 AI 认知诊断'),
        ('personal',2,3,'AI 个性补练生成 / 推荐','pending','尚无依据精炼知识的自动出题闭环|现有补练由教师选择已发布作业'),
        ('qa',3,3,'问答持久历史 / 代表答案入库','pending','当前问答主要为当次检索结果|匿名化代表答案沉淀未接通'),
    ],[
        ('released','view','正式结果'),('activity','view','过程证据'),('view','teacher','供教师判断'),
        ('released','rule','知识点表现'),('graph','rule','前置关系'),
        ('teacher','draft','选择资料与既有练习'),('draft','assign','教师确认下发'),('assign','learn','任务与时间基准'),
        ('learn','gate','核对实际记录'),('gate','submit','条件满足'),('gate','learn','证据不足继续执行'),
        ('submit','review','新证据 + 完成说明'),('review','more','仍需跟进'),('more','draft','另建下一轮'),
    ],evidence='learning/path.go:planPath；feedback.go:interventionState；workspace.go；db/queries/{workspace,learning}.sql；docs/architecture.md',boundary='规则路径只描述选择和排序，不是能力概率或 AI 个性化推荐。教师复查是人工判断，不自动证明学习效果改善。')


def ai_boundary():
    return build('F12','AI 能力边界与证据链','把允许输入、候选输出、人工关口、可追溯证据和未完成评测放在同一张边界图。',[
        ('source',0,0,'输入：获准且可靠的原文','data','课程归属、来源 active 与提炼许可|片段质量 ready，记录原件版本和定位'),
        ('select',1,0,'输入：教师选定范围与要求','teacher','选资料 / 知识 / 原图及用途|服务端重读真实证据，不信客户端正文'),
        ('frozen',2,0,'输入：确切标准与原始作答','data','固定题目、满分、评分点与依据|原始提交、哈希与标准 ID 成组匹配'),
        ('privacy',3,0,'数据最小化与用途过滤','system','学生检索仅可见学习内容|教师私有标准不进入学生响应|规则形成不读取待评学生答案'),
        ('vision',0,1,'视觉 / 提炼 / 比较候选','ai','图像转写、公式、知识与差异建议|来源定位和不确定项随候选保留'),
        ('author',1,1,'题目 / 解答 / 标准候选','ai','依据考查要求起草，可单独分析|原卷提取与模型生成分开记出处'),
        ('grade',2,1,'逐点评分草稿','ai','按固定评分点输出分项与学生原句|禁止用新检索的知识追加扣分条件'),
        ('qa',3,1,'同步检索与引用问答','ai','向量 + 中文关键词，经 RRF 融合|只返回有权限证据；用户可回查原文'),
        ('contentgate',0,2,'教师逐项核对与采纳','teacher','原图对照、内容编辑、冲突决定|合并 / 并存 / 替换等使用并发校验'),
        ('authorgate',1,2,'教师分别审定与版本确认','teacher','题目、参考解答、标准各有状态|采纳不代表确认；满分与来源匹配'),
        ('gradegate',2,2,'教师语义复核后确认发布','teacher','系统先核对格式、引用、分数加和|教师负责评分解释和正式发布'),
        ('trace',3,2,'可追溯证据对象','data','原文 quote、fragment、locator、revision|任务 input/output、profile 与预算调用|评分 rubric / ai_job / regrade 关联'),
        ('budget',0,3,'调用预算与中断处置','system','先预留再调用，费用结果独立结算|未知调用保守结算，不当免费重试|生成任务中断须显式重试'),
        ('effective',1,3,'正式生效边界','data','只由教师确认后的内容进入选用|只有 released 评分进入反馈学情'),
        ('fallback',2,3,'拒绝 / 失败 / 人工兜底','system','证据或版本不符拒绝旧候选覆盖|失败保存错误，不造固定样例响应|可人工编辑、人工评阅或显式重试'),
        ('pending',3,3,'独立效果评测仍未完成','pending','未完成教师盲评、语义准确性与教学效果评价|引用和调用留痕只证明可回查|不据此声称可靠性或正确率达标'),
    ],[
        ('source','vision','许可片段 / 原图'),('select','author','要求与合法依据'),('frozen','grade','冻结输入'),('privacy','qa','授权检索范围'),
        ('vision','contentgate','待核对候选'),('author','authorgate','三个独立草稿'),('grade','gradegate','逐点草稿'),('qa','trace','引用回链'),
        ('contentgate','effective','确认内容'),('authorgate','effective','确认版本'),('gradegate','effective','发布修订'),
        ('vision','trace','候选与输入快照'),('author','trace','出处与模型任务'),('grade','trace','提交哈希与固定标准'),
        ('budget','vision','预留与调用约束'),('budget','author','预算与任务约束'),('budget','grade','预算与任务约束'),
        ('contentgate','fallback','过期或不采纳'),('gradegate','fallback','错误或不可信'),
    ],evidence='rag/{models,jobs,retrieval,workflows,question_bank,vision}.go；learning/{knowledge_decisions,rubrics,feedback}.go',boundary='AI 已接通指存在本地真实模型路径，不代表已经独立评测通过。所有未完成项保留灰色虚框；本轮不调用模型、不花费联调预算。')


def dataflow():
    return build('F13','数据流图 DFD（一级）','以数据变换、存储和消费解释系统；箭头是数据包，不是页面跳转或状态迁移。',[
        ('input',0,0,'E1 教学内容输入','external','文件字节 / URL 快照 / 人工内容|来源说明、许可与组织信息'),
        ('p1',1,0,'P1 导入、解析与人工校正','system','校验内容 → 解析定位 → 可靠片段|校正追加修订；保留原件和旧修订'),
        ('d1',2,0,'D1 内容与文件存储','data','PG：原件、片段、学习资料、知识|文件卷：原件、图像、快照与裁剪'),
        ('p2',3,0,'P2 权限索引与检索','system','可靠内容分块，生成关键词和向量|查询时再次过滤课程、用途与许可'),
        ('model',0,1,'E2 外部模型服务','external','受控请求输入；候选 / 向量 / usage|不持有本系统正式成绩的写权'),
        ('job',1,1,'P3 持久任务与异步执行','system','PG outbox → Redis ID → worker|输入快照、失败、重试与费用结算'),
        ('d2',2,1,'D2 任务、检索与预算存储','data','processing_jobs / model_calls / budget|retrieval_chunks / embeddings / spaces|Redis 仅队列，不是业务事实库'),
        ('outlearn',3,1,'E3 学习内容与问答结果','external','可见正文、引用与定位|返回有权限内容，不扩大原件访问'),
        ('qinput',0,2,'E4 命题与任务编排输入','external','考查要求 / 选用版本 / 审核决定|原文证据与候选采纳信息'),
        ('p4',1,2,'P4 形成题库规则与任务','system','确认题目、解答、标准 → 绑定任务|规则形成独立于待评学生答案'),
        ('d3',2,2,'D3 任务与作答存储','data','题库版本 / 标准 / 作业 / 作业题|私人草稿与不可变 submissions'),
        ('sinput',3,2,'E5 学生作答与学习输入','external','私人草稿、正式答案、学习事件|幂等请求号与任务上下文'),
        ('decision',0,3,'E6 评分与干预人工决定','external','逐点核对 / 确认 / 发布 / 下发|重评统一规则与逐份确认'),
        ('p5',1,3,'P5 评价修订与证据汇总','system','固定规则评阅、复核与批次原子发布|从正式结果按题去重形成评价证据'),
        ('d4',2,3,'D4 正式结果与跟进证据','data','评分修订 / 重评批次与逐份项|学习事件 / 路径 / 干预 / 决定审计'),
        ('p6',3,3,'P6 作答校验与行为采集','system','本人、题目归属、窗口与幂等校验|保存私人草稿 / 不可变原文 / 学习事件'),
        ('p7',2,4,'P7 正式反馈与干预执行','system','按角色裁剪正式反馈、CSV 与证据|下发、完成说明与复查写入独立记录'),
        ('out',3,4,'E7 反馈、CSV 与干预输入输出','external','学生正式反馈与本人任务|教师班级证据、导出与复查决定'),
    ],[
        ('input','p1','文件、快照与元数据'),('p1','d1','原件 / 可靠片段 / 修订'),('d1','p2','可索引正文与资格'),
        ('p2','d2','块、向量与空间'),('d2','p2','索引和当前空间'),('p2','outlearn','授权证据与引用'),
        ('d1','job','原文或固定输入'),('job','model','许可范围 + profile'),('model','job','候选 / 向量 / 用量'),
        ('job','d2','任务产物与计费记录'),('d2','job','待处理任务 / 预算'),('qinput','p4','要求与确认决定'),
        ('d1','p4','合法资料 / 知识证据'),('job','p4','命题与标准候选'),('p4','d3','确认版本与绑定组合'),
        ('sinput','p6','草稿 / 答案 / 行为'),('p6','d3','校验后的草稿 / 正式原文'),('p6','d4','实际学习与提交事件'),('d3','p5','冻结标准 + 作答'),
        ('job','p5','可选评分草稿'),('decision','p5','审核、发布与重评决定'),('p5','d4','追加正式修订与证据'),
        ('d4','p7','去重正式结果 / 任务证据'),('p7','out','反馈、导出与本人任务'),('out','p7','执行说明与复查请求'),('p7','d4','干预执行与复查记录'),
    ],rows=5,evidence='backend/db/migrations/00001–00012；learning/{materials,assessment,feedback,regrade,path}.go；rag/{jobs,retrieval,models}.go',boundary='E 是外部输入输出，P 是处理，D 是存储。外部输入和存储间均经 P 处理，不直接连线；PG 分组实际共用一个库，Redis 只承载异步投递。')


def interfaces():
    return build('F16','接口关系与契约边界','以 API 家族、授权链、输入快照和错误约束组织接口；字段细目继续由契约文档承担。',[
        ('client',0,0,'浏览器统一 API 客户端','external','同源 /api/v1，JSON 响应 data/error|身份来自服务端会话，不信任页面角色'),
        ('session',1,0,'会话与 CSRF 边界','system','identity 注册登录、退出与当前会话|认证写请求校验 CSRF；Cookie 识别用户'),
        ('scope',2,0,'课程与对象授权边界','system','RequireSession → Role / Course|读取对象再核对课程或学生本人归属'),
        ('error',3,0,'公共失败语义','system','400 格式；403 越权；404 无记录|409 状态 / 并发 / 幂等冲突|422 业务拒绝；503 数据操作失败'),
        ('content',0,1,'内容 API 家族','system','/rag/sources、knowledge、jobs、retrieval|原件发布、校正、许可与知识状态|原图、专题、决定与影响独立子路由'),
        ('bank',1,1,'题库 API 家族','system','/question-bank 与 /versions|题目/解答确认；标准创建与确认|整卷采纳、出处与证据重读'),
        ('assignment',2,1,'任务与作答 API 家族','system','/assignments、questions/:id/draft|/assignments/:id/submissions|草稿按人隔离，正式提交 request_id 幂等'),
        ('grading',3,1,'评价与跟进 API 家族','system','/submissions/:id/revisions、/revisions/:id/state|/regrades、/interventions、/evidence|确认、发布与逐份重评受事务控制'),
        ('pg',0,2,'sqlc/store ↔ PostgreSQL','data','参数化 SQL + pgx 事务|锁、状态、唯一性和版本约束落库'),
        ('outbox',1,2,'异步任务输入契约','data','API 持久化 processing_jobs 输入快照|Redis 消息仅携带任务 ID|worker 数据库领取，同一尝试去重'),
        ('worker',2,2,'worker / parser 内部边界','system','任务 kind 分派；解析是本地子进程|结果和错误写任务记录，不直接发布成绩'),
        ('model',3,2,'外部模型 HTTP 契约','external','chat / embedding / vision 分配置|凭据不进前端；预算预留与结算|供应商错误不转成固定样例成功'),
        ('teacher',0,3,'教师调用能力范围','teacher','本人课程内内容、题库、评分与重评|不得借客户端对象 ID 越过课程范围'),
        ('student',1,3,'学生响应裁剪与本人隔离','external','隐藏 correct_answer、rubric 与绑定规则|仅本人提交、笔记、路径和 released 修订'),
        ('cas',2,3,'并发与版本合同','system','知识 edit_version、原文 parse_revision|输入过期拒绝旧候选覆盖|评分仅最新修订可确认、发布'),
        ('idempotent',3,3,'幂等与重试合同','system','同请求号同内容复用，改内容冲突|生成未知调用不自动重发|整组重评冲突整组回滚，不部分发布'),
    ],[
        ('client','session','会话请求'),('session','scope','身份通过'),('scope','content','按课程授权'),('scope','bank','教师权限'),
        ('scope','assignment','成员 / 本人'),('scope','grading','教师 / 本人读'),('content','pg','受控读写'),('bank','pg','版本与快照'),
        ('assignment','pg','事务提交'),('grading','pg','确认 / 发布事务'),('content','outbox','parse / extract 等任务'),
        ('bank','outbox','题目 / 标准候选任务'),('grading','outbox','grade 任务'),('outbox','worker','ID → 快照'),
        ('worker','model','受控模型调用'),('content','model','同步检索与问答'),('teacher','scope','角色与课程'),
        ('student','assignment','个人作答'),('cas','error','过期 / 状态冲突'),('idempotent','error','请求内容冲突'),
    ],evidence='web/src/shared/api.ts；identity/session.go；learning/{http,materials,question_bank,workflow_jobs}.go；rag/jobs.go；docs/contracts.md',boundary='图示 API 家族与契约止点，不把每个处理器虚构成独立网络服务；HTTP 字段、响应结构和完整路由以源码与 contracts.md 为准。')


def deployment():
    return build('F18','部署与信任边界','分开本地当前容器拓扑、可选模型出站与仓库记录的公网旧版配置。',[
        ('browser',0,0,'本机浏览器','external','访问 127.0.0.1:18080|没有数据库、Redis 或 worker 访问入口'),
        ('web',1,0,'Web / Nginx 容器','system','唯一 host 端口：127.0.0.1:18080 → 80|静态 SPA；/api 代理到 api:8080'),
        ('api',2,0,'Gin API 容器','system','会话、课程对象权限、CSRF 校验|本地 RAG overlay 后挂载原件文件卷'),
        ('model',3,0,'第三方模型网络边界','external','API 同步检索/问答，worker 异步调用|生成与 Embedding profile 分开|数据出站范围由任务证据与授权约束'),
        ('pg',0,1,'PostgreSQL / pgvector 容器','data','容器内部 5432，不映射 host 端口|postgres-data 保存业务、版本、预算'),
        ('redis',1,1,'Redis / Asynq 容器','data','容器内部 6379，不映射 host 端口|AOF + redis-data；承担队列投递'),
        ('worker',2,1,'Go worker 容器','system','只消费队列，不提供浏览器 HTTP|rag-worker 镜像内含 Python 解析工具'),
        ('files',3,1,'materials-data 持久卷','data','compose.rag.yaml 显式启用|仅 API 与 worker 挂载 /data/materials|原件下载经过服务端权限检查'),
        ('migrate',0,2,'一次性 Goose 迁移容器','system','postgres healthy 后按 00001–00012 执行|成功后 API / worker 才启动|迁移不等于发布或验收通过'),
        ('secrets',1,2,'本地凭据注入边界','external','忽略文件 env_file 注入 API / worker|凭据不写 SVG、前端、仓库或日志|本轮仅查结构，不读密钥内容'),
        ('recovery',2,2,'队列与调用恢复边界','system','PG outbox 可在 Redis 故障后补投|生成中断显式重试；未知预算保守结算|解析/索引幂等恢复，不自动重发生成'),
        ('default',3,2,'默认 Compose / 可选 RAG','system','默认为人工平台、AI 关闭|overlay 增加 parser、模型和文件卷|运行配置与生产配置严格区分'),
        ('internet',0,3,'公网浏览器 HTTPS','external','仓库记录地址：hajistudy.online|跨公网边界进入主机 TLS 代理'),
        ('tls',1,3,'生产主机 OpenResty','external','TLS 终止后转回环 Web:18080|生产 Compose 私网隔离 PG / Redis'),
        ('production',2,3,'公网旧版部署记录','external','11/05 release：f40872a|AI_ENABLED=false；Secure Cookie|本轮没有读取或变更生产实例'),
        ('limit',3,3,'禁止混用的完成性声明','pending','本地图册 ≠ 新版本公网已部署|有恢复逻辑 ≠ 备份恢复演练通过|代码接通 ≠ 模型效果或生产就绪'),
    ],[
        ('browser','web','本机回环 HTTP'),('web','api','容器内 HTTP'),('api','pg','内部 SQL'),('api','redis','异步投递'),
        ('redis','worker','队列 ID'),('worker','pg','领取 / 产物 / 预算'),('worker','files','读写原件与图像'),('api','files','受控上传下载'),
        ('api','model','本地启用后出站',True),('worker','model','本地启用后出站',True),('migrate','pg','结构版本'),
        ('secrets','api','环境注入'),('secrets','worker','环境注入'),('recovery','redis','补投'),('recovery','pg','任务与计费恢复'),
        ('default','worker','overlay 选择镜像'),('internet','tls','HTTPS'),('tls','production','回环代理到旧版 Web'),
    ],evidence='compose.yaml；compose.rag.yaml；backend/Dockerfile；web/nginx.conf；deploy/{compose.production.yaml,openresty-hajistudy.conf}；AGENTS.md',boundary='本地容器端口已通过 compose ps 核查；公网部分只描述仓库已有部署记录与配置。图中未公开、未读取任何密钥或个人业务数据。')


def packages():
    return build('F19','UML 包图：代码组织与依赖','用真实 Go 包、React 模块和生成关系说明实现组织，避免虚构类继承与微服务。',[
        ('app',0,0,'«package» web/src/app','system','App / Login / navigation / theme|装配会话、角色布局与 live 路由'),
        ('live',1,0,'«package» web/src/live','system','routes / context 与师生业务页面|materials、knowledge、assessment 等'),
        ('shared',2,0,'«package» web/src/shared','system','api / session / ui 等共享部件|统一网络、登录态和通用控件'),
        ('replica',3,0,'«historical» web/src/replica','external','历史复刻源码和目录模板|不作为当前活动业务路由|localStorage 演示不视为数据库事实'),
        ('api',0,1,'«executable» backend/cmd/api','system','初始化 DB、server 与 HTTP 监听|运行 Gin API 进程'),
        ('server',1,1,'«package» internal/server','system','装配路由、健康检查和中间件|注册 identity 与 learning'),
        ('identity',2,1,'«package» internal/identity','system','用户、Session、CSRF 与角色授权|RequireCourse 查询实际成员与教师归属'),
        ('learning',3,1,'«package» internal/learning','system','Handler 编排课程、内容与作业事务|对象归属、版本冻结、评分发布与重评'),
        ('worker',0,2,'«executable» cmd/worker','system','Asynq 服务与 RAG 恢复扫描|与 API 复用相同业务库'),
        ('rag',1,2,'«package» internal/rag','system','Service / Models、jobs 与 retrieval|question_bank / workflows / vision|调用本地解析工具与外部模型'),
        ('store',2,2,'«generated» internal/store','data','sqlc 生成 Queries、参数与结果类型|被 identity、learning、rag 共同调用'),
        ('db',3,2,'«source» db/queries + migrations','data','queries：参数化 SQL 源文件|migrations：Goose 结构演进|先改 SQL，再生成 store'),
        ('parser',0,3,'«tool» tools/parser','system','Python parse.py，作为 worker 子进程|解析与 OCR，不承担独立业务授权'),
        ('vendor',1,3,'«external» 模型 HTTP 服务','external','由 rag 模型配置与预算边界封装|前端不直接持有供应商凭据'),
        ('pg',2,3,'«external» pgx / PostgreSQL','data','pgxpool 连接；事务由业务层协调|数据库约束承接关键一致性检查'),
        ('compose',3,3,'«deployment» Docker Compose','system','构建并运行 Web / API / worker|默认、RAG overlay、生产配置分开'),
    ],[
        ('app','live','imports / routes'),('app','shared','imports'),('live','shared','imports'),('shared','server','HTTP /api/v1'),
        ('api','server','initializes'),('server','identity','registers'),('server','learning','registers'),('learning','identity','auth helpers'),
        ('learning','rag','uses Service'),('worker','rag','Process / Recover'),('identity','store','uses Queries'),('learning','store','uses Queries'),
        ('rag','store','uses Queries'),('db','store','sqlc generates'),('store','pg','executes SQL'),('rag','parser','spawns'),
        ('rag','vendor','HTTP calls'),('compose','api','runs'),('compose','worker','runs'),('compose','app','builds Web'),
    ],evidence='web/src/{app,live,shared,replica}；backend/{cmd,internal,db,tools/parser}；sqlc.yaml；compose*.yaml',boundary='箭头是 imports / uses / generates / runs 等依赖，HTTP 与子进程明确标注。Go 包与文件分工不被误画为面向对象类继承。')


BUILDERS=[context,conceptual,domains,architecture,overall,answering,grading,intervention,ai_boundary,dataflow,interfaces,deployment,packages]
