-- +goose Up
ALTER TABLE agent_runs ADD COLUMN stream_text text NOT NULL DEFAULT '', ADD COLUMN stream_turn integer NOT NULL DEFAULT 0;
ALTER TABLE knowledge_entries ADD COLUMN origin text NOT NULL DEFAULT 'source' CHECK(origin IN ('source','teacher_example'));
ALTER TABLE knowledge_entries ADD CONSTRAINT teacher_example_purpose CHECK(origin!='teacher_example' OR (content_kind='example' AND NOT use_for_grading AND evidence='[]'::jsonb));
CREATE TABLE diagnosis_labels (
 id text PRIMARY KEY,
 course_id text NOT NULL REFERENCES courses(id),
 title text NOT NULL,
 active boolean NOT NULL DEFAULT true,
 edit_version integer NOT NULL DEFAULT 1,
 UNIQUE(course_id,title)
);
CREATE TABLE intelligence_reports (
 id text PRIMARY KEY,
 course_id text NOT NULL REFERENCES courses(id),
 owner_id text NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('diagnosis','recommendation')),
 question_id text REFERENCES questions(id),
 job_id text NOT NULL UNIQUE REFERENCES processing_jobs(id),
 request_id text NOT NULL,
 input_hash text NOT NULL,
 input jsonb NOT NULL,
 output jsonb NOT NULL DEFAULT '{}',
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','confirmed')),
 edit_version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(course_id,owner_id,request_id)
);
CREATE INDEX intelligence_report_owner ON intelligence_reports(course_id,owner_id,created_at DESC,id);
CREATE TABLE recommendation_choices (
 report_id text NOT NULL REFERENCES intelligence_reports(id),
 candidate_id text NOT NULL,
 choice text NOT NULL CHECK(choice IN ('saved','later','dismissed')),
 PRIMARY KEY(report_id,candidate_id)
);
ALTER TABLE processing_jobs DROP CONSTRAINT processing_jobs_kind_check;
ALTER TABLE processing_jobs ADD CONSTRAINT processing_jobs_kind_check CHECK(kind IN ('parse','index','extract','rubric','grade','question_generate','question_analyze','bank_rubric','source_suggest','knowledge_compare','vision','paper_split','diagnosis','recommendation'));

-- +goose Down
ALTER TABLE agent_runs DROP COLUMN stream_text, DROP COLUMN stream_turn;
ALTER TABLE processing_jobs DROP CONSTRAINT processing_jobs_kind_check;
ALTER TABLE processing_jobs ADD CONSTRAINT processing_jobs_kind_check CHECK(kind IN ('parse','index','extract','rubric','grade','question_generate','question_analyze','bank_rubric','source_suggest','knowledge_compare','vision','paper_split'));
DROP TABLE recommendation_choices,intelligence_reports,diagnosis_labels;
ALTER TABLE knowledge_entries DROP CONSTRAINT teacher_example_purpose;
ALTER TABLE knowledge_entries DROP COLUMN origin;
