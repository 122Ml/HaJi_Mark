-- +goose Up
CREATE TABLE knowledge_topics (
 id text PRIMARY KEY,
 course_id text NOT NULL REFERENCES courses(id),
 title text NOT NULL,
 description text NOT NULL DEFAULT '',
 active boolean NOT NULL DEFAULT true,
 edit_version integer NOT NULL DEFAULT 1,
 UNIQUE(course_id,title)
);
CREATE TABLE topic_links (
 topic_id text NOT NULL REFERENCES knowledge_topics(id),
 source_id text REFERENCES material_sources(id),
 knowledge_id text REFERENCES knowledge_entries(id),
 bank_version_id text REFERENCES bank_question_versions(id),
 CHECK(num_nonnulls(source_id,knowledge_id,bank_version_id)=1)
);
CREATE UNIQUE INDEX topic_source_idx ON topic_links(topic_id,source_id) WHERE source_id IS NOT NULL;
CREATE UNIQUE INDEX topic_knowledge_idx ON topic_links(topic_id,knowledge_id) WHERE knowledge_id IS NOT NULL;
CREATE UNIQUE INDEX topic_question_idx ON topic_links(topic_id,bank_version_id) WHERE bank_version_id IS NOT NULL;
CREATE TABLE content_tags (
 course_id text NOT NULL REFERENCES courses(id),
 object_kind text NOT NULL CHECK(object_kind IN ('source','knowledge','question')),
 object_id text NOT NULL,
 tags text[] NOT NULL DEFAULT '{}',
 knowledge_point_ids text[] NOT NULL DEFAULT '{}',
 PRIMARY KEY(object_kind,object_id)
);
CREATE TABLE material_assets (
 id text PRIMARY KEY,
 source_id text NOT NULL REFERENCES material_sources(id),
 fragment_id text NOT NULL REFERENCES material_fragments(id),
 storage_path text NOT NULL,
 media_type text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('image','formula','chart','diagram','page')),
 locator jsonb NOT NULL,
 native_data jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE asset_revisions (
 id text PRIMARY KEY,
 asset_id text NOT NULL REFERENCES material_assets(id),
 revision integer NOT NULL,
 body text NOT NULL,
 structured jsonb NOT NULL DEFAULT '{}',
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','confirmed')),
 model_job_id text REFERENCES processing_jobs(id),
 created_by text NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(asset_id,revision)
);
CREATE TABLE content_decisions (
 id text PRIMARY KEY,
 course_id text NOT NULL REFERENCES courses(id),
 actor_id text NOT NULL REFERENCES users(id),
 kind text NOT NULL,
 object_id text NOT NULL,
 inputs jsonb NOT NULL DEFAULT '{}',
 output jsonb NOT NULL DEFAULT '{}',
 reason text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bank_question_assets (
 version_id text NOT NULL REFERENCES bank_question_versions(id),
 asset_id text NOT NULL REFERENCES material_assets(id),
 PRIMARY KEY(version_id,asset_id)
);
CREATE INDEX content_decisions_object_idx ON content_decisions(course_id,object_id,created_at);
CREATE UNIQUE INDEX content_decisions_job_idx ON content_decisions(course_id,kind,(inputs->>'job_id')) WHERE kind IN ('paper_adopt','source_suggestions');
ALTER TABLE processing_jobs DROP CONSTRAINT processing_jobs_kind_check;
ALTER TABLE processing_jobs ADD CONSTRAINT processing_jobs_kind_check CHECK(kind IN ('parse','index','extract','rubric','grade','question_generate','question_analyze','bank_rubric','source_suggest','knowledge_compare','vision','paper_split'));
CREATE TABLE regrade_batches (
 id text PRIMARY KEY,
 course_id text NOT NULL REFERENCES courses(id),
 question_id text NOT NULL REFERENCES questions(id),
 rubric_id text REFERENCES rubric_versions(id),
 correct_answer text NOT NULL DEFAULT '',
 reason text NOT NULL,
 question_snapshot jsonb NOT NULL,
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','released','canceled')),
 created_by text NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 released_at timestamptz
);
CREATE UNIQUE INDEX active_question_regrade_idx ON regrade_batches(question_id) WHERE state='active';
CREATE TABLE regrade_items (
 batch_id text NOT NULL REFERENCES regrade_batches(id),
 submission_id text NOT NULL REFERENCES submissions(id),
 answer_sha256 text NOT NULL,
 baseline_revision integer NOT NULL,
 score integer,
 feedback text NOT NULL DEFAULT '',
 point_scores jsonb NOT NULL DEFAULT '[]',
 ai_job_id text REFERENCES processing_jobs(id),
 edit_version integer NOT NULL DEFAULT 1,
 confirmed boolean NOT NULL DEFAULT false,
 PRIMARY KEY(batch_id,submission_id)
);
ALTER TABLE grading_revisions ADD COLUMN regrade_batch_id text REFERENCES regrade_batches(id);

-- +goose Down
ALTER TABLE grading_revisions DROP COLUMN regrade_batch_id;
DROP TABLE regrade_items,regrade_batches,bank_question_assets,content_decisions,asset_revisions,material_assets,content_tags,topic_links,knowledge_topics;
DELETE FROM processing_jobs WHERE kind IN ('source_suggest','knowledge_compare','vision','paper_split');
ALTER TABLE processing_jobs DROP CONSTRAINT processing_jobs_kind_check;
ALTER TABLE processing_jobs ADD CONSTRAINT processing_jobs_kind_check CHECK(kind IN ('parse','index','extract','rubric','grade','question_generate','question_analyze','bank_rubric'));
