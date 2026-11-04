-- +goose Up
CREATE TABLE rubric_versions (
 id text PRIMARY KEY,
 question_id text NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
 version integer NOT NULL CHECK(version > 0),
 criteria jsonb NOT NULL CHECK(jsonb_typeof(criteria)='array'),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','confirmed')),
 created_by text NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 confirmed_at timestamptz,
 UNIQUE(question_id,version)
);
ALTER TABLE grading_revisions ADD COLUMN rubric_id text REFERENCES rubric_versions(id);
ALTER TABLE grading_revisions ADD COLUMN point_scores jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(point_scores)='array');

-- +goose Down
ALTER TABLE grading_revisions DROP COLUMN point_scores;
ALTER TABLE grading_revisions DROP COLUMN rubric_id;
DROP TABLE rubric_versions;
