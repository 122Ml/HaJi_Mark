-- +goose Up
ALTER TABLE resources ADD COLUMN source_note text NOT NULL DEFAULT '';
ALTER TABLE learning_events ADD COLUMN submission_id text REFERENCES submissions(id) ON DELETE CASCADE;
ALTER TABLE learning_events ADD COLUMN object_version integer NOT NULL DEFAULT 1 CHECK (object_version > 0);
ALTER TABLE learning_events DROP CONSTRAINT learning_events_verb_check;
ALTER TABLE learning_events ADD CONSTRAINT learning_events_verb_check CHECK (verb IN ('opened','completed','submission.submitted'));
ALTER TABLE learning_events ADD CONSTRAINT learning_events_target_check CHECK (
 (verb IN ('opened','completed') AND resource_id IS NOT NULL AND submission_id IS NULL)
 OR (verb='submission.submitted' AND submission_id IS NOT NULL AND resource_id IS NULL)
);
UPDATE learning_events e SET object_version=r.version FROM resources r WHERE r.id=e.resource_id;
INSERT INTO learning_events(id,course_id,actor_id,submission_id,verb,request_id,object_version,occurred_at)
SELECT 'submission-event-'||s.id,s.course_id,s.student_id,s.id,'submission.submitted','submission:'||s.id,s.assignment_version,s.submitted_at
FROM submissions s ON CONFLICT(actor_id,request_id) DO NOTHING;
CREATE INDEX learning_events_course_actor_time_idx ON learning_events(course_id,actor_id,occurred_at DESC);

-- +goose Down
DROP INDEX learning_events_course_actor_time_idx;
ALTER TABLE learning_events DROP CONSTRAINT learning_events_target_check;
DELETE FROM learning_events WHERE verb='submission.submitted';
ALTER TABLE learning_events DROP CONSTRAINT learning_events_verb_check;
ALTER TABLE learning_events ADD CONSTRAINT learning_events_verb_check CHECK (verb IN ('opened','completed'));
ALTER TABLE learning_events DROP COLUMN object_version;
ALTER TABLE learning_events DROP COLUMN submission_id;
ALTER TABLE resources DROP COLUMN source_note;
