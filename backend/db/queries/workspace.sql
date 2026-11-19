-- name: ListAssignmentWorklist :many
SELECT a.*, count(*) OVER()::int AS total,
 (SELECT count(*)::int FROM questions q WHERE q.assignment_id=a.id) AS question_count,
 CASE WHEN NOT sqlc.arg(teacher)::boolean THEN (SELECT count(DISTINCT s.question_id)::int FROM submissions s WHERE s.assignment_id=a.id AND s.student_id=sqlc.arg(actor_id)) ELSE 0 END AS submitted_count,
 CASE WHEN NOT sqlc.arg(teacher)::boolean THEN (SELECT count(DISTINCT d.question_id)::int FROM answer_drafts d JOIN questions q ON q.id=d.question_id WHERE q.assignment_id=a.id AND d.student_id=sqlc.arg(actor_id) AND length(d.answer_text)>0) ELSE 0 END AS draft_count,
 CASE WHEN NOT sqlc.arg(teacher)::boolean THEN (SELECT count(DISTINCT s.question_id)::int FROM submissions s WHERE s.assignment_id=a.id AND s.student_id=sqlc.arg(actor_id) AND EXISTS(SELECT 1 FROM grading_revisions g WHERE g.submission_id=s.id AND g.state='released')) ELSE 0 END AS feedback_count
FROM assignments a
WHERE a.course_id=sqlc.arg(course_id)
 AND (sqlc.arg(teacher)::boolean OR a.status IN ('published','closed'))
 AND (sqlc.arg(kind)::text='' OR a.type=sqlc.arg(kind) OR (sqlc.arg(kind)='homework' AND a.type<>'quiz'))
 AND (sqlc.arg(state)::text='' OR a.status=sqlc.arg(state))
 AND (sqlc.arg(search)::text='' OR a.title ILIKE '%' || sqlc.arg(search) || '%' ESCAPE '\')
 AND (sqlc.arg(point_id)::text='' OR EXISTS(SELECT 1 FROM questions q WHERE q.assignment_id=a.id AND q.knowledge_point_id=sqlc.arg(point_id)))
ORDER BY
 CASE WHEN sqlc.arg(sort_order)::text='due' THEN a.due_at END ASC NULLS LAST,
 CASE WHEN sqlc.arg(sort_order)::text='created' THEN a.created_at END ASC,
 a.created_at DESC, a.id
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: ListSubmissionWorklist :many
SELECT s.id,s.assignment_id,s.question_id,s.student_id,s.attempt,s.status,s.submitted_at,
 u.display_name AS student_name,q.prompt,EXISTS(SELECT 1 FROM submission_import_items i WHERE i.submission_id=s.id) AS teacher_imported,
 COALESCE(g.state,'pending')::text AS review_state,
 count(*) OVER()::int AS total
FROM submissions s JOIN users u ON u.id=s.student_id JOIN questions q ON q.id=s.question_id
LEFT JOIN LATERAL (SELECT state FROM grading_revisions WHERE submission_id=s.id ORDER BY revision DESC LIMIT 1) g ON true
WHERE s.assignment_id=sqlc.arg(assignment_id)
 AND (sqlc.arg(search)::text='' OR u.display_name ILIKE '%' || sqlc.arg(search) || '%' ESCAPE '\' OR u.username ILIKE '%' || sqlc.arg(search) || '%' ESCAPE '\')
 AND (sqlc.arg(state)::text='' OR COALESCE(g.state,'pending')=sqlc.arg(state))
ORDER BY s.submitted_at,s.id
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);
