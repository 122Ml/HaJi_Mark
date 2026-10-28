-- +goose Up
ALTER TABLE submissions ADD COLUMN assignment_version integer NOT NULL DEFAULT 1 CHECK (assignment_version>0);
ALTER TABLE questions ADD COLUMN knowledge_point_id text REFERENCES knowledge_points(id);
ALTER TABLE questions ADD COLUMN resource_id text REFERENCES resources(id);
CREATE TABLE learning_notes (
 actor_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 resource_id text NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
 note text NOT NULL DEFAULT '',
 favorite boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,resource_id)
);

-- +goose Down
DROP TABLE learning_notes;
ALTER TABLE submissions DROP COLUMN assignment_version;
ALTER TABLE questions DROP COLUMN resource_id;
ALTER TABLE questions DROP COLUMN knowledge_point_id;
