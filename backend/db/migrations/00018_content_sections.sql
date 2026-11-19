-- +goose Up
ALTER TABLE processing_jobs DROP CONSTRAINT processing_jobs_kind_check;
ALTER TABLE processing_jobs ADD CONSTRAINT processing_jobs_kind_check
  CHECK(kind IN (
    'parse','index','extract','rubric','grade',
    'question_generate','question_analyze','bank_rubric',
    'source_suggest','knowledge_compare','vision','paper_split',
    'diagnosis','recommendation','source_segment'
  ));

CREATE TABLE content_sections (
  id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  source_id text NOT NULL REFERENCES material_sources(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK(revision>=0),
  position integer NOT NULL CHECK(position>=0),
  title text NOT NULL,
  relation text NOT NULL DEFAULT 'sequence' CHECK(relation IN ('point','sequence')),
  fragment_ids text[] NOT NULL DEFAULT '{}',
  knowledge_point_id text REFERENCES knowledge_points(id),
  time_start_ms integer NOT NULL DEFAULT 0 CHECK(time_start_ms>=0),
  time_end_ms integer NOT NULL DEFAULT 0 CHECK(time_end_ms>=0),
  reason text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','accepted','rejected')),
  edit_version integer NOT NULL DEFAULT 1 CHECK(edit_version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(relation <> 'point' OR knowledge_point_id IS NOT NULL),
  CHECK(time_end_ms = 0 OR time_end_ms > time_start_ms)
);
CREATE UNIQUE INDEX content_sections_position_idx ON content_sections(source_id,revision,position);
CREATE INDEX content_sections_course_idx ON content_sections(course_id,source_id);

-- +goose Down
DROP TABLE content_sections;
ALTER TABLE processing_jobs DROP CONSTRAINT processing_jobs_kind_check;
ALTER TABLE processing_jobs ADD CONSTRAINT processing_jobs_kind_check
  CHECK(kind IN (
    'parse','index','extract','rubric','grade',
    'question_generate','question_analyze','bank_rubric',
    'source_suggest','knowledge_compare','vision','paper_split',
    'diagnosis','recommendation'
  ));
