-- +goose Up
CREATE TABLE assist_turns (
 id text PRIMARY KEY,
 course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id text NOT NULL,
 question text NOT NULL,
 profile_id text NOT NULL DEFAULT '',
 state text NOT NULL DEFAULT 'running' CHECK (state IN ('running','succeeded','failed')),
 response jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(course_id,owner_id,request_id)
);
CREATE INDEX assist_turns_owner_idx ON assist_turns(course_id,owner_id,created_at DESC,id DESC);

CREATE TABLE submission_imports (
 id text PRIMARY KEY,
 course_id text NOT NULL REFERENCES courses(id),
 assignment_id text NOT NULL REFERENCES assignments(id),
 question_id text NOT NULL REFERENCES questions(id),
 imported_by text NOT NULL REFERENCES users(id),
 request_id text NOT NULL,
 input_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(imported_by,request_id)
);
CREATE TABLE submission_import_items (
 batch_id text NOT NULL REFERENCES submission_imports(id),
 submission_id text PRIMARY KEY REFERENCES submissions(id),
 row_number integer NOT NULL CHECK (row_number>0)
);
ALTER TABLE learning_events DROP CONSTRAINT learning_events_verb_check;
ALTER TABLE learning_events ADD CONSTRAINT learning_events_verb_check CHECK (verb IN ('opened','completed','submission.submitted','submission.imported'));
ALTER TABLE learning_events DROP CONSTRAINT learning_events_target_check;
ALTER TABLE learning_events ADD CONSTRAINT learning_events_target_check CHECK (
 (verb IN ('opened','completed') AND resource_id IS NOT NULL AND submission_id IS NULL)
 OR (verb IN ('submission.submitted','submission.imported') AND submission_id IS NOT NULL AND resource_id IS NULL)
);

-- +goose Down
-- Imported-event history must be explicitly handled before a rollback.
ALTER TABLE learning_events DROP CONSTRAINT learning_events_verb_check;
ALTER TABLE learning_events ADD CONSTRAINT learning_events_verb_check CHECK (verb IN ('opened','completed','submission.submitted'));
ALTER TABLE learning_events DROP CONSTRAINT learning_events_target_check;
ALTER TABLE learning_events ADD CONSTRAINT learning_events_target_check CHECK (
 (verb IN ('opened','completed') AND resource_id IS NOT NULL AND submission_id IS NULL)
 OR (verb='submission.submitted' AND submission_id IS NOT NULL AND resource_id IS NULL)
);
DROP TABLE submission_import_items;
DROP TABLE submission_imports;
DROP TABLE assist_turns;
