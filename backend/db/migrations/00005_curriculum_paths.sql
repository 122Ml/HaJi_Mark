-- +goose Up
ALTER TABLE knowledge_points ADD COLUMN parent_id text REFERENCES knowledge_points(id);
ALTER TABLE knowledge_points ADD COLUMN kind text NOT NULL DEFAULT 'point' CHECK (kind IN ('chapter','section','point'));
ALTER TABLE knowledge_points ADD COLUMN description text NOT NULL DEFAULT '';
CREATE TABLE course_edges (
 course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 from_id text NOT NULL REFERENCES knowledge_points(id),
 to_id text NOT NULL REFERENCES knowledge_points(id),
 PRIMARY KEY(course_id,from_id,to_id),
 CHECK (from_id<>to_id)
);
CREATE TABLE study_paths (
 id text PRIMARY KEY,
 course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 student_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 rule_version text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE study_path_items (
 path_id text NOT NULL REFERENCES study_paths(id) ON DELETE CASCADE,
 knowledge_point_id text NOT NULL REFERENCES knowledge_points(id),
 position integer NOT NULL CHECK (position>=0),
 reason text NOT NULL,
 PRIMARY KEY(path_id,knowledge_point_id)
);

-- +goose Down
DROP TABLE study_path_items;
DROP TABLE study_paths;
DROP TABLE course_edges;
ALTER TABLE knowledge_points DROP COLUMN description;
ALTER TABLE knowledge_points DROP COLUMN kind;
ALTER TABLE knowledge_points DROP COLUMN parent_id;
