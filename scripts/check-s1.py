"""Local S1 HTTP checks. Reads ignored generated credentials, never prints them.

Run twice with --save-session before and --resume-session after API restart to
verify persistent session recovery. Does not insert submissions or pretend L3's
assessment integration is implemented.
"""
from pathlib import Path
import argparse
import http.cookiejar
import json
import urllib.request
import urllib.error

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base', default='http://127.0.0.1:18080')
parser.add_argument('--accounts', type=Path, default=Path('.local/s1-accounts.json'))
parser.add_argument('--save-session', action='store_true')
parser.add_argument('--resume-session', action='store_true')
args = parser.parse_args()
fixtures = json.loads(args.accounts.read_text(encoding='utf-8'))
accounts = {item['username']: item for item in fixtures['accounts']}
course = fixtures['course_id']
other = fixtures['other_course_id']
jar_path = args.accounts.parent / 's1-test-cookies.txt'


class Client:
    def __init__(self):
        self.jar = http.cookiejar.MozillaCookieJar(str(jar_path))
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = ''

    def request(self, method, path, body=None, csrf=None, origin=None, expected=200):
        data = json.dumps(body).encode() if body is not None else None
        headers = {'Content-Type': 'application/json'} if data is not None else {}
        if csrf is not None:
            headers['X-CSRF-Token'] = csrf
        if origin is not None:
            headers['Origin'] = origin
        req = urllib.request.Request(args.base + '/api/v1' + path, data=data, headers=headers, method=method)
        try:
            response = self.opener.open(req, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        assert response.code == expected, f'{method} {path}: expected {expected}, got {response.code}'
        result = response.read()
        return json.loads(result) if result else None

    def login(self, name):
        account = accounts[name]
        data = self.request('POST', '/sessions', {'username': name, 'password': account['password'], 'role': 'teacher'})['data']
        assert data['user']['id'] == account['id'] and data['user']['role'] == account['role']
        self.csrf = data['csrf_token']


if args.resume_session:
    client = Client()
    client.jar.load(ignore_discard=True, ignore_expires=True)
    data = client.request('GET', '/me')['data']
    assert data['user']['id'] == accounts['s1-student-a']['id']
    client.request('DELETE', '/sessions/current', csrf=data['csrf_token'], expected=204)
    jar_path.unlink()
    print('PASS: PostgreSQL-backed session survives API restart')
    raise SystemExit(0)

anonymous = Client()
anonymous.request('GET', '/me', expected=401)
anonymous.request('POST', '/sessions', {'username': 's1-student-a', 'password': 'wrong-password'}, expected=401)
anonymous.request('POST', '/sessions', {'username': 'not-an-account', 'password': 'wrong-password'}, expected=401)
anonymous.request('POST', '/sessions', {'username': 's1-student-a', 'password': accounts['s1-student-a']['password']}, origin='http://foreign.invalid', expected=403)
a, b, teacher, foreign_teacher = Client(), Client(), Client(), Client()
for client, name in [(a, 's1-student-a'), (b, 's1-student-b'), (teacher, 's1-teacher'), (foreign_teacher, 's1-teacher-other')]:
    client.login(name)
    assert all(cookie._rest.get('HttpOnly') is not None or 'HttpOnly' in cookie._rest for cookie in client.jar)

a_id = accounts['s1-student-a']['id']
a.request('GET', f'/student/users/{a_id}/context')
b.request('GET', f'/student/users/{a_id}/context', expected=403)
for client, role in [(a, 'student'), (teacher, 'teacher')]:
    client.request('GET', f'/{role}/courses/{course}/context')
    client.request('GET', f'/{role}/courses/{other}/context', expected=403)
    client.request('POST', f'/{role}/courses/{course}/access-check', csrf='', expected=403)
    client.request('POST', f'/{role}/courses/{course}/access-check', csrf='forged', expected=403)
    client.request('POST', f'/{role}/courses/{course}/access-check', csrf=client.csrf, origin='http://foreign.invalid', expected=403)
    result = client.request('POST', f'/{role}/courses/{course}/access-check', csrf=client.csrf, origin=args.base)
    assert result['data']['authorized'] and result['data']['persisted'] is False
a.request('POST', f'/student/courses/{course}/access-check', csrf=b.csrf, expected=403)
a.request('GET', f'/teacher/courses/{course}/context', expected=403)
a.request('GET', f'/student/courses/{fixtures["draft_course_id"]}/context', expected=403)
foreign_teacher.request('GET', f'/teacher/courses/{course}/context', expected=403)
student_courses = a.request('GET', '/me/courses')['data']
assert [c['id'] for c in student_courses] == [course]
assert student_courses[0]['knowledge_point_count'] == 2
teacher_courses = teacher.request('GET', '/me/courses')['data']
assert {c['id'] for c in teacher_courses} == {course, fixtures['draft_course_id']}
print('PASS: login, course/student/role isolation, CSRF, origin and real course queries')

old_cookies = list(b.jar)
b.request('DELETE', '/sessions/current', csrf=b.csrf, expected=204)
for cookie in old_cookies:
    b.jar.set_cookie(cookie)
b.request('GET', '/me', expected=401)
print('PASS: logout invalidates previously issued session')

if args.save_session:
    a.jar.save(ignore_discard=True, ignore_expires=True)
    print('Saved test session to ignored local cookie jar for restart verification')
else:
    a.request('DELETE', '/sessions/current', csrf=a.csrf, expected=204)
for client in (teacher, foreign_teacher):
    client.request('DELETE', '/sessions/current', csrf=client.csrf, expected=204)

handoff = {'course_id': course, 'knowledge_point_ids': fixtures['knowledge_point_ids'], 'student_a_id': a_id,
           'actual_submission_id': None, 'actual_rubric_version': None,
           'blocked_by': 'S1-A2/A3 submission service and S2-L1 rubric persistence are not implemented',
           'ready': ['session_actor', 'course_authorization', 'request_helper', 'grading_contract']}
(args.accounts.parent / 's1-handoff.json').write_text(json.dumps(handoff, ensure_ascii=False, indent=2), encoding='utf-8')
print('L3 handoff: real course/student IDs saved locally; actual submission integration remains pending')
