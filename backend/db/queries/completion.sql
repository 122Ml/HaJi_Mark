-- name: CreateAssistTurn :one
INSERT INTO assist_turns(id,course_id,owner_id,request_id,question,profile_id,resource_id) VALUES($1,$2,$3,$4,$5,$6,$7)
ON CONFLICT(course_id,owner_id,request_id) DO NOTHING RETURNING *;

-- name: ExpireStaleAssistTurns :exec
UPDATE assist_turns SET state='failed',response='{}' WHERE state='running' AND created_at < now() - interval '5 minutes';

-- name: GetAssistTurnByRequest :one
SELECT * FROM assist_turns WHERE course_id=$1 AND owner_id=$2 AND request_id=$3;

-- name: GetAssistTurn :one
SELECT * FROM assist_turns WHERE id=$1 AND course_id=$2 AND owner_id=$3;

-- name: FinishAssistTurn :exec
UPDATE assist_turns SET response=$2,state=$3 WHERE id=$1 AND state='running';

-- name: ListAssistHistory :many
SELECT id,question,state,resource_id,created_at,count(*) OVER()::int AS total FROM assist_turns
WHERE course_id=$1 AND owner_id=$2
ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: GetSubmissionImportByRequest :one
SELECT * FROM submission_imports WHERE imported_by=$1 AND request_id=$2;

-- name: CreateSubmissionImport :one
INSERT INTO submission_imports(id,course_id,assignment_id,question_id,imported_by,request_id,input_hash)
VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *;

-- name: AddSubmissionImportItem :exec
INSERT INTO submission_import_items(batch_id,submission_id,row_number) VALUES($1,$2,$3);

-- name: AddImportedSubmissionEvent :exec
INSERT INTO learning_events(id,course_id,actor_id,submission_id,verb,request_id,object_version,occurred_at)
VALUES($1,$2,$3,$4,'submission.imported',$5,$6,$7);

-- name: ListSubmissionImportItems :many
SELECT s.*,i.row_number FROM submission_import_items i JOIN submissions s ON s.id=i.submission_id WHERE i.batch_id=$1 ORDER BY i.row_number;

-- name: GetSubmissionImportOrigin :one
SELECT b.id,b.imported_by,b.created_at,i.row_number FROM submission_import_items i JOIN submission_imports b ON b.id=i.batch_id WHERE i.submission_id=$1;

-- name: ListSubmissionImports :many
SELECT b.*,count(i.submission_id)::int AS answer_count FROM submission_imports b
JOIN submission_import_items i ON i.batch_id=b.id WHERE b.assignment_id=$1
GROUP BY b.id ORDER BY b.created_at DESC,b.id DESC;

-- name: ListAgentConversationPage :many
SELECT * FROM agent_conversations WHERE course_id=$1 AND owner_id=$2
 AND (sqlc.arg(search)::text='' OR title ILIKE '%' || sqlc.arg(search) || '%' ESCAPE '\')
ORDER BY updated_at DESC,id LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: ListAgentTimeline :many
SELECT id,kind,kind_order,created_at FROM (
 SELECT m.id,'message'::text AS kind,m.created_at,0 AS kind_order FROM agent_messages m WHERE m.conversation_id=sqlc.arg(conversation_id)
 UNION ALL
 SELECT r.id,'run'::text AS kind,r.created_at,1 AS kind_order FROM agent_runs r WHERE r.conversation_id=sqlc.arg(conversation_id)
) timeline
WHERE (created_at,kind_order,id)<(sqlc.arg(before_time)::timestamptz,sqlc.arg(before_kind_order)::int,sqlc.arg(before_id)::text)
ORDER BY created_at DESC,kind_order DESC,id DESC LIMIT 51;

-- name: ListAgentPageMessages :many
SELECT * FROM agent_messages WHERE conversation_id=$1 AND id=ANY(sqlc.arg(ids)::text[]) ORDER BY created_at,id;

-- name: ListAgentPageAttachments :many
SELECT a.id,a.conversation_id,a.filename,a.sha256,a.size_bytes,a.kind,a.created_at
FROM agent_attachments a WHERE a.conversation_id=$1 AND (
 a.id=ANY(sqlc.arg(ids)::text[]) OR a.id IN (
  SELECT r.id FROM agent_attachments r WHERE r.conversation_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 200
 )) ORDER BY a.created_at,a.id;

-- name: ListAgentPageRuns :many
SELECT a.id,a.conversation_id,a.request_id,a.state,a.error,a.cancel_requested,a.created_at,a.updated_at,a.stream_text,a.stream_turn FROM agent_runs a
WHERE a.conversation_id=$1 AND (a.id=ANY(sqlc.arg(ids)::text[]) OR a.state IN ('queued','running','waiting_input','waiting_approval','waiting_job')
 OR a.id IN (SELECT r.id FROM agent_runs r WHERE r.conversation_id=$1 ORDER BY r.updated_at DESC,r.id DESC LIMIT 10)) ORDER BY a.created_at DESC,a.id DESC;

-- name: ListAgentPageSteps :many
SELECT * FROM agent_steps WHERE run_id=ANY(sqlc.arg(ids)::text[]) ORDER BY created_at,id;

-- name: ListAgentPageRequests :many
SELECT * FROM agent_requests WHERE run_id=ANY(sqlc.arg(ids)::text[]) ORDER BY created_at,id;
