-- +goose Up
CREATE TABLE users (
 id text PRIMARY KEY,
 display_name text NOT NULL,
 role text NOT NULL CHECK (role IN ('student', 'teacher'))
);

CREATE TABLE courses (
 id text PRIMARY KEY,
 title text NOT NULL,
 teacher_id text NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE enrollments (
 course_id text NOT NULL REFERENCES courses(id),
 student_id text NOT NULL REFERENCES users(id),
 PRIMARY KEY (course_id, student_id)
);

CREATE TABLE knowledge_points (
 id text PRIMARY KEY,
 course_id text NOT NULL REFERENCES courses(id),
 title text NOT NULL,
 position integer NOT NULL CHECK (position >= 0)
);
CREATE INDEX knowledge_points_course_idx ON knowledge_points(course_id);

-- +goose Down
DROP TABLE knowledge_points;
DROP TABLE enrollments;
DROP TABLE courses;
DROP TABLE users;
