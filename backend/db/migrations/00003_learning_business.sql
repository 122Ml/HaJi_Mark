-- +goose Up
CREATE TABLE resources (
 id text PRIMARY KEY,
 course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 knowledge_point_id text REFERENCES knowledge_points(id),
 title text NOT NULL,
 content text NOT NULL,
 source_url text NOT NULL DEFAULT '',
 locator text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
 created_by text NOT NULL REFERENCES users(id),
 reviewed_by text REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 published_at timestamptz
);
CREATE INDEX resources_course_status_idx ON resources(course_id,status);

CREATE TABLE assignments (
 id text PRIMARY KEY,
 course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 title text NOT NULL,
 description text NOT NULL DEFAULT '',
 type text NOT NULL DEFAULT 'subjective',
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed')),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 max_score integer NOT NULL CHECK (max_score > 0),
 due_at timestamptz,
 created_by text NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 published_at timestamptz
);
CREATE INDEX assignments_course_status_idx ON assignments(course_id,status);

CREATE TABLE questions (
 id text PRIMARY KEY,
 assignment_id text NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
 prompt text NOT NULL,
 type text NOT NULL DEFAULT 'subjective',
 max_score integer NOT NULL CHECK (max_score > 0),
 rubric text NOT NULL DEFAULT '',
 options text[] NOT NULL DEFAULT '{}',
 correct_answer text NOT NULL DEFAULT '',
 position integer NOT NULL DEFAULT 0 CHECK (position >= 0)
);
CREATE INDEX questions_assignment_idx ON questions(assignment_id,position);

CREATE TABLE answer_drafts (
 student_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 question_id text NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
 answer_text text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(student_id,question_id)
);

CREATE TABLE submissions (
 id text PRIMARY KEY,
 assignment_id text NOT NULL REFERENCES assignments(id) ON DELETE RESTRICT,
 question_id text NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
 course_id text NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
 student_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 attempt integer NOT NULL CHECK (attempt > 0),
 answer_text text NOT NULL,
 answer_sha256 text NOT NULL CHECK (length(answer_sha256)=64),
 status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','graded','returned')),
 request_id text NOT NULL,
 submitted_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(student_id,question_id,attempt),
 UNIQUE(student_id,request_id)
);
CREATE INDEX submissions_assignment_idx ON submissions(assignment_id,submitted_at);
CREATE INDEX submissions_student_idx ON submissions(student_id,submitted_at);

CREATE TABLE grading_revisions (
 id text PRIMARY KEY,
 submission_id text NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
 revision integer NOT NULL CHECK (revision > 0),
 score integer NOT NULL CHECK (score >= 0),
 feedback text NOT NULL DEFAULT '',
 method text NOT NULL DEFAULT 'manual' CHECK (method IN ('manual','rule')),
 state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','confirmed','released')),
 reviewer_id text NOT NULL REFERENCES users(id),
 request_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 released_at timestamptz,
 UNIQUE(submission_id,revision),
 UNIQUE(reviewer_id,request_id)
);
CREATE INDEX grading_revisions_current_idx ON grading_revisions(submission_id,state,revision DESC);

CREATE TABLE learning_events (
 id text PRIMARY KEY,
 course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 actor_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 resource_id text REFERENCES resources(id) ON DELETE CASCADE,
 verb text NOT NULL CHECK (verb IN ('opened','completed')),
 request_id text NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_id,request_id)
);

CREATE TABLE interventions (
 id text PRIMARY KEY,
 course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 student_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title text NOT NULL,
 description text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','assigned','submitted','reviewed')),
 teacher_id text NOT NULL REFERENCES users(id),
 answer_text text NOT NULL DEFAULT '',
 review_note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 assigned_at timestamptz,
 submitted_at timestamptz,
 reviewed_at timestamptz
);
CREATE INDEX interventions_student_idx ON interventions(student_id,status);
CREATE INDEX interventions_course_idx ON interventions(course_id,status);

CREATE TABLE interactions (
 id text PRIMARY KEY,
 course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 actor_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('announcement','question','reply','discussion')),
 title text NOT NULL DEFAULT '',
 content text NOT NULL,
 parent_id text REFERENCES interactions(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX interactions_course_idx ON interactions(course_id,created_at);

CREATE TABLE research_records (
 id text PRIMARY KEY,
 course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 teacher_id text NOT NULL REFERENCES users(id),
 title text NOT NULL,
 content text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE industry_records (
 id text PRIMARY KEY,
 course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 title text NOT NULL,
 source_url text NOT NULL,
 skills text NOT NULL,
 teacher_id text NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE industry_records;
DROP TABLE research_records;
DROP TABLE interactions;
DROP TABLE interventions;
DROP TABLE learning_events;
DROP TABLE grading_revisions;
DROP TABLE submissions;
DROP TABLE answer_drafts;
DROP TABLE questions;
DROP TABLE assignments;
DROP TABLE resources;
