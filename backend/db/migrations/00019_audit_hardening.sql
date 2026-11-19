-- +goose Up
-- Audit hardening migration (00019): vector HNSW indexes, missing FK/partial indexes,
-- interaction evidence_refs, course archived status, safe JSONB/CHECK/FK cascades.

-- 1. pgvector expression HNSW indexes per supported embedding dimension.
CREATE INDEX IF NOT EXISTS chunk_embeddings_hnsw_1024_idx
  ON chunk_embeddings USING hnsw ((embedding::vector(1024)) vector_cosine_ops)
  WHERE dimensions = 1024;
CREATE INDEX IF NOT EXISTS chunk_embeddings_hnsw_1536_idx
  ON chunk_embeddings USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
  WHERE dimensions = 1536;

-- 2. Performance & missing foreign-key indexes.
CREATE INDEX IF NOT EXISTS assist_turns_running_idx
  ON assist_turns(created_at) WHERE state = 'running';
CREATE INDEX IF NOT EXISTS interventions_course_student_status_idx
  ON interventions(course_id, student_id, status);
CREATE INDEX IF NOT EXISTS processing_jobs_rubric_expr_idx
  ON processing_jobs(course_id, (input->>'rubric_id')) WHERE input ? 'rubric_id';
CREATE INDEX IF NOT EXISTS interactions_parent_idx
  ON interactions(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS learning_events_resource_idx
  ON learning_events(resource_id) WHERE resource_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS learning_events_course_actor_verb_idx
  ON learning_events(course_id, actor_id, verb);
CREATE INDEX IF NOT EXISTS regrade_items_submission_idx
  ON regrade_items(submission_id);
CREATE INDEX IF NOT EXISTS grading_revisions_regrade_batch_idx
  ON grading_revisions(regrade_batch_id) WHERE regrade_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS interventions_source_submission_idx
  ON interventions(source_submission_id) WHERE source_submission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS interventions_diagnosis_report_idx
  ON interventions(diagnosis_report_id) WHERE diagnosis_report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS assist_turns_resource_idx
  ON assist_turns(resource_id) WHERE resource_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bank_question_versions_point_idx
  ON bank_question_versions(knowledge_point_id) WHERE knowledge_point_id IS NOT NULL;

-- 3. Interactions evidence_refs persistence.
ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE interactions SET evidence_refs = '[]'::jsonb WHERE jsonb_typeof(evidence_refs) <> 'array';
ALTER TABLE interactions DROP CONSTRAINT IF EXISTS interactions_evidence_refs_check;
ALTER TABLE interactions ADD CONSTRAINT interactions_evidence_refs_check
  CHECK (jsonb_typeof(evidence_refs) = 'array');

-- 4. Support course archival state.
ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_status_check;
ALTER TABLE courses ADD CONSTRAINT courses_status_check
  CHECK (status IN ('draft', 'published', 'archived'));

-- 5. Sanitize any edge rows before tightening CHECK constraints.
UPDATE knowledge_entries SET evidence = '[]'::jsonb WHERE jsonb_typeof(evidence) <> 'array';
ALTER TABLE knowledge_entries DROP CONSTRAINT IF EXISTS knowledge_entries_evidence_array_check;
ALTER TABLE knowledge_entries ADD CONSTRAINT knowledge_entries_evidence_array_check
  CHECK (jsonb_typeof(evidence) = 'array');

UPDATE rubric_versions SET evidence_refs = '[]'::jsonb WHERE jsonb_typeof(evidence_refs) <> 'array';
ALTER TABLE rubric_versions DROP CONSTRAINT IF EXISTS rubric_versions_evidence_array_check;
ALTER TABLE rubric_versions ADD CONSTRAINT rubric_versions_evidence_array_check
  CHECK (jsonb_typeof(evidence_refs) = 'array');

UPDATE model_calls SET
  state = CASE WHEN state IN ('reserved','completed','succeeded','failed','unknown','canceled') THEN state ELSE 'unknown' END,
  reserved_micro_cny = GREATEST(0, reserved_micro_cny),
  charged_micro_cny = GREATEST(0, charged_micro_cny),
  input_tokens = GREATEST(0, input_tokens),
  output_tokens = GREATEST(0, output_tokens),
  duration_ms = GREATEST(0, duration_ms)
WHERE state NOT IN ('reserved','completed','succeeded','failed','unknown','canceled')
   OR reserved_micro_cny < 0 OR charged_micro_cny < 0
   OR input_tokens < 0 OR output_tokens < 0 OR duration_ms < 0;
ALTER TABLE model_calls DROP CONSTRAINT IF EXISTS model_calls_state_check;
ALTER TABLE model_calls ADD CONSTRAINT model_calls_state_check
  CHECK (state IN ('reserved','completed','succeeded','failed','unknown','canceled'));
ALTER TABLE model_calls DROP CONSTRAINT IF EXISTS model_calls_nonnegative_check;
ALTER TABLE model_calls ADD CONSTRAINT model_calls_nonnegative_check
  CHECK (reserved_micro_cny >= 0 AND charged_micro_cny >= 0 AND input_tokens >= 0 AND output_tokens >= 0 AND duration_ms >= 0);

UPDATE regrade_items SET score = 0 WHERE score IS NOT NULL AND score < 0;
ALTER TABLE regrade_items DROP CONSTRAINT IF EXISTS regrade_items_score_check;
ALTER TABLE regrade_items ADD CONSTRAINT regrade_items_score_check
  CHECK (score IS NULL OR score >= 0);
ALTER TABLE regrade_items DROP CONSTRAINT IF EXISTS regrade_items_edit_version_check;
ALTER TABLE regrade_items ADD CONSTRAINT regrade_items_edit_version_check
  CHECK (edit_version > 0);

ALTER TABLE material_sources DROP CONSTRAINT IF EXISTS material_sources_parse_revision_check;
ALTER TABLE material_sources ADD CONSTRAINT material_sources_parse_revision_check
  CHECK (parse_revision >= 0);
ALTER TABLE processing_jobs DROP CONSTRAINT IF EXISTS processing_jobs_attempt_check;
ALTER TABLE processing_jobs ADD CONSTRAINT processing_jobs_attempt_check
  CHECK (attempt >= 0);
ALTER TABLE knowledge_entries DROP CONSTRAINT IF EXISTS knowledge_entries_version_check;
ALTER TABLE knowledge_entries ADD CONSTRAINT knowledge_entries_version_check
  CHECK (version > 0 AND edit_version > 0);
ALTER TABLE knowledge_topics DROP CONSTRAINT IF EXISTS knowledge_topics_edit_version_check;
ALTER TABLE knowledge_topics ADD CONSTRAINT knowledge_topics_edit_version_check
  CHECK (edit_version > 0);
ALTER TABLE diagnosis_labels DROP CONSTRAINT IF EXISTS diagnosis_labels_edit_version_check;
ALTER TABLE diagnosis_labels ADD CONSTRAINT diagnosis_labels_edit_version_check
  CHECK (edit_version > 0);
ALTER TABLE intelligence_reports DROP CONSTRAINT IF EXISTS intelligence_reports_edit_version_check;
ALTER TABLE intelligence_reports ADD CONSTRAINT intelligence_reports_edit_version_check
  CHECK (edit_version > 0);
ALTER TABLE asset_revisions DROP CONSTRAINT IF EXISTS asset_revisions_revision_check;
ALTER TABLE asset_revisions ADD CONSTRAINT asset_revisions_revision_check
  CHECK (revision > 0);

-- 6. Tighten content_sections time span constraint safely without dropping content_sections_check (point invariant).
UPDATE content_sections SET time_start_ms = 0 WHERE time_end_ms = 0 AND time_start_ms > 0;
-- +goose StatementBegin
DO $$
DECLARE
  cname text;
BEGIN
  FOR cname IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'content_sections'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%time_end_ms%'
      AND pg_get_constraintdef(oid) LIKE '%time_start_ms%'
  LOOP
    EXECUTE format('ALTER TABLE content_sections DROP CONSTRAINT IF EXISTS %I', cname);
  END LOOP;
END $$;
-- +goose StatementEnd
ALTER TABLE content_sections ADD CONSTRAINT content_sections_time_span_check
  CHECK ((time_start_ms = 0 AND time_end_ms = 0) OR time_end_ms > time_start_ms);

-- 7. Safe ON DELETE rules for deletion/cleanup paths (built-in diagnosis labels live in memory, not diagnosis_labels).

ALTER TABLE assist_turns DROP CONSTRAINT IF EXISTS assist_turns_resource_id_fkey;
ALTER TABLE assist_turns ADD CONSTRAINT assist_turns_resource_id_fkey
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE SET NULL;

ALTER TABLE intelligence_reports DROP CONSTRAINT IF EXISTS intelligence_reports_question_id_fkey;
ALTER TABLE intelligence_reports ADD CONSTRAINT intelligence_reports_question_id_fkey
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE SET NULL;

ALTER TABLE enrollments DROP CONSTRAINT IF EXISTS enrollments_course_id_fkey;
ALTER TABLE enrollments ADD CONSTRAINT enrollments_course_id_fkey
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;

ALTER TABLE knowledge_points DROP CONSTRAINT IF EXISTS knowledge_points_course_id_fkey;
ALTER TABLE knowledge_points ADD CONSTRAINT knowledge_points_course_id_fkey
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;

ALTER TABLE agent_messages DROP CONSTRAINT IF EXISTS agent_messages_conversation_id_fkey;
ALTER TABLE agent_messages ADD CONSTRAINT agent_messages_conversation_id_fkey
  FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id) ON DELETE CASCADE;

ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_conversation_id_fkey;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_conversation_id_fkey
  FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id) ON DELETE CASCADE;

