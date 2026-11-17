-- +goose Up
CREATE TABLE agent_conversations (
 id text PRIMARY KEY,
 course_id text NOT NULL REFERENCES courses(id),
 owner_id text NOT NULL REFERENCES users(id),
 title text NOT NULL,
 mode text NOT NULL CHECK(mode IN ('read-only','auto-review','full-access')),
 profile_id text NOT NULL DEFAULT '',
 learner_context boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_conversations_owner ON agent_conversations(owner_id,course_id,updated_at DESC);
CREATE TABLE agent_messages (
 id text PRIMARY KEY,
 conversation_id text NOT NULL REFERENCES agent_conversations(id),
 role text NOT NULL CHECK(role IN ('user','assistant')),
 content text NOT NULL,
 attachment_ids text[] NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agent_runs (
 id text PRIMARY KEY,
 conversation_id text NOT NULL REFERENCES agent_conversations(id),
 request_id text NOT NULL,
 session_hash text NOT NULL,
 state text NOT NULL CHECK(state IN ('queued','running','waiting_input','waiting_approval','waiting_job','succeeded','failed','canceled','unknown')),
 runtime jsonb NOT NULL DEFAULT '{}',
 error text NOT NULL DEFAULT '',
 cancel_requested boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(conversation_id,request_id)
);
CREATE UNIQUE INDEX agent_one_active ON agent_runs(conversation_id) WHERE state IN ('queued','running','waiting_input','waiting_approval','waiting_job');
CREATE TABLE agent_steps (
 id text PRIMARY KEY,
 run_id text NOT NULL REFERENCES agent_runs(id),
 agent text NOT NULL,
 tool text NOT NULL,
 arguments jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('proposed','executing','succeeded','failed','denied','unknown')),
 result jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_steps_run ON agent_steps(run_id,created_at,id);
CREATE TABLE agent_requests (
 id text PRIMARY KEY,
 run_id text NOT NULL REFERENCES agent_runs(id),
 step_id text NOT NULL REFERENCES agent_steps(id),
 kind text NOT NULL CHECK(kind IN ('input','approval')),
 prompt text NOT NULL,
 fields jsonb NOT NULL,
 snapshot jsonb NOT NULL DEFAULT '{}',
 response jsonb NOT NULL DEFAULT '{}',
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','answered','rejected','expired')),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '8 hours',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(step_id)
);
CREATE TABLE agent_attachments (
 id text PRIMARY KEY,
 conversation_id text NOT NULL REFERENCES agent_conversations(id),
 filename text NOT NULL,
 storage_path text NOT NULL,
 sha256 text NOT NULL,
 size_bytes bigint NOT NULL,
 kind text NOT NULL DEFAULT 'upload' CHECK(kind IN ('upload','export')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agent_events (
 id bigserial PRIMARY KEY,
 conversation_id text NOT NULL REFERENCES agent_conversations(id),
 run_id text NOT NULL REFERENCES agent_runs(id),
 kind text NOT NULL,
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_events_replay ON agent_events(conversation_id,id);

-- +goose Down
DROP TABLE agent_events,agent_attachments,agent_requests,agent_steps,agent_runs,agent_messages,agent_conversations;
