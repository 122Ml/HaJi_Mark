-- Synthetic identities and data only; not actual teacher approval or a login system.
BEGIN;
INSERT INTO users (id, display_name, role) VALUES
 ('demo-teacher', '示例教师', 'teacher'), ('demo-student', '模拟学生A', 'student')
ON CONFLICT DO NOTHING;
INSERT INTO courses (id, title, teacher_id, status) VALUES
 ('demo-boundary', '软件测试：边界值分析（构造示例）', 'demo-teacher', 'published'),
 ('demo-draft', '未发布课程（不应显示）', 'demo-teacher', 'draft')
ON CONFLICT DO NOTHING;
INSERT INTO enrollments (course_id, student_id) VALUES ('demo-boundary', 'demo-student') ON CONFLICT DO NOTHING;
INSERT INTO knowledge_points (id, course_id, title, position) VALUES
 ('demo-kp-boundary', 'demo-boundary', '整数范围的边界与合法性', 0)
ON CONFLICT DO NOTHING;
COMMIT;