ALTER TABLE agent_steps DROP CONSTRAINT IF EXISTS agent_steps_run_id_fkey;
ALTER TABLE agent_steps ADD CONSTRAINT agent_steps_run_id_fkey
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE;

ALTER TABLE agent_requests DROP CONSTRAINT IF EXISTS agent_requests_run_id_fkey;
ALTER TABLE agent_requests ADD CONSTRAINT agent_requests_run_id_fkey
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE;

ALTER TABLE agent_requests DROP CONSTRAINT IF EXISTS agent_requests_step_id_fkey;
ALTER TABLE agent_requests ADD CONSTRAINT agent_requests_step_id_fkey
  FOREIGN KEY (step_id) REFERENCES agent_steps(id) ON DELETE CASCADE;

ALTER TABLE agent_attachments DROP CONSTRAINT IF EXISTS agent_attachments_conversation_id_fkey;
ALTER TABLE agent_attachments ADD CONSTRAINT agent_attachments_conversation_id_fkey
  FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id) ON DELETE CASCADE;

ALTER TABLE agent_events DROP CONSTRAINT IF EXISTS agent_events_conversation_id_fkey;
ALTER TABLE agent_events ADD CONSTRAINT agent_events_conversation_id_fkey
  FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id) ON DELETE CASCADE;

