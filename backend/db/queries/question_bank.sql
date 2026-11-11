-- name: CreateQuestionBank :one
INSERT INTO question_bank(id,course_id,created_by) VALUES($1,$2,$3) RETURNING *;

-- name: GetQuestionBank :one
SELECT * FROM question_bank WHERE id=$1 AND course_id=$2;

-- name: LockQuestionBank :one
SELECT * FROM question_bank WHERE id=$1 AND course_id=$2 FOR UPDATE;

-- name: ArchiveQuestionBank :one
UPDATE question_bank SET archived=$3 WHERE id=$1 AND course_id=$2 RETURNING *;

-- name: ListQuestionBank :many
SELECT b.archived,v.* FROM question_bank b
JOIN LATERAL(SELECT * FROM bank_question_versions v WHERE v.bank_id=b.id ORDER BY version DESC LIMIT 1) v ON true
WHERE b.course_id=$1 ORDER BY b.created_at DESC,b.id;

-- name: CreateBankQuestionVersion :one
INSERT INTO bank_question_versions(id,bank_id,version,title,prompt,type,max_score,requirements,reference_answer,options,correct_answer,knowledge_point_id,evidence_refs,created_by)
SELECT $1,$2,(COALESCE(MAX(version),0)+1)::integer,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
FROM bank_question_versions WHERE bank_id=$2 RETURNING *;

-- name: GetBankQuestionVersion :one
SELECT * FROM bank_question_versions WHERE id=$1;

-- name: ListBankQuestionVersions :many
SELECT * FROM bank_question_versions WHERE bank_id=$1 ORDER BY version DESC;

-- name: ConfirmBankQuestion :one
UPDATE bank_question_versions SET state='confirmed' WHERE id=$1 AND state='draft' RETURNING *;

-- name: ConfirmBankReference :one
UPDATE bank_question_versions SET reference_state='confirmed' WHERE id=$1 AND reference_state='draft' RETURNING *;

-- name: ListBankRubrics :many
SELECT * FROM rubric_versions WHERE bank_question_version_id=$1 ORDER BY version DESC;

-- name: CreateBankRubric :one
INSERT INTO rubric_versions(id,bank_question_version_id,version,criteria,evidence_refs,created_by)
SELECT $1,$2,(COALESCE(MAX(version),0)+1)::integer,$3,$4,$5 FROM rubric_versions WHERE bank_question_version_id=$2 RETURNING *;

-- name: BindBankQuestion :exec
UPDATE questions SET bank_question_version_id=$2,bound_rubric_id=$3 WHERE id=$1;

-- name: ListBankUses :many
SELECT q.id AS question_id,q.bank_question_version_id,q.bound_rubric_id,a.id AS assignment_id,a.title,a.status
FROM questions q JOIN assignments a ON a.id=q.assignment_id
JOIN bank_question_versions v ON v.id=q.bank_question_version_id
WHERE v.bank_id=$1 ORDER BY a.created_at DESC,q.position;

-- name: GetBankEvidence :one
SELECT c.id,c.source_id,c.knowledge_id,c.resource_id,c.fragment_ids,c.title,c.heading,c.body,c.locator FROM retrieval_chunks c
LEFT JOIN material_sources s ON s.id=c.source_id
LEFT JOIN knowledge_entries k ON k.id=c.knowledge_id
LEFT JOIN resources r ON r.id=c.resource_id
WHERE c.id=$1 AND c.course_id=$2 AND c.active
AND ((s.state='active') OR
 (k.state='confirmed' AND k.use_for_grading AND NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(k.evidence) ev LEFT JOIN material_sources ms ON ms.id=ev->>'source_id'
  WHERE ms.id IS NULL OR ms.state<>'active' OR NOT ms.allow_derived)) OR
 (r.status='published' AND r.source_id IS NULL));

-- name: ListBankEvidenceScope :many
SELECT id FROM retrieval_chunks WHERE course_id=$1 AND active
AND ((sqlc.arg(source_id)::text<>'' AND source_id=sqlc.arg(source_id))
 OR (sqlc.arg(knowledge_id)::text<>'' AND knowledge_id=sqlc.arg(knowledge_id)))
ORDER BY id LIMIT 100;
