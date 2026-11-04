"""Real local HTTP acceptance of versioned manual grading; retains labelled data."""
from pathlib import Path
import argparse, copy, http.cookiejar, json, sys, urllib.request, urllib.error, uuid

sys.stdout.reconfigure(encoding='utf-8')
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--resume',action='store_true')
args=parser.parse_args()
ROOT=Path(__file__).resolve().parents[1]
BASE='http://127.0.0.1:18080'
accounts={a['username']:a for a in json.loads((ROOT/'.local/s1-accounts.json').read_text(encoding='utf-8'))['accounts']}
checks=[]
def check(name,condition):
    assert condition,name
    checks.append(name)
    print('PASS:',name,flush=True)
def uid():return str(uuid.uuid4())
class Client:
    def __init__(self,name):
        self.csrf=''
        self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.csrf=self.call('POST','/sessions',{'username':name,'password':accounts[name]['password']})['csrf_token']
    def call(self,method,path,body=None,status=200):
        req=urllib.request.Request(BASE+'/api/v1'+path,method=method,data=json.dumps(body,ensure_ascii=False).encode('utf-8') if body is not None else None,headers={'Origin':BASE,'Content-Type':'application/json','X-CSRF-Token':self.csrf})
        try:r=self.opener.open(req,timeout=15)
        except urllib.error.HTTPError as e:r=e
        payload=r.read();assert r.code==status,f'{method} {path}: expected {status}, got {r.code}: {payload.decode()}'
        return json.loads(payload).get('data') if payload else None

