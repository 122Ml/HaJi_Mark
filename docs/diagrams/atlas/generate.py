"""Build all 19 diagram types and eight focused detail sheets from current evidence."""
from html import escape
import importlib.util
import json
import xml.etree.ElementTree as ET
from drawing import HERE, BG, MUTED, save, text
from figures import BUILDERS
from technical import schema_diagrams, information_architecture, states, sequences


def reference_diagrams():
    # The user's same-directory references remain the visual and factual authority.
    spec=importlib.util.spec_from_file_location('reference_diagrams',HERE.parent/'generate.py')
    ref=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ref)
    entries=[
        ('F06','资料与知识工作流：原文与发布',ref.materials,'原件如何成为可靠原文、发布资料和合法提炼输入？','materials.go；assets.go；asset_crop.go；source_url.go；rag/jobs.go；rag/vision.go','原文发布、直接索引、知识提炼独立分支；完整知识审核与冲突决定继续见 F06-1。'),
        ('F06-1','资料与知识工作流：知识审定与冲突',ref.knowledge,'精炼知识如何审核、分配用途、比较冲突并保留历史证据？','materials.go；knowledge_decisions.go；topics.go；rag/retrieval.go；rag/workflows.go','普通新版不自动废止旧版；归档和许可撤回限制未来使用，历史评分快照保持。'),
        ('F07','命题与标准：分别审定与版本冻结',ref.questions,'从合法依据、整卷拆题或手工录入，怎样形成可用于作业的确切规则组合？','question_bank.go；rubrics.go；paper.go；rag/question_bank.go；db/migrations/00011–00012','候选、主动采纳、分别确认是不同关口。题目、参考解答、标准必须分别审定；没有原卷答案时留空，不冒充提取结果。'),
        ('F09-1','内容变更与整组统一重评',ref.changes,'内容改变如何追踪影响，重评如何冻结范围并保证整组一致发布？','workflow_jobs.go；regrade.go；knowledge_decisions.go；db/queries/material_workflows.sql','批次只针对所选关闭作业的一道题。失败或取消保留旧结果，不能部分发布；不自动跨作业更改成绩。'),
    ]
    result=[]
    for fid,title,builder,question,evidence,boundary in entries:
        root=builder()
        ns={'s':'http://www.w3.org/2000/svg'}
        root.find('.//s:text',ns).text=fid+'　'+title
        for label in root.findall('.//s:text',ns):
            if label.text=='已实现':label.text='本地接通'
        root.set('aria-label',fid+' '+title)
        width,height=int(root.get('width')),int(root.get('height'))
        root.set('height',str(height+175));root.set('viewBox',f'0 0 {width} {height+175}')
        root.find('s:title',ns).text=fid+' '+title
        footer=ET.fromstring('<g xmlns="http://www.w3.org/2000/svg" font-family="Microsoft YaHei, sans-serif">'+
            f'<rect y="{height}" width="{width}" height="175" fill="{BG}"/>'+text(80,height+42,'本地代码接通 ≠ 独立教师验收 / 模型正确性 / 公网部署',22,'#8A622E')+
            text(80,height+84,'源码核查：'+evidence,19,MUTED)+text(80,height+125,boundary,20,MUTED)+'</g>')
        root.append(footer)
        result.append((ET.tostring(root,encoding='unicode'),dict(id=fid,title=title,question=question,evidence=evidence,boundary=boundary,
            nodes=sum(e.get('class')=='node' for e in root.iter()),edges=sum(e.get('class')=='edge' for e in root.iter()),width=width,height=height+175)))
    return result


def write_viewer(manifest):
    primary=[f for f in manifest if '-' not in f['id']]
    buttons=''.join(f'<button data-id="{f["id"]}" type="button">{f["id"]}　{escape(f["title"])}</button>' for f in primary)
    template=(HERE/'viewer.html').read_text(encoding='utf-8')
    panels=[]
    for f in manifest:
        svg=(HERE/(f['id']+'.svg')).read_text(encoding='utf-8')
        # All sheets share an HTML document, so marker and title IDs need a prefix.
        svg=svg.replace('id="','id="'+f['id']+'-').replace('url(#','url(#'+f['id']+'-')
        svg=svg.replace('aria-labelledby="title desc"',f'aria-labelledby="{f["id"]}-title {f["id"]}-desc"')
        panels.append('<div class="sheet" data-sheet="'+f['id']+'" hidden>'+svg+'</div>')
    (HERE/'index.html').write_text(template.replace('<!-- NAV -->',buttons).replace('<!-- SHEETS -->',''.join(panels)).replace('/* MANIFEST */',json.dumps(manifest,ensure_ascii=False)),encoding='utf-8')


def main():
    manifest=[]
    for builder in BUILDERS:
        d=builder()
        if d.id=='F04':
            for label,row in [('活动前端 / 同源入口',0),('Go API 进程内模块',1),('持久存储与任务投递',2),('worker 进程 / 本地工具 / 外部模型',3)]:
                d.zone(label,0,row,4,1)
        if d.id=='F18':
            d.zone('本地当前拓扑与配置边界',0,0,4,3)
            d.zone('公网部分：仓库旧部署记录，未执行生产复查',0,3,4,1,'#ECEBE6')
        manifest.append(save(d))
    schema,coverage=schema_diagrams()
    for d in schema:
        meta=save(d)
        if hasattr(d,'physical_fk_count'):
            meta['physical_foreign_keys']=d.physical_fk_count
            meta['owned_tables']=d.schema_tables
        manifest.append(meta)
    manifest.append(save(information_architecture()))
    for svg,meta in reference_diagrams()+[states()]+sequences():
        (HERE/(meta['id']+'.svg')).write_text(svg,encoding='utf-8')
        manifest.append(meta)
        print(f'{meta["id"]}: {meta["nodes"]} nodes / {meta["edges"]} relations',flush=True)
    manifest.sort(key=lambda f:tuple(int(x[1:] if i==0 else x) for i,x in enumerate(f['id'].split('-'))))
    assert {f['id'] for f in manifest if '-' not in f['id']}=={'F'+str(i).zfill(2) for i in range(1,20)}
    (HERE/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (HERE/'schema-coverage.json').write_text(json.dumps(coverage,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    write_viewer(manifest)
    print(f'Generated {len(manifest)} sheets; schema coverage {coverage["tables"]} tables / {coverage["foreign_keys"]} FK',flush=True)


if __name__=='__main__':main()
