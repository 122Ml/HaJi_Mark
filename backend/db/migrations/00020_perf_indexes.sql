-- +goose Up
-- Performance & covering indexes migration (00020).
CREATE INDEX IF NOT EXISTS enrollments_student_course_idx ON enrollments(student_id, course_id);
CREATE INDEX IF NOT EXISTS knowledge_points_course_point_idx ON knowledge_points(course_id) WHERE kind = 'point';
CREATE INDEX IF NOT EXISTS courses_status_cover_idx ON courses(status) INCLUDE (id, title, version);
CREATE INDEX IF NOT EXISTS assignments_course_created_idx ON assignments(course_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS learning_events_course_occurred_idx ON learning_events(course_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS grading_revisions_submission_state_idx ON grading_revisions(submission_id, state);
CREATE INDEX IF NOT EXISTS answer_drafts_student_question_idx ON answer_drafts(student_id, question_id) WHERE length(answer_text) > 0;

-- +goose Down
DROP INDEX IF EXISTS answer_drafts_student_question_idx;
DROP INDEX IF EXISTS grading_revisions_submission_state_idx;
DROP INDEX IF EXISTS learning_events_course_occurred_idx;
DROP INDEX IF EXISTS assignments_course_created_idx;
DROP INDEX IF EXISTS courses_status_cover_idx;
DROP INDEX IF EXISTS knowledge_points_course_point_idx;
DROP INDEX IF EXISTS enrollments_student_course_idx;