t,a,b,u=[Client('s1-'+n) for n in ['teacher','student-a','student-b','teacher-other']]
try:
    if args.resume:
        ids=json.loads((ROOT/'.local/rubric-check.json').read_text(encoding='utf-8'))
        p='/learning/courses/'+ids['course_id']
        s=a.call('GET',p+'/submissions/'+ids['submission_id'])
        check('重启后标准绑定与逐点反馈保留',s['revisions'][0]['score']==6 and len(s['revisions'][0]['point_scores'])==3 and s['revisions'][0]['rubric_id']==ids['rubric_id'])
        check('重启后标准版本历史保留',len(t.call('GET',p+'/questions/'+ids['question_id']+'/rubrics'))>=2)
    else:
        c=t.call('POST','/learning/courses',{'title':'逐点评分验收 '+uid()[:8]});p='/learning/courses/'+c['id']
        for name in ['s1-student-a','s1-student-b']:t.call('POST',p+'/members',{'username':name})
        t.call('POST',p+'/publish',{})
        point=t.call('POST',p+'/points',{'title':'整数边界测试','position':0})
        assignment=t.call('POST',p+'/assignments',{'title':'构造边界值题','description':'自动验收构造数据','type':'subjective','questions':[{'prompt':'年龄18到60，列出整数边界值、分类并解释范围外测试目的。','max_score':10,'rubric':'六值6分，合法性2分，检查拒绝2分。','knowledge_point_id':point['id']}]})
        q=t.call('GET',p+'/assignments/'+assignment['id'])['questions'][0]
        t.call('POST',p+'/assignments/'+assignment['id']+'/state',{'state':'published'})
        criteria=[{'id':'D1','title':'测试值覆盖','max_score':6,'rule':'17、18、19、59、60、61各1分；重复不计，分类错误不扣本维。'}, {'id':'D2','title':'合法性分类','max_score':2,'rule':'已列范围内合法1分，范围外非法1分；同类矛盾该项0分。'}, {'id':'D3','title':'范围外测试目的','max_score':2,'rule':'说明检查系统是否拒绝超范围输入得2分，否则0分。'}]
        rp=p+'/questions/'+q['id']+'/rubrics'
        bad=copy.deepcopy(criteria);bad[0]['max_score']=5
        t.call('POST',rp,{'criteria':bad},422);check('标准加和不符拒绝',True)
        bad=copy.deepcopy(criteria);bad[1]['id']='D1'
        t.call('POST',rp,{'criteria':bad},422);check('重复评分点拒绝',True)
        a.call('POST',rp,{'criteria':criteria},403);u.call('GET',rp,status=403);check('学生与其他教师不能维护标准',True)
        rubric=t.call('POST',rp,{'criteria':criteria})
        check('没有学生答案也能建立标准',rubric['version']==1 and rubric['state']=='draft' and rubric['criteria']==criteria)
        answer='测试17、18、19、59、60、61，这六个年龄都合法，系统应该全部接受。\n原文保留😀'
        s=a.call('POST',p+'/assignments/'+assignment['id']+'/submissions',{'question_id':q['id'],'answer_text':answer,'request_id':uid()})
        points=[{'criterion_id':'D1','score':6,'feedback':'六个值选取完整。','quote':'测试17、18、19、59、60、61'}, {'criterion_id':'D2','score':1,'feedback':'范围内分类正确，17和61分类错误。','quote':'这六个年龄都合法'}, {'criterion_id':'D3','score':0,'feedback':'接受范围外值与测试拒绝行为的目的不符。','quote':'系统应该全部接受'}]
        gp=p+'/submissions/'+s['id']+'/revisions'
        body={'rubric_id':rubric['id'],'points':points,'score':7,'feedback':'覆盖完整，须修正分类与范围外预期。','request_id':uid()}
        t.call('POST',gp,body,422);check('未确认标准不能评分',True)
        t.call('POST',p+'/rubrics/'+rubric['id']+'/confirm',{})
        t.call('POST',p+'/rubrics/'+rubric['id']+'/confirm',{},409);check('确认标准不能原地重复确认',True)
        bad=copy.deepcopy(body);bad['score']=8
        t.call('POST',gp,bad,422);check('总分与逐点加和不符拒绝',True)
        bad=copy.deepcopy(body);bad['points'][0]['score']=7;bad['score']=8
        t.call('POST',gp,bad,422);check('评分点越界拒绝',True)
        bad=copy.deepcopy(body);bad['points'][0]['quote']='原文中不存在的内容'
        t.call('POST',gp,bad,422);check('编造原文引用拒绝',True)
        bad=copy.deepcopy(body);bad['points']=bad['points'][:2]
        t.call('POST',gp,bad,422);check('缺少评分点拒绝',True)
        t.call('POST',gp,{'score':7,'feedback':'试图绕过逐点规则','request_id':uid()},422);check('已配置逐点标准不能绕过',True)
        revision=t.call('POST',gp,body)
        replay=t.call('POST',gp,body)
        check('重复请求幂等且JSONB次序不影响核对',revision['id']==replay['id'])
        bad=copy.deepcopy(body);bad['points'][0]['feedback']='同请求换评语'
        t.call('POST',gp,bad,409);check('同请求换逐点评语冲突',True)
        check('学生看不到草稿',a.call('GET',p+'/submissions/'+s['id'])['revisions']==[])
        b.call('GET',p+'/submissions/'+s['id'],status=403);check('学生不能读他人作答',True)
        check('草稿不计入学情证据',a.call('GET',p+'/evidence')==[])
        state=p+'/revisions/'+revision['id']+'/state'
        t.call('POST',state,{'state':'released'},409);check('不能跳过确认直接发布',True)
        t.call('POST',state,{'state':'confirmed'})
        check('确认后仍未发布不对学生公开',a.call('GET',p+'/submissions/'+s['id'])['revisions']==[])
        t.call('POST',state,{'state':'released'})
        published=a.call('GET',p+'/submissions/'+s['id'])['revisions'][0]
        check('发布后三维与总分可见',published['score']==7 and [v['score'] for v in published['point_scores']]==[6,1,0])
        check('学生反馈不含内部规则',all('rule' not in v for v in published['point_scores']))
        version2=t.call('POST',rp,{'criteria':criteria});t.call('POST',p+'/rubrics/'+version2['id']+'/confirm',{})
        check('新标准不改变旧评分绑定',a.call('GET',p+'/submissions/'+s['id'])['revisions'][0]['rubric_id']==rubric['id'])
        body2=copy.deepcopy(body);body2['request_id']=uid();body2['points'][0]['score']=5;body2['score']=6;body2['feedback']='人工复核后修订，保留历史。'
        rev2=t.call('POST',gp,body2)
        check('新草稿不抹去已发布反馈',a.call('GET',p+'/submissions/'+s['id'])['revisions'][0]['score']==7)
        t.call('POST',state,{'state':'confirmed'},409);check('旧修订不能重新确认',True)
        for st in ['confirmed','released']:t.call('POST',p+'/revisions/'+rev2['id']+'/state',{'state':st})
        ev=a.call('GET',p+'/evidence')
        check('改分后统计不双计',len(ev)==1 and ev[0]['score']==6)
        original=t.call('GET',p+'/submissions/'+s['id'])
        check('旧原文与两次正式修订保留',original['submission']['answer_text']==answer and len(original['revisions'])==2)
        a.call('GET',rp,status=403);check('学生不能查询评分标准规则',True)
        output={'course_id':c['id'],'assignment_id':assignment['id'],'question_id':q['id'],'submission_id':s['id'],'rubric_id':rubric['id'],'rubric_v2_id':version2['id'],'revision_id':rev2['id'],'checks':checks,'ai_calls':0}
        (ROOT/'.local/rubric-check.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
finally:
    for cl in [t,a,b,u]:cl.call('DELETE','/sessions/current',status=204)
print(f'PASS: {len(checks)} structured grading checks; no model calls.')
