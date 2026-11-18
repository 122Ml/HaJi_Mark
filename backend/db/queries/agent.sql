-- name: CreateAgentConversation :one
INSERT INTO agent_conversations(id,course_id,owner_id,title,mode,profile_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *;

-- name: GetAgentConversation :one
SELECT * FROM agent_conversations WHERE id=$1 AND course_id=$2 AND owner_id=$3;

-- name: ListAgentConversations :many
SELECT * FROM agent_conversations WHERE course_id=$1 AND owner_id=$2 ORDER BY updated_at DESC,id LIMIT 100;

-- name: UpdateAgentConversation :one
UPDATE agent_conversations SET mode=$2,profile_id=$3,updated_at=now() WHERE id=$1 RETURNING *;

-- name: LockAgentConversation :one
SELECT * FROM agent_conversations WHERE id=$1 AND course_id=$2 AND owner_id=$3 FOR UPDATE;

-- name: MarkAgentLearnerContext :exec
UPDATE agent_conversations SET learner_context=true,updated_at=now() WHERE id=$1;

-- name: TouchAgentConversation :exec
UPDATE agent_conversations SET updated_at=now() WHERE id=$1;

-- name: SetAgentConversationTitle :exec
UPDATE agent_conversations SET title=$2 WHERE id=$1 AND title='新对话';

-- name: AgentHasActiveRun :one
SELECT EXISTS(SELECT 1 FROM agent_runs WHERE conversation_id=$1 AND state IN ('queued','running','waiting_input','waiting_approval','waiting_job'));

-- name: CreateAgentMessage :exec
INSERT INTO agent_messages(id,conversation_id,role,content,attachment_ids) VALUES($1,$2,$3,$4,$5);

-- name: ListAgentMessages :many
SELECT * FROM (SELECT * FROM agent_messages WHERE conversation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 200) m ORDER BY created_at,id;

-- name: GetAgentRunByRequest :one
SELECT * FROM agent_runs WHERE conversation_id=$1 AND request_id=$2;

-- name: CreateAgentRun :one
INSERT INTO agent_runs(id,conversation_id,request_id,session_hash,state,runtime) VALUES($1,$2,$3,$4,'queued',$5) RETURNING *;

-- name: GetAgentRun :one
SELECT * FROM agent_runs WHERE id=$1;

-- name: GetAgentRunConversation :one
SELECT c.* FROM agent_conversations c JOIN agent_runs r ON r.conversation_id=c.id WHERE r.id=$1;

-- name: ListAgentRuns :many
SELECT id,conversation_id,request_id,state,error,cancel_requested,created_at,updated_at FROM agent_runs WHERE conversation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 30;

-- name: ListReadyAgentRuns :many
SELECT a.id FROM agent_runs a WHERE state IN ('queued','running','waiting_job') OR
 (state IN ('waiting_input','waiting_approval') AND EXISTS(SELECT 1 FROM agent_requests r WHERE r.run_id=a.id AND r.state='pending' AND r.expires_at<=now()))
 ORDER BY updated_at,a.id LIMIT 8;

-- name: UpdateAgentRun :exec
UPDATE agent_runs SET state=$2,runtime=$3,error=$4,updated_at=now() WHERE id=$1;

-- name: ReauthorizeAgentRun :exec
UPDATE agent_runs SET session_hash=$2,updated_at=now() WHERE id=$1;

-- name: CancelAgentRun :exec
UPDATE agent_runs SET cancel_requested=true WHERE id=$1 AND state IN ('queued','running','waiting_input','waiting_approval','waiting_job');

-- name: ListCanceledAgentRuns :many
SELECT id FROM agent_runs WHERE cancel_requested AND state IN ('queued','running','waiting_input','waiting_approval','waiting_job') LIMIT 20;

-- name: CreateAgentStep :one
INSERT INTO agent_steps(id,run_id,agent,tool,arguments,state) VALUES($1,$2,$3,$4,$5,'proposed') ON CONFLICT(id) DO UPDATE SET id=excluded.id RETURNING *;

-- name: GetAgentStep :one
SELECT * FROM agent_steps WHERE id=$1;

-- name: UpdateAgentStep :exec
UPDATE agent_steps SET state=$2,result=$3,updated_at=now() WHERE id=$1;

-- name: ListAgentSteps :many
SELECT * FROM agent_steps WHERE run_id IN (
 SELECT id FROM agent_runs WHERE conversation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 30
) ORDER BY created_at,id;

-- name: CreateAgentRequest :one
INSERT INTO agent_requests(id,run_id,step_id,kind,prompt,fields,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(step_id) DO UPDATE SET step_id=excluded.step_id RETURNING *;

-- name: GetAgentRequestForStep :one
SELECT * FROM agent_requests WHERE step_id=$1;

-- name: GetAgentRequest :one
SELECT * FROM agent_requests WHERE id=$1;

-- name: RespondAgentRequest :one
UPDATE agent_requests SET state=$2,response=$3 WHERE id=$1 AND state='pending' AND expires_at>now() RETURNING *;

-- name: ExpireAgentRequests :exec
UPDATE agent_requests SET state='expired' WHERE run_id=$1 AND state='pending';

-- name: ListAgentRequests :many
SELECT r.* FROM agent_requests r WHERE r.run_id IN (
 SELECT id FROM agent_runs WHERE conversation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 30
) ORDER BY r.created_at,r.id;

-- name: CreateAgentAttachment :one
INSERT INTO agent_attachments(id,conversation_id,filename,storage_path,sha256,size_bytes,kind) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *;

-- name: GetAgentAttachment :one
SELECT * FROM agent_attachments WHERE id=$1 AND conversation_id=$2;

-- name: ListAgentAttachments :many
SELECT id,conversation_id,filename,sha256,size_bytes,kind,created_at FROM agent_attachments WHERE conversation_id=$1 ORDER BY created_at,id LIMIT 200;

-- name: CreateAgentEvent :one
INSERT INTO agent_events(conversation_id,run_id,kind,payload) VALUES($1,$2,$3,$4) RETURNING id;

-- name: ListAgentEvents :many
SELECT * FROM agent_events WHERE conversation_id=$1 AND id>$2 ORDER BY id LIMIT 100;

-- name: SetAgentStream :exec
UPDATE agent_runs SET stream_text=$2,stream_turn=$3 WHERE id=$1 AND state='running' AND NOT cancel_requested;
