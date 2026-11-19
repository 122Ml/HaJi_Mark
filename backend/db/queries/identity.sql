-- name: GetLoginUser :one
SELECT id, username, display_name, role, password_hash FROM users WHERE username = $1;

-- name: CreateSession :exec
INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3);

-- name: GetSessionUser :one
SELECT u.id, u.username, u.display_name, u.role, s.expires_at
FROM sessions s JOIN users u ON u.id = s.user_id
WHERE s.token_hash = $1 AND s.expires_at > now();

-- name: DeleteSession :exec
DELETE FROM sessions WHERE token_hash = $1;

-- name: DeleteExpiredSessions :execrows
DELETE FROM sessions WHERE token_hash IN (
 SELECT token_hash FROM sessions WHERE expires_at <= now() LIMIT 1000
);

-- name: CanAccessCourse :one
SELECT EXISTS (
 SELECT 1 FROM courses c WHERE c.id = sqlc.arg(course_id) AND (
  (sqlc.arg(actor_role)::text = 'teacher' AND c.teacher_id = sqlc.arg(actor_id)) OR
  (sqlc.arg(actor_role)::text = 'student' AND c.status = 'published' AND EXISTS (
   SELECT 1 FROM enrollments e WHERE e.course_id = c.id AND e.student_id = sqlc.arg(actor_id)
  ))
 )
) AS allowed;

-- name: ListActorCourses :many
SELECT c.id, c.title, c.status, c.version, count(k.id) FILTER (WHERE k.kind='point')::int AS knowledge_point_count
FROM courses c LEFT JOIN knowledge_points k ON k.course_id = c.id
WHERE (sqlc.arg(actor_role)::text = 'teacher' AND c.teacher_id = sqlc.arg(actor_id)) OR
 (sqlc.arg(actor_role)::text = 'student' AND c.status = 'published' AND EXISTS (
  SELECT 1 FROM enrollments e WHERE e.course_id = c.id AND e.student_id = sqlc.arg(actor_id)
 ))
GROUP BY c.id ORDER BY c.created_at, c.id;

-- name: GetCourseContext :one
SELECT id, title, status, version FROM courses WHERE id = $1;

-- name: CreateLocalUser :exec
INSERT INTO users (id, username, display_name, role, password_hash)
VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING;

-- name: CreateLocalCourse :exec
INSERT INTO courses (id, title, teacher_id, status)
VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING;

-- name: CreateLocalEnrollment :exec
INSERT INTO enrollments (course_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: CreateLocalKnowledgePoint :exec
INSERT INTO knowledge_points (id, course_id, title, position)
VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING;
