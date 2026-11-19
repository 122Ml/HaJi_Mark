-- name: ListRubricVersions :many
SELECT id,question_id,version,criteria,state,created_by,created_at,confirmed_at,bank_question_version_id,evidence_refs,
 CASE WHEN bank_question_version_id IS NOT NULL THEN 'bank'::text ELSE 'assignment'::text END AS origin
FROM rubric_versions WHERE question_id=$1 OR id=(SELECT bound_rubric_id FROM questions WHERE id=$1) ORDER BY version DESC;

-- name: GetRubricVersion :one
SELECT * FROM rubric_versions WHERE id=$1;

-- name: LockRubricQuestion :one
SELECT id FROM questions WHERE id=$1 FOR UPDATE;

-- name: CreateRubricVersion :one
INSERT INTO rubric_versions(id,question_id,version,criteria,created_by)
SELECT $1,$2,(COALESCE(MAX(version),0)+1)::integer,$3,$4 FROM rubric_versions WHERE question_id=$2 RETURNING *;

-- name: ConfirmRubricVersion :one
UPDATE rubric_versions SET state='confirmed',confirmed_at=now() WHERE id=$1 AND state='draft' RETURNING *;

-- name: CreatePointRevision :one
INSERT INTO grading_revisions(id,submission_id,revision,score,feedback,reviewer_id,request_id,rubric_id,point_scores)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *;
