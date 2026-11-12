"""Physical schema, lifecycle sheet, information tree and real sequence diagrams."""
from collections import Counter
from html import escape
import hashlib
import json
import re
from drawing import Diagram, HERE, BG, INK, MUTED, PALETTE, rect, text, wrap, measure
from figures import build


GROUPS={
    '身份课程':['users','sessions','courses','enrollments','knowledge_points','course_edges'],
    '原件与学习资料':['resources','material_sources','material_fragments','material_assets','asset_revisions'],
    '知识与组织':['knowledge_entries','knowledge_topics','topic_links','content_tags','content_decisions'],
    '题库与规则':['question_bank','bank_question_versions','bank_question_assets','rubric_versions'],
    '任务与原始作答':['assignments','questions','answer_drafts','submissions'],
    '评价与重评':['grading_revisions','regrade_batches','regrade_items'],
    '学习与跟进':['learning_events','learning_notes','study_paths','study_path_items','interventions','interactions','research_records','industry_records'],
    '检索与模型运行':['embedding_spaces','retrieval_chunks','chunk_embeddings','processing_jobs','model_calls','model_budget'],
}
PANELS={
    'F14-1':('身份、课程与学习跟进',GROUPS['身份课程']+['resources']+GROUPS['学习与跟进']),
    'F14-2':('资料、知识、检索与模型任务',[x for x in GROUPS['原件与学习资料'] if x!='resources']+GROUPS['知识与组织']+GROUPS['检索与模型运行']),
    'F14-3':('题库、作答、评价与重评',GROUPS['题库与规则']+GROUPS['任务与原始作答']+GROUPS['评价与重评']),
}


