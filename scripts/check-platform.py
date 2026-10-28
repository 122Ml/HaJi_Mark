"""Exercise the real local teaching loop with explicitly labelled test data.

Reads ignored S1 credentials. Creates a new isolated course per run and retains
its records for restart verification. Never writes the reference site or GitHub.
"""
import argparse
import hashlib
import http.cookiejar
import json
from pathlib import Path
import urllib.request
import urllib.error
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base', default='http://127.0.0.1:18080')
parser.add_argument('--resume', action='store_true')
args = parser.parse_args()
if not args.base.startswith(('http://127.0.0.1:', 'http://localhost:')):
    raise SystemExit('Only a loopback service may be tested')
fixtures = json.loads(Path('.local/s1-accounts.json').read_text(encoding='utf8'))
accounts = {a['username']: a for a in fixtures['accounts']}

class Client:
    def __init__(self, name, password=None):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(self.jar))
        self.name = name
        self.csrf = ''
        data = self.call('POST', '/sessions', {'username': name, 'password': password or accounts[name]['password']})
        self.csrf = data['csrf_token']

    def call(self, method, path, body=None, expected=200):
        data = json.dumps(body, ensure_ascii=False).encode('utf8') if body is not None else None
        headers = {'Origin': args.base, 'X-CSRF-Token': self.csrf}
        if data is not None:
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(args.base + '/api/v1' + path, data=data, headers=headers, method=method)
        try:
            response = self.opener.open(req, timeout=10)
        except urllib.error.HTTPError as e:
            response = e
        payload = response.read()
        assert response.code == expected, f'{method} {path}: expected {expected}, got {response.code}: {payload.decode()}'
        decoded = json.loads(payload) if payload else {}
        return decoded.get('data')

def uid():
    return str(uuid.uuid4())

