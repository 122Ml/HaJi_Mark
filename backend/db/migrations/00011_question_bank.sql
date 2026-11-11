-- +goose Up
CREATE TABLE question_bank (
 id text PRIMARY KEY,
 course_id text NOT NULL REFERENCES courses(id),
 archived boolean NOT NULL DEFAULT false,
 created_by text NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bank_question_versions (
 id text PRIMARY KEY,
 bank_id text NOT NULL REFERENCES question_bank(id),
 version integer NOT NULL CHECK(version>0),
 title text NOT NULL,
 prompt text NOT NULL,
 type text NOT NULL DEFAULT 'subjective' CHECK(type IN ('subjective','code','quiz')),
 max_score integer NOT NULL CHECK(max_score BETWEEN 1 AND 10000),
 requirements text NOT NULL DEFAULT '',
 reference_answer text NOT NULL DEFAULT '',
 reference_state text NOT NULL DEFAULT 'draft' CHECK(reference_state IN ('draft','confirmed')),
 options text[] NOT NULL DEFAULT '{}',
 correct_answer text NOT NULL DEFAULT '',
 knowledge_point_id text REFERENCES knowledge_points(id),
 evidence_refs jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(evidence_refs)='array'),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','confirmed')),
 created_by text NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(bank_id,version)
);
CREATE INDEX question_bank_course_idx ON question_bank(course_id,created_at DESC);
ALTER TABLE rubric_versions ALTER COLUMN question_id DROP NOT NULL;
ALTER TABLE rubric_versions ADD COLUMN bank_question_version_id text REFERENCES bank_question_versions(id);
ALTER TABLE rubric_versions ADD CONSTRAINT rubric_owner CHECK ((question_id IS NOT NULL) <> (bank_question_version_id IS NOT NULL));
CREATE UNIQUE INDEX bank_rubric_version_idx ON rubric_versions(bank_question_version_id,version) WHERE bank_question_version_id IS NOT NULL;
ALTER TABLE questions ADD COLUMN bank_question_version_id text REFERENCES bank_question_versions(id);
ALTER TABLE questions ADD COLUMN bound_rubric_id text REFERENCES rubric_versions(id);
ALTER TABLE questions ADD CONSTRAINT question_bank_binding CHECK(bank_question_version_id IS NOT NULL OR bound_rubric_id IS NULL);
ALTER TABLE processing_jobs DROP CONSTRAINT processing_jobs_kind_check;
ALTER TABLE processing_jobs ADD CONSTRAINT processing_jobs_kind_check CHECK(kind IN ('parse','index','extract','rubric','grade','question_generate','question_analyze','bank_rubric'));

-- +goose Down
ALTER TABLE questions DROP CONSTRAINT question_bank_binding;
ALTER TABLE questions DROP COLUMN bound_rubric_id;
ALTER TABLE questions DROP COLUMN bank_question_version_id;
DROP INDEX bank_rubric_version_idx;
ALTER TABLE rubric_versions DROP CONSTRAINT rubric_owner;
DELETE FROM rubric_versions WHERE bank_question_version_id IS NOT NULL;
ALTER TABLE rubric_versions DROP COLUMN bank_question_version_id;
ALTER TABLE rubric_versions ALTER COLUMN question_id SET NOT NULL;
DROP TABLE bank_question_versions;
DROP TABLE question_bank;
DELETE FROM processing_jobs WHERE kind IN ('question_generate','question_analyze','bank_rubric');
ALTER TABLE processing_jobs DROP CONSTRAINT processing_jobs_kind_check;
ALTER TABLE processing_jobs ADD CONSTRAINT processing_jobs_kind_check CHECK(kind IN ('parse','index','extract','rubric','grade'));