def schema_diagrams():
    schema=json.loads((HERE/'schema.json').read_text(encoding='utf-8'))
    root=HERE.parents[2]
    for filename,digest in schema['migrations'].items():
        assert hashlib.sha256((root/'backend/db/migrations'/filename).read_bytes()).hexdigest()==digest, 'Schema snapshot stale: '+filename
    tables={t['name']:t for t in schema['tables']}
    fks=schema['foreign_keys']
    assert set(tables)=={t for names in GROUPS.values() for t in names}
    assert set(tables)=={t for _,names in PANELS.values() for t in names}
    nodes=[]
    domain_of={name:key for key,names in GROUPS.items() for name in names}
    keys={key:'g'+str(i) for i,key in enumerate(GROUPS)}
    for i,(key,names) in enumerate(GROUPS.items()):
        incoming=sum(domain_of[f['from']]!=key and domain_of[f['to']]==key for f in fks)
        body='|'.join(names)+f'|域外入向外键 {incoming} 条'
        nodes.append((keys[key],i%4,i//4,key,'data',body))
    counts=Counter((domain_of[f['from']],domain_of[f['to']]) for f in fks if domain_of[f['from']]!=domain_of[f['to']])
    edges=[(keys[a],keys[b],str(count)+' 条 FK') for (a,b),count in counts.items()]
    d=build('F14','全库表关系总览：41 表 / 103 外键','箭头从引用表所在域指向被引用域；逐表 PK、FK 和可空性展开在 F14-1～F14-3。',nodes,edges,rows=2,row_step=610,
            evidence='schema.json（本地 PostgreSQL 结构目录只读快照）；backend/db/migrations/00001–00012',
            boundary='统计不包含 Goose 元数据表。域内外键在分图展开；content_tags.object_id、evidence、fragment_ids 等业务引用没有物理 FK，不画为实线外键。')
    diagrams=[d]
    aliases={}
    for pi,(_,names) in enumerate(PANELS.values()):
        for i,name in enumerate(names):
            aliases[name]=chr(65+pi)+str(i+1).zfill(2)
    coverage=[]
    for fid,(label,names) in PANELS.items():
        external=sorted({f['to'] for f in fks if f['from'] in names and f['to'] not in names})
        allnames=external+names
        diagram=Diagram(fid,label+'：物理外键','FK 子列 → 父表；? 可空，! 非空；同一对表的多个 FK 合并连线，完整列名保留在表框。',4,(len(allnames)+3)//4,
            'schema.json；对应 00001–00012 迁移（生成时校验 SHA256）',
            '顶部跨域参照只作父表定位，不重复展开其出向关系。实线均为真实数据库 FK；JSON/数组引用和应用校验约束单独见图册说明。',row_step=545)
        for i,name in enumerate(allnames):
            t=tables[name]
            if name in external:
                lines=['跨域父表，完整定义在对应分图','被引用键保持数据库真实定义']
            else:
                pk=next((k['definition'].replace('PRIMARY KEY ','') for k in (t['constraints'] or []) if k['kind']=='p'),None)
                lines=['PK '+pk if pk else '无主键（本表未声明 PK）']
                nullable={c['name']:c['nullable'] for c in t['columns']}
                for fk in [f for f in fks if f['from']==name]:
                    m=re.search(r'FOREIGN KEY \((.*?)\) REFERENCES \w+\((.*?)\)',fk['definition'])
                    child,parent=m.groups()
                    optional=any(nullable[k.strip()] for k in child.split(','))
                    lines.append(('FK? ' if optional else 'FK! ')+child+' → '+aliases[fk['to']]+'.'+parent)
                    coverage.append((fk['from'],fk['to'],fk['definition']))
                if name=='model_budget': lines+=['单例预算，无指向 model_calls 的外键','费用聚合由模型调用代码维护']
                if name in ('content_tags','content_decisions'): lines+=['object_id 为多态业务引用，不是 FK']
                if name=='knowledge_entries': lines+=['evidence / related_ids 等为 JSON 或数组']
                if name=='rubric_versions': lines+=['两种归属 FK 恰有其一（XOR）']
                if name=='retrieval_chunks': lines+=['source / knowledge / resource 恰有其一']
                if name=='embedding_spaces': lines+=['UQ (id, dimensions)：复合外键的父键']
            diagram.node(name,i%4,i//4,aliases[name]+' '+name,lines,'external' if name in external else 'data',status='跨域参照' if name in external else '数据库表')
        pairs={}
        for fk in fks:
            if fk['from'] in names:
                pairs.setdefault((fk['from'],fk['to']),[]).append(fk)
        for (a,b),group in pairs.items():
            diagram.edge(a,b,'FK' if len(group)==1 else f'{len(group)} 条 FK')
        diagram.physical_fk_count=sum(f['from'] in names for f in fks)
        diagram.schema_tables=names
        diagrams.append(diagram)
    assert sorted(coverage)==sorted((f['from'],f['to'],f['definition']) for f in fks),'Missing/duplicated FK coverage'
    return diagrams,{'tables':len(tables),'foreign_keys':len(fks),'aliases':aliases,'panels':{k:v[1] for k,v in PANELS.items()}}


def information_architecture():
    return build('F17','页面信息架构树','以当前导航、路由和 URL 参数为准；同一页面内的工作区写在所属入口下。',[
        ('login',0,0,'登录与角色入口','system','/login → 按角色进入工作台|Require session，页面角色由会话决定'),
        ('course',1,0,'共同：课程上下文','system','顶栏选择课程，URL ?course=...|切课保留当前模块，清除旧对象参数|没有课程：教师进 courses，学生显示提示'),
        ('profile',2,0,'共同：账号资料','system','/teacher/profile、/student/profile|姓名与密码维护，不依赖选中课程'),
        ('legacy',3,0,'旧入口兼容与不存在页面','system','course-twin 按对象/旧 tab 重定向|student-twin / insight → 角色概览|未知地址显示页面不存在，不空白'),
        ('teacher',0,1,'教师工作台 /teacher','teacher','教学概览 / 课程与资源|作业与评价 / 交流与教研'),
        ('student',2,1,'学生工作台 /student','external','学习概览 / 课程与资源|作业与测验 / 任务与交流'),
        ('tover',0,2,'教学概览','system','dashboard：教学看板|intervention：干预任务'),
        ('tcontent',1,2,'课程与资源','system','courses：课程、成员、设置|curriculum：目录与前置关系|materials：原件与已发布学习内容|knowledge：独立知识库|retrieval：检索与问答|content-impact：内容变更与引用影响'),
        ('sover',2,2,'学习概览','system','home：我的概览|learning：规则学习路径'),
        ('scontent',3,2,'课程与资源','system','course-content：课程学习资料|knowledge：可见精炼知识|retrieval：资料问答与原文定位'),
        ('tassessment',0,3,'作业与评价','system','question-bank：题库、标准与整卷拆题|homework：作业中心|quiz：测验|regrades：整组重评'),
        ('tother',1,3,'交流与教研','system','interaction：课程互动|research：人工教研记录|industry-intelligence：行业能力记录'),
        ('sassessment',2,3,'作业与测验','system','homework：作业列表与详情|quiz：测验列表|homework/:assignmentId：作答与提交'),
        ('sother',3,3,'任务与交流','system','intervention/*：老师任务与执行证据|interaction：课程互动'),
        ('taskdetail',0,4,'教师作业子路由','system','homework/new、quiz/new：创建|homework/:assignmentId/edit：编辑|homework/:assignmentId：任务详情|homework/:assignmentId/submissions：提交队列'),
        ('gradedetail',1,4,'教师批阅子路由','system','homework/submissions/:submissionId/grade|原文、逐点标准、AI 草稿与发布|重评批次在 regrades 页面内展开'),
        ('feedback',2,4,'学生正式反馈子路由','system','homework/submissions/:submissionId/feedback|只呈现本人正式 released 结果|答题草稿与个人历史位于任务详情内'),
        ('inside',3,4,'内容与题库的页内工作区','system','原件详情 / 片段核对 / 图像校正|知识审定 / 专题关联 / 来源回查|题目、解答、标准分别编辑确认|属于现有页面，不虚构独立路由'),
    ],[
        ('login','teacher','teacher 会话'),('login','student','student 会话'),('course','teacher','共享课程选择'),('course','student','共享课程选择'),
        ('teacher','tover','分组'),('teacher','tcontent','分组'),('teacher','tassessment','分组'),('teacher','tother','分组'),
        ('student','sover','分组'),('student','scontent','分组'),('student','sassessment','分组'),('student','sother','分组'),
        ('tassessment','taskdetail','子路由'),('tassessment','gradedetail','批阅子路由'),('sassessment','feedback','正式反馈'),
        ('tcontent','inside','页内对象工作区'),('tassessment','inside','题库页内工作区'),
    ],rows=5,row_step=465,evidence='web/src/app/{App.tsx,navigation.ts}；web/src/live/{routes.tsx,context.tsx}；shared/session.tsx',boundary='教师导航 15 个入口，学生导航 9 个入口；profile 为共同账号入口。历史 replica 未纳入当前功能树；页内工作区不冒充新 URL。')


def document_start(fid,title,question,width,height):
    return [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">',
        f'<title id="title">{escape(fid+" "+title)}</title><desc id="desc">{escape(question)}</desc>',
        '<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 1L9 5L0 9Z" fill="#85929B"/></marker></defs>',
        '<g font-family="Microsoft YaHei, sans-serif">',rect(0,0,width,height,BG),text(80,76,fid+'　'+title,40,weight=700),
        text(width-80,76,'2026-11-12 · 本地代码',22,MUTED,anchor='end'),text(80,130,question,25,MUTED)]


def arrow(out,x1,y,x2,label,returning=False):
    dashed=' stroke-dasharray="9 6"' if returning else ''
    out.append(f'<path d="M{x1},{y} H{x2}" stroke="#85929B" stroke-width="2.6" fill="none" marker-end="url(#arr)"{dashed}/>')
    lines=wrap(label,max(180,abs(x2-x1)-30),21)
    assert len(lines)<=2,(label,'sequence label too wide')
    for j,line in enumerate(lines):
        out.append(text((x1+x2)/2,y-14-(len(lines)-1-j)*26,line,21,MUTED,anchor='middle',class_='message-label'))


def states():
    fid,title='F11','六类对象生命周期与迁移关口'
    width,height=2700,2810
    question='每个箭头标出触发动作与前置条件；新修订另建对象，拒绝条件不会偷偷推进状态。'
    out=document_start(fid,title,question,width,height)
    out.append(text(80,180,'绿色：当前可执行迁移　｜　灰色说明：未接通操作　｜　状态冲突时保留原状态、返回拒绝',22,MUTED))
    panels=[
        ('课程',['draft','published'],['教师发布'],[
            '创建课程即 draft；教师拥有者由会话确定。','发布只允许 draft → published；重复或过期状态不会重复推进。',
            '课程成员、目录和内容是独立对象，不因课程发布而自动发布。','当前没有课程 archived 或自动关闭的生命周期操作。']),
        ('学习资料',['draft','published'],['教师审核发布'],[
            '手工资料先 draft；从核对片段发布时在同事务内创建并发布。','原件须 active、解析 ready；所选片段属于当前修订且质量 ready。',
            '发布正文后修订另建版本，supersedes 保留旧文与历史引用。','resources 虽允许 archived，但当前没有资料归档接口；不画已实现箭头。']),
        ('作业 / 测验',['draft','published','closed'],['教师发布','教师关闭'],[
            '草稿可编辑；发布前校验题目、满分与可用题库/标准绑定。','发布固定任务版本；过截止时拒绝新提交，截止不自动改 closed。',
            '发布和关闭是明确命令；closed 任务不再接受新的正式作答。','整组重评要求已关闭，不能用批次更改原题干、选项或满分。']),
        ('题目 / 参考解答 / 标准',[],[],[
            '三条确认链独立；采纳候选不会替代任何一个确认动作。','题目确认核对题意；解答有独立 reference_state，不向学生公开。',
            '标准确认校验逐点满分与真实依据，必须归属确切题目版本。','确认对象不可就地覆盖；后续改动另建版本，不改已发布作业绑定。']),
        ('评分修订',['draft','confirmed','released'],['教师确认最新修订','教师单独发布'],[
            '主观题先保存 draft；AI task succeeded 不是评分 released。','两次迁移均锁定并重查状态、最新修订及整组重评管理边界。',
            '更正追加下一评分修订；旧 released 保留，不原地退回 draft。','客观 quiz 例外：按教师固定答案在提交事务内直接生成 released 规则结果。']),
        ('教师干预任务',['draft','assigned','submitted','reviewed'],['教师下发','学生提交','教师复查'],[
            '创建时验证学生在课程、关联资料与补练已发布。','下发记录 assigned_at；学生本人只能从 assigned 提交完成说明。',
            '关联学习完成与正式补练提交必须发生在下发之后，旧证据不能替代。','教师填写复查内容后 reviewed；继续跟进需另建任务，不自动证明效果。']),
    ]
    node_count,edge_count=0,0
    for index,(name,values,triggers,notes) in enumerate(panels):
        x=80+(index%2)*1340; y=250+(index//2)*815; pw=1200
        out += [rect(x,y,pw,745,'#FFFFFF','#CCD3D2',stroke_width=2),text(x+28,y+49,str(index+1).zfill(2)+'  '+name,29,weight=650)]
        if values:
            sw=(pw-76-50*(len(values)-1))/len(values)
            for j,value in enumerate(values):
                xx=x+38+j*(sw+50); yy=y+135
                out += [f'<g class="state" data-state="{value}">',rect(xx,yy,sw,100,'#EAF1F5','#AFC9DA',stroke_width=2),text(xx+sw/2,yy+60,value,25,INK,650,'middle'),'</g>']
                node_count+=1
                if j:
                    arrow(out,xx-50,yy+50,xx,'')
                    # Trigger captions sit below the states, each in its own row.
                    out.append(text(x+38,y+294+(j-1)*35,values[j-1]+' → '+value+'：'+triggers[j-1],22,'#187653'))
                    edge_count+=1
            ny=y+405
        else:
            for j,label in enumerate(('题目 state','参考解答 reference_state','评分标准 state')):
                yy=y+100+j*116
                out += [text(x+28,yy+36,label,22,MUTED),rect(x+420,yy,220,70,'#EAF1F5','#AFC9DA'),rect(x+840,yy,280,70,'#EAF1F5','#AFC9DA'),
                        text(x+530,yy+44,'draft',24,anchor='middle'),text(x+980,yy+44,'confirmed',24,anchor='middle')]
                arrow(out,x+640,yy+35,x+840,'分别人工确认')
                node_count+=2;edge_count+=1
            ny=y+478
        for j,note in enumerate(notes):
            for k,line in enumerate(wrap(note,pw-85,22)):
                out.append(text(x+34,ny,line,22,MUTED));ny+=31
            ny+=13
        assert ny<y+740,(name,'panel overflow',ny)
    out += [text(80,2748,'核查：learning/http.go、assessment.go、question_bank.go、rubrics.go、feedback.go；db/queries/learning.sql；00001–00012 迁移',20,MUTED),
            text(80,2786,'原件解析、知识条目、处理任务和重评批次有各自生命周期，分别在 F06、F06-1、F09-1 与 F15 的详细图中展开。',21,'#8A622E'),'</g></svg>']
    return '\n'.join(out),dict(id=fid,title=title,question=question,evidence='learning/http.go；assessment.go；question_bank.go；rubrics.go；feedback.go；db/queries/learning.sql',boundary='只画当前可执行迁移；截止不自动关闭，学习资料没有已接通的归档操作。',nodes=node_count,edges=edge_count,width=width,height=height)


SEQUENCES=[
    ('F15','正式提交：幂等、冻结与事务回执',['学生浏览器','Gin / identity','learning.submit','PostgreSQL 事务'],[
        ('band','A　授权与输入边界'),
        (0,1,'POST /assignments/:id/submissions'),(1,2,'Session / CSRF / 学生 / 课程归属'),
        (2,3,'BEGIN；锁定作业；查询本人 request_id'),
        ('band','alt 已存在同请求号'),(3,2,'同作业、同题目、同原文：返回旧提交','return'),(2,0,'复用原回执；不增加 attempt','return'),
        ('note','同请求号改变正文或题目 → 409 request_conflict；旧提交不变。'),
        ('band','else 新请求：重新检查提交窗口'),(2,3,'重读 published / due_at / 任务版本 / 题目归属'),
        ('note','非 published、过截止或题目不属于作业 → 拒绝；事务回滚，不产生新提交。'),
        (2,3,'递增 attempt；写原文 + SHA256 + assignment_version'),(2,3,'同事务写 submission.submitted 学习事件'),
        ('band','opt 客观 quiz'),(2,3,'固定答案规则 → released 修订；标记 graded'),
        ('band','B　成功回执只在 COMMIT 之后'),(2,3,'COMMIT；任一步数据库失败则整体回滚'),(3,2,'返回已持久化提交与时间','return'),(2,0,'正式回执；个人历史可查','return'),
        ('note','回执丢失时用原 request_id 重发；再次作答必须用新请求号并重新通过窗口检查。'),
    ],'learning/assessment.go:submit；drafts.go；db/queries/learning.sql','私人草稿 PUT 与正式提交 POST 分离；每次正式原文不可覆盖。主观题等待评阅，代码题不执行。'),
    ('F15-2','资料解析：持久任务、质量关口与恢复',['教师浏览器','API / materials','PostgreSQL','Redis / Asynq','worker / Python'],[
        ('band','A　原件落地与持久任务'),(0,1,'上传文件或请求公开单页快照'),(1,2,'保存原件元数据、哈希、许可与来源版本'),
        (1,2,'创建 processing_jobs：kind=parse，输入 source_id'),(1,3,'尝试投递任务 ID；PG 为持久 outbox'),(1,0,'返回任务记录供轮询，不宣称解析完成','return'),
        ('note','Redis 暂不可达不抹去 PG 任务；Recover 周期扫描 pending 任务重新投递 ID。'),
        ('band','B　领取、解析与追加修订'),(3,4,'交付任务 ID'),(4,2,'原子 claim → running；核对 active 原件'),
        (4,4,'本地子进程 parse.py：正文 / 表格 / OCR / 定位'),(4,2,'锁任务与原件；追加片段、图像及 parse_revision'),
        (4,2,'任务 succeeded；片段标 ready 或 needs_review'),(0,1,'GET job / source detail'),(1,0,'返回实际片段、质量与可核对定位','return'),
        ('band','alt 失败、取消或中断'),(4,2,'failed/canceled 留痕；已有可用原文修订保留'),
        ('note','解析 / 索引可幂等恢复；生成类不自动重发。未核对 OCR 片段不能发布或用于提炼。'),
        ('band','C　独立人工发布关口'),(0,1,'核对异常片段 → 校正为新修订'),(1,2,'当前修订与质量通过后，选段或全文发布'),
    ],'learning/materials.go；rag/jobs.go:{CreateJob,Recover,Process,Parse}；tools/parser/parse.py','任务 succeeded 与片段可靠是两回事；原文发布、直接索引和知识提炼分别发生。文件字节保存在共享卷，不放进 Redis。'),
    ('F15-3','AI 评分草稿：预算、快照与教师发布',['教师浏览器','API / learning','PostgreSQL','worker / rag','外部模型'],[
        ('band','A　API 重读固定输入；不接受客户端伪造标准'),(0,1,'创建 kind=grade，选择 submission 与 rubric'),(1,2,'重读原文、哈希、题目、匹配 confirmed 标准'),
        (1,2,'持久化任务 input：AnswerHash + Criteria + EvidenceRefs'),(1,3,'经 Redis/Asynq 投递 ID；worker 原子领取'),
        ('band','B　真实调用与计费边界'),(3,2,'校验输入；模型调用前预留预算'),
        ('note','预算不足 / profile 无效 / 证据不符 → 失败，不伪造草稿，也不发正式评分。'),
        (3,4,'冻结题目、标准与原始答案 → 逐点草稿请求'),(4,3,'逐点分、学生原句、依据和反馈 / 供应商错误','return'),
        (3,2,'结算 model_calls；保存任务成功产物或失败'),
        ('note','生成调用中断：超时孤儿 reserved 保守转 unknown 结算；任务 failed，等待显式重试，不自动重发。'),
        ('band','C　候选必须经过人工；job succeeded 不等于成绩发布'),(0,1,'轮询 GET job，读取草稿并核对原文 / 标准 / 依据'),(1,0,'返回任务输出供编辑，不暴露给学生','return'),
        (0,1,'POST submission revisions：逐点分、rubric、ai_job'),(1,2,'核对任务哈希、标准绑定、总分；锁定并追加 draft'),
        (0,1,'教师确认：POST revisions/:id/state confirmed'),(1,2,'仅最新 draft → confirmed；重查批次管理边界'),
        (0,1,'教师再单独发布：state released'),(1,2,'事务转 released 并标记 graded；保留旧修订'),(1,0,'正式结果供学生反馈 / CSV / 学情读取','return'),
    ],'materials.go:createRAGJob；rag/jobs.go:Draft；rag/models.go；learning/feedback.go:{grade,gradeState}','AI 失败可人工评阅；规则形成不读待评答案，评分不临时检索追加扣分点。调用记录和引用不能替代教师语义审核。'),
    ('F15-4','整组重评：冻结、逐份确认与原子发布',['教师浏览器','API / regrade','PostgreSQL 事务','评分草稿任务','正式结果读端'],[
        ('band','A　冻结一个关闭作业的一道题'),(0,1,'预览题目、统一新标准或更正客观答案'),(1,2,'锁作业；校验 closed、同题干/题型/选项/满分'),
        (1,2,'读取每人最新正式提交；未交不补零分'),(0,1,'确认创建批次与原因'),(1,2,'冻结名单、原文哈希、题目快照和评分 baseline'),
        ('band','loop 批次中每一份有效提交'),
        ('note','教师可直接人工评分；以下 AI 草稿为可选分支，不替代人工核对与确认。'),
        (0,1,'可选：请求批次条目的 AI 评分草稿'),(1,3,'冻结原文 + 本批次统一标准'),(3,1,'返回逐点候选；不发布','return'),(1,0,'教师轮询任务后核对候选','return'),
        (0,1,'保存逐份评分并确认；edit_version 防止旧编辑覆盖'),(1,2,'写 regrade_items；confirmed=true'),
        ('band','B　统一发布：一个事务检查所有成员'),(0,1,'POST batch state=released'),(1,2,'BEGIN；锁批次和作业；重查题目快照与证据资格'),
        (1,2,'重查名单、哈希、全部 confirmed、最新评分 baseline'),
        ('note','任一不符 → 409 regrade_conflict + 全组回滚；学生继续看到旧结果，没有部分新成绩。'),
        (1,2,'为每份追加 draft → confirmed → released 修订'),(1,2,'关联批次、标 graded、批次 released；COMMIT'),
        (2,1,'成功；重复同状态命令幂等返回','return'),(1,0,'返回统一发布成功','return'),
        ('band','C　读端下一次请求读取正式结果'),(4,1,'GET 本人反馈或授权学情 / CSV'),(1,2,'查询已发布评分修订'),(2,1,'返回全组提交后的正式结果','return'),(1,4,'按角色裁剪后的正式结果','return'),
        ('band','alt 教师取消 active 批次'),(0,1,'state=canceled'),(1,2,'保留批次与旧结果；不发布草稿'),
    ],'learning/regrade.go:{createRegrade,regradeAI,saveRegradeItem,regradeState,publishRegrade}；db/queries/material_workflows.sql','不改旧题目绑定、不覆盖原始作答、不自动跨作业重评。进入重评管理后普通评分不能绕过批次继续更正；此处没有主动推送。'),
]


def sequences():
    result=[]
    for fid,title,actors,steps,evidence,boundary in SEQUENCES:
        width=2700
        y=385
        positions=[]
        for step in steps:
            positions.append(y)
            y+=78 if isinstance(step[0],str) and step[0]=='band' else 110 if isinstance(step[0],str) else 104
        height=y+220
        out=document_start(fid,title,'从上到下读取真实调用；实线请求、虚线返回；分支文字说明拒绝、回滚、重试与人工兜底。',width,height)
        out.append(text(80,185,'时序分图 1/4' if fid=='F15' else '时序分图 '+fid.split('-')[-1]+'/4',22,'#187653'))
        xs=[220+i*(2260/(len(actors)-1)) for i in range(len(actors))]
        # Frame bands render behind lifelines and messages.
        for step,yy in zip(steps,positions):
            if step[0]=='band':
                out += [rect(90,yy-47,width-180,49,'#E7EAE5','#C4CECA'),text(112,yy-14,step[1],23,INK,600)]
            elif step[0]=='note':
                lines=wrap(step[1],width-300,22)
                out += [rect(125,yy-39,width-250,max(65,len(lines)*30+24),'#FFF3E4','#E1C59E')]
                for j,line in enumerate(lines):out.append(text(145,yy-7+j*30,line,22,'#8A622E'))
        for i,(actor,x) in enumerate(zip(actors,xs)):
            role='external' if actor in ('学生浏览器','外部模型','正式结果读端') else 'teacher' if i==0 else 'data' if 'PostgreSQL' in actor or 'Redis' in actor else 'system'
            fill,stroke,fg,_=PALETTE[role]
            out += [rect(x-175,240,350,82,fill,stroke,stroke_width=2),text(x,291,actor,25,fg,650,'middle'),
                    f'<line x1="{x}" y1="322" x2="{x}" y2="{y-40}" stroke="#BCC7C6" stroke-width="2" stroke-dasharray="9 8"/>']
        msgcount=0
        for step,yy in zip(steps,positions):
            if isinstance(step[0],str):continue
            a,b,label,*tail=step
            msgcount+=1
            returning=bool(tail and tail[0]=='return')
            if a==b:
                x=xs[a]
                sign=-1 if a==len(actors)-1 else 1
                out.append(f'<path d="M{x},{yy-26} h{150*sign} v55 h{-150*sign}" fill="none" stroke="#85929B" stroke-width="2.6" marker-end="url(#arr)"/>')
                out.append(text(x+165*sign,yy+2,label,21,MUTED,anchor='end' if sign<0 else 'start'))
            else:
                arrow(out,xs[a],yy,xs[b],label,returning)
        fy=y+25
        for line in wrap(boundary,width-190,23):out.append(text(80,fy,line,23,'#8A622E'));fy+=32
        for line in wrap('源码核查：'+evidence,width-190,20):out.append(text(80,fy+35,line,20,MUTED));fy+=26
        out.append('</g></svg>')
        result.append(('\n'.join(out),dict(id=fid,title=title,question='真实调用时序、事务边界与失败分支',evidence=evidence,boundary=boundary,nodes=len(actors),edges=msgcount,width=width,height=height)))
    return result