t = Client('s1-teacher')
a = Client('s1-student-a')
b = Client('s1-student-b')
u = Client('s1-teacher-other')
clients = (t, a, b, u)
try:
    if args.resume:
        ids = json.loads(Path('.local/platform-check.json').read_text(encoding='utf8'))
        prefix = '/learning/courses/' + ids['course_id']
        result = a.call('GET', prefix + '/submissions/' + ids['submission_id'])
        assert result['submission']['answer_text'] == ids['answer_text']
        assert result['revisions'][0]['score'] == 8
        assert any(i['status'] == 'reviewed' for i in a.call('GET', prefix + '/interventions'))
        print('PASS: real submissions, released results and intervention review survive API/database restart')
    else:
        course = t.call('POST', '/learning/courses', {'title': '自动验收课程 ' + uid()[:8]})
        prefix = '/learning/courses/' + course['id']
        renamed = t.call('PUT', prefix, {'title': course['title'] + '（验收）'})
        assert renamed['title'].endswith('（验收）')
        template_course = t.call('POST', '/learning/courses', {'title': '目录导入验收 ' + uid()[:8]})
        template_path = '/learning/courses/' + template_course['id'] + '/curriculum'
        template = {'chapters': [{'title': '第一章', 'sections': [{'title': '第一节', 'points': ['完整性', '准确性']}]}]}
        assert t.call('POST', template_path, template)['imported'] == 4
        t.call('POST', template_path, template, expected=409)
        for username in ('s1-student-a', 's1-student-b'):
            t.call('POST', prefix + '/members', {'username': username})
        a.call('GET', prefix, expected=403)
        t.call('POST', prefix + '/publish', {})
        u.call('GET', prefix, expected=403)
        point = t.call('POST', prefix + '/points', {'title': '数据质量', 'position': 0})
        chapter=t.call('POST',prefix+'/points',{'title':'数据工程','position':1,'kind':'chapter'})
        section=t.call('POST',prefix+'/points',{'title':'质量与核查','position':2,'kind':'section','parent_id':chapter['id']})
        next_point=t.call('POST',prefix+'/points',{'title':'异常来源核对','position':3,'kind':'point','parent_id':section['id']})
        t.call('POST',prefix+'/edges',{'from_id':point['id'],'to_id':next_point['id']})
        t.call('POST',prefix+'/edges',{'from_id':next_point['id'],'to_id':point['id']},expected=422)
        a.call('POST',prefix+'/path',{})
        path=a.call('GET',prefix+'/path')
        assert [i['knowledge_point_id'] for i in path['items']]==[point['id'],next_point['id']]
        assert b.call('GET',prefix+'/path') is None
        resource = t.call('POST', prefix + '/resources', {'title': '构造资料：数据质量检查', 'content': '完整性指字段齐全；准确性需核对原始来源。', 'source_url': '', 'locator': '第1段', 'knowledge_point_id': point['id']})
        assert a.call('GET', prefix + '/resources') == []
        a.call('POST', prefix + '/resources/' + resource['id'] + '/events', {'verb': 'opened', 'request_id': uid()}, expected=403)
        t.call('POST', prefix + '/resources/' + resource['id'] + '/publish', {})
        updated_resource=t.call('POST',prefix+'/resources/'+resource['id']+'/revisions',{'title':'构造资料修订','content':'补充质量核查记录，旧原文仍保留。','source_url':'','locator':'第2段'})
        assert updated_resource['version']==2 and updated_resource['supersedes_id']==resource['id']
        assert len(a.call('GET',prefix+'/resources'))==1
        t.call('POST',prefix+'/resources/'+updated_resource['id']+'/publish',{})
        assert len(a.call('GET',prefix+'/resources'))==2
        event_request = {'verb': 'completed', 'request_id': uid()}
        event = a.call('POST', prefix + '/resources/' + resource['id'] + '/events', event_request)
        assert a.call('POST', prefix + '/resources/' + resource['id'] + '/events', event_request)['id'] == event['id']
        a.call('POST', prefix + '/resources/' + resource['id'] + '/events', {**event_request, 'verb': 'opened'}, expected=409)
        assert b.call('GET', prefix + '/events') == []
        note_path = prefix + '/resources/' + resource['id'] + '/note'
        a.call('PUT', note_path, {'note': '个人笔记😀', 'favorite': True})
        assert a.call('GET', prefix + '/notes')[0]['note'] == '个人笔记😀'
        assert b.call('GET', prefix + '/notes') == []
        print('PASS: course ownership, member management, draft filtering, reviewed resources and learning event idempotency')

        assignment = t.call('POST', prefix + '/assignments', {'title': '构造主观题', 'type': 'subjective', 'questions': [{'prompt': '说明完整性与准确性的检查方法', 'max_score': 10, 'rubric': '完整性4分，准确性6分。'}]})
        ap = prefix + '/assignments/' + assignment['id']
        assignment = t.call('PUT', ap, {'title': '构造主观题（已编辑）', 'type': 'subjective', 'questions': [{'prompt': '说明完整性与准确性的检查方法', 'max_score': 10, 'rubric': '完整性4分，准确性6分。', 'knowledge_point_id': point['id'], 'resource_id': resource['id']}]})
        assert assignment['version'] == 2
        assert len(t.call('GET', prefix + '/assignments')) == 1
        assert a.call('GET', prefix + '/assignments') == []
        a.call('GET', ap, expected=403)
        t.call('POST', ap + '/state', {'state': 'published'})
        t.call('PUT', ap, {'title': '不应修改', 'type': 'subjective', 'questions': [{'prompt': '修改', 'max_score': 10, 'rubric': '修改'}]}, expected=409)
        detail = a.call('GET', ap)
        question = detail['questions'][0]
        assert question['rubric'] == '' and question['correct_answer'] == ''
        answer = '检查缺失字段\n核对原始来源，记录异常😀'
        draft_path = ap + '/questions/' + question['id'] + '/draft'
        a.call('PUT', draft_path, {'answer_text': answer})
        assert a.call('GET', draft_path)['answer_text'] == answer
        assert b.call('GET', draft_path) is None
        body = {'question_id': question['id'], 'answer_text': answer, 'request_id': uid()}
        submission = a.call('POST', ap + '/submissions', body)
        assert submission['assignment_version'] == assignment['version']
        assert submission['answer_sha256'] == hashlib.sha256(answer.encode()).hexdigest()
        assert a.call('POST', ap + '/submissions', body)['id'] == submission['id']
        a.call('POST', ap + '/submissions', {**body, 'answer_text': '修改'}, expected=409)
        another = a.call('POST', ap + '/submissions', {**body, 'request_id': uid(), 'answer_text': '第二次作答'})
        assert another['attempt'] == 2
        sp = prefix + '/submissions/' + submission['id']
        b.call('GET', sp, expected=403)
        assert len(b.call('GET', ap + '/submissions')) == 0
        assert t.call('GET', sp)['submission']['answer_text'] == answer
        t.call('POST', sp + '/revisions', {'score': 11, 'feedback': '不合法', 'request_id': uid()}, expected=422)
        grade_body = {'score': 8, 'feedback': '方法正确，补充记录。', 'request_id': uid()}
        grade = t.call('POST', sp + '/revisions', grade_body)
        assert t.call('POST', sp + '/revisions', grade_body)['id'] == grade['id']
        assert a.call('GET', sp)['revisions'] == []
        state_path = prefix + '/revisions/' + grade['id'] + '/state'
        t.call('POST', state_path, {'state': 'released'}, expected=409)
        t.call('POST', state_path, {'state': 'confirmed'})
        assert a.call('GET', sp)['revisions'] == []
        t.call('POST', state_path, {'state': 'released'})
        assert a.call('GET', sp)['revisions'][0]['score'] == 8
        evidence = a.call('GET', prefix + '/evidence')
        assert len(evidence) == 1 and evidence[0]['submission_id'] == submission['id']
        assert b.call('GET', prefix + '/evidence') == []
        assert evidence[0]['knowledge_point_id'] == point['id'] and evidence[0]['resource_id'] == resource['id']
        a.call('POST',prefix+'/path',{})
        path=a.call('GET',prefix+'/path')
        assert path['path']['rule_version']=='released-performance-prerequisite-v1'
        t.call('POST', ap + '/state', {'state': 'closed'})
        a.call('POST', ap + '/submissions', {**body, 'request_id': uid()}, expected=409)
        print('PASS: immutable submissions, Unicode/hash/attempts, drafts, duplicate requests, grade bounds, confirmation/publication and released evidence')

        quiz_questions = [
            {'prompt': '哪项是数据质量维度？', 'max_score': 10, 'rubric': '按教师答案判分', 'options': ['完整性', '窗口颜色'], 'correct_answer': '完整性'},
            {'prompt': '准确性需要核对什么？', 'max_score': 10, 'rubric': '按教师答案判分', 'options': ['原始来源', '窗口颜色'], 'correct_answer': '原始来源'},
        ]
        quiz = t.call('POST', prefix + '/assignments', {'title': '构造客观题', 'type': 'quiz', 'questions': quiz_questions})
        qp = prefix + '/assignments/' + quiz['id']
        t.call('POST', qp + '/state', {'state': 'published'})
        q = a.call('GET', qp)['questions'][0]
        assert q['correct_answer'] == ''
        qs = a.call('POST', qp + '/submissions', {'question_id': q['id'], 'answer_text': '完整性', 'request_id': uid()})
        assert a.call('GET', prefix + '/submissions/' + qs['id'])['revisions'][0]['score'] == 10
        print('PASS: teacher answer key stays private and objective rule results persist')
        t.call('POST', prefix + '/assignments', {'title': '错误选项验收', 'type': 'quiz', 'questions': [{'prompt': '选项重复', 'max_score': 10, 'rubric': '测试', 'options': ['重复', '重复'], 'correct_answer': '重复'}]}, expected=422)
        t.call('POST', prefix + '/assignments', {'title': '错误知识点验收', 'questions': [{'prompt': '不能以章节充当知识点', 'max_score': 10, 'rubric': '测试', 'knowledge_point_id': chapter['id']}]}, expected=403)

        linked = t.call('POST', prefix + '/interventions', {'student_id': accounts['s1-student-a']['id'], 'title': '关联证据验收', 'description': '重新学习并完成补练', 'resource_id': resource['id'], 'assignment_id': quiz['id']})
        linked_path = prefix + '/interventions/' + linked['id'] + '/state'
        t.call('POST', linked_path, {'state': 'assigned'})
        a.call('POST', linked_path, {'state': 'submitted', 'content': '尚未执行'}, expected=422)
        a.call('POST', prefix + '/resources/' + resource['id'] + '/events', {'verb': 'completed', 'request_id': uid()})
        a.call('POST', linked_path, {'state': 'submitted', 'content': '仅完成学习'}, expected=422)
        a.call('POST', qp + '/submissions', {'question_id': q['id'], 'answer_text': '完整性', 'request_id': uid()})
        a.call('POST', linked_path, {'state': 'submitted', 'content': '仅补练一题'}, expected=422)
        second_question = a.call('GET', qp)['questions'][1]
        a.call('POST', qp + '/submissions', {'question_id': second_question['id'], 'answer_text': '原始来源', 'request_id': uid()})
        a.call('POST', linked_path, {'state': 'submitted', 'content': '重新学习并补练完成'})
        t.call('POST', linked_path, {'state': 'reviewed', 'content': '已核查新证据'})
        print('PASS: linked intervention requires learning and a new submission after assignment')

        task = t.call('POST', prefix + '/interventions', {'student_id': accounts['s1-student-a']['id'], 'title': '补学复查', 'description': '复习资料并补充原始来源核对记录。'})
        assert not any(i['id'] == task['id'] for i in a.call('GET', prefix + '/interventions'))
        ip = prefix + '/interventions/' + task['id'] + '/state'
        t.call('POST', ip, {'state': 'assigned'})
        b.call('POST', ip, {'state': 'submitted', 'content': '越权'}, expected=403)
        a.call('POST', ip, {'state': 'reviewed', 'content': '自行复查'}, expected=403)
        a.call('POST', ip, {'state': 'submitted', 'content': '补充了来源核对表。'})
        t.call('POST', ip, {'state': 'reviewed', 'content': '复查通过，保留核对表。'})
        post = a.call('POST', prefix + '/interactions', {'kind': 'question', 'title': '如何核对', 'content': '原始来源如何选择？'})
        a.call('POST', prefix + '/interactions', {'kind': 'announcement', 'content': '伪造公告'}, expected=403)
        t.call('POST', prefix + '/interactions', {'kind': 'reply', 'parent_id': post['id'], 'content': '优先使用教师审核后的课程资料。'})
        assert len(b.call('GET', prefix + '/interactions')) == 2
        research = t.call('POST', prefix + '/research', {'title': '课堂观察', 'content': '学生能区分完整性与准确性。'})
        industry = t.call('POST', prefix + '/industry', {'title': '数据质量工程', 'source_url': 'https://example.org/job', 'skills': '数据核查，SQL'})
        assert t.call('PUT', prefix + '/research/' + research['id'], {'title': '课堂复查', 'content': '复查通过'})['title'] == '课堂复查'
        assert t.call('PUT', prefix + '/industry/' + industry['id'], {'title': '质量工程师', 'source_url': 'https://example.org/job', 'skills': 'SQL'})['skills'] == 'SQL'
        t.call('DELETE', prefix + '/research/' + research['id'])
        t.call('DELETE', prefix + '/industry/' + industry['id'])
        assert t.call('GET', prefix + '/research') == [] and t.call('GET', prefix + '/industry') == []
        a.call('GET', prefix + '/research', expected=403)
        overview = t.call('GET', prefix + '/overview')
        assert len(overview) == 2 and next(s for s in overview if s['id'] == accounts['s1-student-a']['id'])['submitted_assignments'] == 2
        print('PASS: intervention state/ownership, shared course discussion, teacher records and real overview')
        provisioned_name = 'check-' + uid()[:12]
        initial_password = uid()
        new_password = uid()
        t.call('POST', prefix + '/students', {'username': provisioned_name, 'display_name': '自动验收新学生', 'password': initial_password})
        student = Client(provisioned_name, initial_password)
        assert student.call('GET', prefix)['course']['id'] == course['id']
        student.call('PUT', '/learning/profile', {'display_name': '自动验收新学生（更新）'})
        student.call('PUT', '/learning/password', {'old_password': initial_password, 'new_password': new_password})
        student.call('GET', '/me', expected=401)
        student = Client(provisioned_name, new_password)
        assert student.call('GET', '/me')['user']['display_name'] == '自动验收新学生（更新）'
        student.call('DELETE', '/sessions/current', expected=204)
        print('PASS: teacher provisioning, profile persistence, password change and session revocation')
        assert not a.call('GET',prefix+'/assist')['configured']
        a.call('POST',prefix+'/assist',{'topic':'解释数据质量'},expected=503)
        print('PASS: curriculum hierarchy, dependency cycle rejection, persistent paths, immutable resource history and AI disabled state')
        Path('.local/platform-check.json').write_text(json.dumps({'course_id': course['id'], 'assignment_id': assignment['id'], 'submission_id': submission['id'], 'resource_id': resource['id'], 'knowledge_point_id': point['id'], 'answer_text': answer}, ensure_ascii=False, indent=2), encoding='utf8')
        print('Real test IDs saved locally for browser/restart checks; labelled test course retained.')
finally:
    for client in clients:
        client.call('DELETE', '/sessions/current', expected=204)