ALTER TABLE agent_events DROP CONSTRAINT IF EXISTS agent_events_run_id_fkey;
ALTER TABLE agent_events ADD CONSTRAINT agent_events_run_id_fkey
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE;

-- +goose Down
ALTER TABLE agent_events DROP CONSTRAINT IF EXISTS agent_events_run_id_fkey;
ALTER TABLE agent_events ADD CONSTRAINT agent_events_run_id_fkey FOREIGN KEY (run_id) REFERENCES agent_runs(id);
ALTER TABLE agent_events DROP CONSTRAINT IF EXISTS agent_events_conversation_id_fkey;
ALTER TABLE agent_events ADD CONSTRAINT agent_events_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id);
ALTER TABLE agent_attachments DROP CONSTRAINT IF EXISTS agent_attachments_conversation_id_fkey;
ALTER TABLE agent_attachments ADD CONSTRAINT agent_attachments_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id);
ALTER TABLE agent_requests DROP CONSTRAINT IF EXISTS agent_requests_step_id_fkey;
ALTER TABLE agent_requests ADD CONSTRAINT agent_requests_step_id_fkey FOREIGN KEY (step_id) REFERENCES agent_steps(id);
ALTER TABLE agent_requests DROP CONSTRAINT IF EXISTS agent_requests_run_id_fkey;
ALTER TABLE agent_requests ADD CONSTRAINT agent_requests_run_id_fkey FOREIGN KEY (run_id) REFERENCES agent_runs(id);
ALTER TABLE agent_steps DROP CONSTRAINT IF EXISTS agent_steps_run_id_fkey;
ALTER TABLE agent_steps ADD CONSTRAINT agent_steps_run_id_fkey FOREIGN KEY (run_id) REFERENCES agent_runs(id);
ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_conversation_id_fkey;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id);
ALTER TABLE agent_messages DROP CONSTRAINT IF EXISTS agent_messages_conversation_id_fkey;
ALTER TABLE agent_messages ADD CONSTRAINT agent_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id);
ALTER TABLE knowledge_points DROP CONSTRAINT IF EXISTS knowledge_points_course_id_fkey;
ALTER TABLE knowledge_points ADD CONSTRAINT knowledge_points_course_id_fkey FOREIGN KEY (course_id) REFERENCES courses(id);
ALTER TABLE enrollments DROP CONSTRAINT IF EXISTS enrollments_course_id_fkey;
ALTER TABLE enrollments ADD CONSTRAINT enrollments_course_id_fkey FOREIGN KEY (course_id) REFERENCES courses(id);
ALTER TABLE intelligence_reports DROP CONSTRAINT IF EXISTS intelligence_reports_question_id_fkey;
ALTER TABLE intelligence_reports ADD CONSTRAINT intelligence_reports_question_id_fkey FOREIGN KEY (question_id) REFERENCES questions(id);
ALTER TABLE assist_turns DROP CONSTRAINT IF EXISTS assist_turns_resource_id_fkey;
ALTER TABLE assist_turns ADD CONSTRAINT assist_turns_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES resources(id);

