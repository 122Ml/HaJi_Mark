-- +goose Up
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

CREATE TABLE material_sources (
 id text PRIMARY KEY,
 course_id text NOT NULL REFERENCES courses(id),
 created_by text NOT NULL REFERENCES users(id),
 title text NOT NULL,
 filename text NOT NULL DEFAULT '',
 media_type text NOT NULL DEFAULT 'text/plain',
 storage_path text NOT NULL DEFAULT '',
 source_note text NOT NULL DEFAULT '',
 source_url text NOT NULL DEFAULT '',
 sha256 text NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 supersedes_id text REFERENCES material_sources(id),
 parse_revision integer NOT NULL DEFAULT 0,
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','archived')),
 parse_state text NOT NULL DEFAULT 'queued' CHECK(parse_state IN ('queued','running','ready','failed')),
 parse_error text NOT NULL DEFAULT '',
 allow_derived boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX material_sources_course_idx ON material_sources(course_id,created_at);
CREATE UNIQUE INDEX material_source_successor_idx ON material_sources(supersedes_id) WHERE supersedes_id IS NOT NULL;

CREATE TABLE material_fragments (
 id text PRIMARY KEY,
 source_id text NOT NULL REFERENCES material_sources(id),
 revision integer NOT NULL,
 position integer NOT NULL,
 heading text NOT NULL DEFAULT '',
 body text NOT NULL,
 locator jsonb NOT NULL,
 quality text NOT NULL DEFAULT 'ready' CHECK(quality IN ('ready','needs_review')),
 UNIQUE(source_id,revision,position)
);
ALTER TABLE resources ADD COLUMN source_id text REFERENCES material_sources(id);
ALTER TABLE resources ADD COLUMN fragment_ids text[] NOT NULL DEFAULT '{}';
ALTER TABLE resources ADD COLUMN full_source boolean NOT NULL DEFAULT false;

CREATE TABLE knowledge_entries (
 id text PRIMARY KEY,
 course_id text NOT NULL REFERENCES courses(id),
 created_by text NOT NULL REFERENCES users(id),
 title text NOT NULL,
 body text NOT NULL,
 category text NOT NULL DEFAULT '',
 content_kind text NOT NULL DEFAULT 'concept' CHECK(content_kind IN ('concept','method','rule','example','misconception')),
 conditions text NOT NULL DEFAULT '',
 knowledge_point_ids text[] NOT NULL DEFAULT '{}',
 evidence jsonb NOT NULL DEFAULT '[]',
 related_ids text[] NOT NULL DEFAULT '{}',
 student_visible boolean NOT NULL DEFAULT false,
 use_for_learning boolean NOT NULL DEFAULT true,
 use_for_grading boolean NOT NULL DEFAULT false,
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','confirmed','archived')),
 version integer NOT NULL DEFAULT 1,
 supersedes_id text REFERENCES knowledge_entries(id),
 edit_version integer NOT NULL DEFAULT 1,
 confirmed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_course_state_idx ON knowledge_entries(course_id,state);
CREATE UNIQUE INDEX knowledge_successor_idx ON knowledge_entries(supersedes_id) WHERE supersedes_id IS NOT NULL;

CREATE TABLE embedding_spaces (
 id text PRIMARY KEY,
 profile_id text NOT NULL,
 fingerprint text NOT NULL UNIQUE,
 model text NOT NULL,
 dimensions integer NOT NULL CHECK(dimensions BETWEEN 1 AND 16000),
 chunker_version text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,dimensions)
);
ALTER TABLE courses ADD COLUMN embedding_space_id text REFERENCES embedding_spaces(id);

CREATE TABLE retrieval_chunks (
 id text PRIMARY KEY,
 course_id text NOT NULL REFERENCES courses(id),
 source_id text REFERENCES material_sources(id),
 knowledge_id text REFERENCES knowledge_entries(id),
 resource_id text REFERENCES resources(id),
 fragment_ids text[] NOT NULL DEFAULT '{}',
 title text NOT NULL,
 heading text NOT NULL DEFAULT '',
 body text NOT NULL,
 locator jsonb NOT NULL,
 input_hash text NOT NULL,
 search_tokens text NOT NULL,
 search_document tsvector GENERATED ALWAYS AS (to_tsvector('simple',search_tokens)) STORED,
 active boolean NOT NULL DEFAULT true,
 CHECK(num_nonnulls(source_id,knowledge_id,resource_id)=1)
);
CREATE INDEX retrieval_course_idx ON retrieval_chunks(course_id);
CREATE INDEX retrieval_keywords_idx ON retrieval_chunks USING gin(search_document);

CREATE TABLE chunk_embeddings (
 chunk_id text NOT NULL REFERENCES retrieval_chunks(id) ON DELETE CASCADE,
 space_id text NOT NULL,
 dimensions integer NOT NULL,
 embedding vector NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(chunk_id,space_id),
 FOREIGN KEY(space_id,dimensions) REFERENCES embedding_spaces(id,dimensions),
 CHECK(vector_dims(embedding)=dimensions)
);

CREATE TABLE processing_jobs (
 id text PRIMARY KEY,
 course_id text NOT NULL REFERENCES courses(id),
 created_by text NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('parse','index','extract','rubric','grade')),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','failed','canceled')),
 input jsonb NOT NULL,
 output jsonb NOT NULL DEFAULT '{}',
 progress integer NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
 error text NOT NULL DEFAULT '',
 attempt integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz,
 finished_at timestamptz
);
CREATE INDEX processing_jobs_course_idx ON processing_jobs(course_id,created_at DESC);
CREATE UNIQUE INDEX pending_course_index_idx ON processing_jobs(course_id) WHERE kind='index' AND state='queued';

CREATE TABLE model_budget (
 id integer PRIMARY KEY CHECK(id=1),
 limit_micro_cny bigint NOT NULL DEFAULT 50000000,
 reserved_micro_cny bigint NOT NULL DEFAULT 0,
 spent_micro_cny bigint NOT NULL DEFAULT 10000,
 CHECK(reserved_micro_cny>=0 AND spent_micro_cny>=0)
);
-- Reserve a conservative 0.01 CNY for the two preflight calls (19 reported tokens).
INSERT INTO model_budget(id) VALUES(1);
CREATE TABLE model_calls (
 id text PRIMARY KEY,
 course_id text NOT NULL REFERENCES courses(id),
 actor_id text NOT NULL REFERENCES users(id),
 profile_id text NOT NULL,
 purpose text NOT NULL,
 state text NOT NULL DEFAULT 'reserved',
 reserved_micro_cny bigint NOT NULL,
 charged_micro_cny bigint NOT NULL DEFAULT 0,
 input_tokens bigint NOT NULL DEFAULT 0,
 output_tokens bigint NOT NULL DEFAULT 0,
 duration_ms bigint NOT NULL DEFAULT 0,
 error_code text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rubric_versions ADD COLUMN evidence_refs jsonb NOT NULL DEFAULT '[]';
ALTER TABLE grading_revisions ADD COLUMN ai_job_id text REFERENCES processing_jobs(id);

-- +goose Down
ALTER TABLE grading_revisions DROP COLUMN ai_job_id;
ALTER TABLE rubric_versions DROP COLUMN evidence_refs;
DROP TABLE model_calls,model_budget,processing_jobs,chunk_embeddings,retrieval_chunks;
ALTER TABLE courses DROP COLUMN embedding_space_id;
DROP TABLE embedding_spaces,knowledge_entries;
ALTER TABLE resources DROP COLUMN source_id,DROP COLUMN fragment_ids,DROP COLUMN full_source;
DROP TABLE material_fragments,material_sources;