ALTER TABLE content_sections DROP CONSTRAINT IF EXISTS content_sections_time_span_check;
ALTER TABLE content_sections DROP CONSTRAINT IF EXISTS content_sections_check1;
ALTER TABLE content_sections ADD CONSTRAINT content_sections_check1 CHECK (time_end_ms = 0 OR time_end_ms > time_start_ms);

ALTER TABLE asset_revisions DROP CONSTRAINT IF EXISTS asset_revisions_revision_check;
ALTER TABLE intelligence_reports DROP CONSTRAINT IF EXISTS intelligence_reports_edit_version_check;
ALTER TABLE diagnosis_labels DROP CONSTRAINT IF EXISTS diagnosis_labels_edit_version_check;
ALTER TABLE knowledge_topics DROP CONSTRAINT IF EXISTS knowledge_topics_edit_version_check;
ALTER TABLE knowledge_entries DROP CONSTRAINT IF EXISTS knowledge_entries_version_check;
ALTER TABLE processing_jobs DROP CONSTRAINT IF EXISTS processing_jobs_attempt_check;
ALTER TABLE material_sources DROP CONSTRAINT IF EXISTS material_sources_parse_revision_check;
ALTER TABLE regrade_items DROP CONSTRAINT IF EXISTS regrade_items_edit_version_check;
ALTER TABLE regrade_items DROP CONSTRAINT IF EXISTS regrade_items_score_check;
ALTER TABLE model_calls DROP CONSTRAINT IF EXISTS model_calls_nonnegative_check;
ALTER TABLE model_calls DROP CONSTRAINT IF EXISTS model_calls_state_check;
ALTER TABLE rubric_versions DROP CONSTRAINT IF EXISTS rubric_versions_evidence_array_check;
ALTER TABLE knowledge_entries DROP CONSTRAINT IF EXISTS knowledge_entries_evidence_array_check;

ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_status_check;
ALTER TABLE courses ADD CONSTRAINT courses_status_check CHECK (status IN ('draft', 'published'));

ALTER TABLE interactions DROP CONSTRAINT IF EXISTS interactions_evidence_refs_check;
ALTER TABLE interactions DROP COLUMN IF EXISTS evidence_refs;

DROP INDEX IF EXISTS bank_question_versions_point_idx;
DROP INDEX IF EXISTS assist_turns_resource_idx;
DROP INDEX IF EXISTS interventions_diagnosis_report_idx;
DROP INDEX IF EXISTS interventions_source_submission_idx;
DROP INDEX IF EXISTS grading_revisions_regrade_batch_idx;
DROP INDEX IF EXISTS regrade_items_submission_idx;
DROP INDEX IF EXISTS learning_events_course_actor_verb_idx;
DROP INDEX IF EXISTS learning_events_resource_idx;
DROP INDEX IF EXISTS interactions_parent_idx;
DROP INDEX IF EXISTS processing_jobs_rubric_expr_idx;
DROP INDEX IF EXISTS interventions_course_student_status_idx;
DROP INDEX IF EXISTS assist_turns_running_idx;
DROP INDEX IF EXISTS chunk_embeddings_hnsw_1536_idx;
DROP INDEX IF EXISTS chunk_embeddings_hnsw_1024_idx;
