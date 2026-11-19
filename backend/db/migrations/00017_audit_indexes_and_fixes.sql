-- +goose Up
ALTER TABLE assist_turns
 ADD COLUMN IF NOT EXISTS resource_id text REFERENCES resources(id);

CREATE INDEX IF NOT EXISTS courses_teacher_idx ON courses(teacher_id);
CREATE INDEX IF NOT EXISTS enrollments_student_course_idx ON enrollments(student_id, course_id);

CREATE INDEX IF NOT EXISTS resources_source_idx ON resources(source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS resources_fragment_ids_gin_idx ON resources USING GIN(fragment_ids);

CREATE INDEX IF NOT EXISTS questions_bank_version_idx ON questions(bank_question_version_id) WHERE bank_question_version_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS questions_bound_rubric_idx ON questions(bound_rubric_id) WHERE bound_rubric_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS questions_point_idx ON questions(knowledge_point_id) WHERE knowledge_point_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS questions_resource_idx ON questions(resource_id) WHERE resource_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS submissions_course_student_question_idx ON submissions(course_id, student_id, question_id, attempt DESC);
CREATE INDEX IF NOT EXISTS submissions_assignment_student_time_idx ON submissions(assignment_id, student_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS submissions_question_student_attempt_idx ON submissions(question_id, student_id, attempt DESC, id);

CREATE INDEX IF NOT EXISTS grading_revisions_rubric_idx ON grading_revisions(rubric_id) WHERE rubric_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS learning_events_actor_resource_verb_idx ON learning_events(actor_id, resource_id, verb, occurred_at) WHERE resource_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS learning_events_submission_idx ON learning_events(submission_id) WHERE submission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS study_paths_course_student_idx ON study_paths(course_id, student_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS research_records_course_time_idx ON research_records(course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS industry_records_course_time_idx ON industry_records(course_id, created_at DESC);

CREATE INDEX IF NOT EXISTS material_sources_course_sha_idx ON material_sources(course_id, sha256);
CREATE INDEX IF NOT EXISTS material_assets_source_idx ON material_assets(source_id, created_at, id);
CREATE INDEX IF NOT EXISTS material_assets_fragment_idx ON material_assets(fragment_id);
CREATE INDEX IF NOT EXISTS bank_question_assets_asset_idx ON bank_question_assets(asset_id);

CREATE INDEX IF NOT EXISTS retrieval_chunks_course_active_idx ON retrieval_chunks(course_id, active);
CREATE INDEX IF NOT EXISTS retrieval_chunks_source_idx ON retrieval_chunks(source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS retrieval_chunks_knowledge_idx ON retrieval_chunks(knowledge_id) WHERE knowledge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS retrieval_chunks_resource_idx ON retrieval_chunks(resource_id) WHERE resource_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS retrieval_chunks_fragment_ids_gin_idx ON retrieval_chunks USING GIN(fragment_ids);
CREATE INDEX IF NOT EXISTS chunk_embeddings_space_chunk_idx ON chunk_embeddings(space_id, chunk_id);

CREATE INDEX IF NOT EXISTS processing_jobs_active_state_idx ON processing_jobs(state, created_at) WHERE state IN ('queued','running');
CREATE INDEX IF NOT EXISTS processing_jobs_course_kind_time_idx ON processing_jobs(course_id, kind, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS processing_jobs_source_expr_idx ON processing_jobs(course_id, (input->>'source_id')) WHERE input ? 'source_id';
CREATE INDEX IF NOT EXISTS processing_jobs_knowledge_expr_idx ON processing_jobs(course_id, (input->>'knowledge_id')) WHERE input ? 'knowledge_id';
CREATE INDEX IF NOT EXISTS processing_jobs_question_expr_idx ON processing_jobs(course_id, (input->>'question_id')) WHERE input ? 'question_id';
CREATE INDEX IF NOT EXISTS processing_jobs_submission_expr_idx ON processing_jobs(course_id, (input->>'submission_id')) WHERE input ? 'submission_id';
CREATE INDEX IF NOT EXISTS processing_jobs_asset_expr_idx ON processing_jobs(course_id, (input->>'asset_id')) WHERE input ? 'asset_id';

CREATE INDEX IF NOT EXISTS model_calls_course_time_idx ON model_calls(course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS model_calls_reserved_idx ON model_calls(created_at) WHERE state='reserved';

CREATE INDEX IF NOT EXISTS topic_links_source_idx ON topic_links(source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS topic_links_knowledge_idx ON topic_links(knowledge_id) WHERE knowledge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS topic_links_bank_version_idx ON topic_links(bank_version_id) WHERE bank_version_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_tags_course_idx ON content_tags(course_id, object_kind, object_id);
CREATE INDEX IF NOT EXISTS regrade_batches_course_time_idx ON regrade_batches(course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS regrade_batches_question_state_idx ON regrade_batches(question_id, state);
CREATE INDEX IF NOT EXISTS submission_imports_assignment_idx ON submission_imports(assignment_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS submission_import_items_batch_idx ON submission_import_items(batch_id, row_number);

CREATE INDEX IF NOT EXISTS agent_messages_conv_time_idx ON agent_messages(conversation_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS agent_runs_ready_idx ON agent_runs(updated_at, id) WHERE state IN ('queued','running','waiting_job','waiting_input','waiting_approval');
CREATE INDEX IF NOT EXISTS agent_runs_canceled_idx ON agent_runs(id) WHERE cancel_requested AND state IN ('queued','running','waiting_input','waiting_approval','waiting_job');
CREATE INDEX IF NOT EXISTS agent_runs_conv_time_idx ON agent_runs(conversation_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS agent_runs_conv_updated_idx ON agent_runs(conversation_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS agent_requests_run_idx ON agent_requests(run_id, created_at, id);
CREATE INDEX IF NOT EXISTS agent_requests_pending_expiry_idx ON agent_requests(run_id, expires_at) WHERE state='pending';
CREATE INDEX IF NOT EXISTS agent_attachments_conv_idx ON agent_attachments(conversation_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS agent_events_run_idx ON agent_events(run_id);

-- +goose Down
DROP INDEX IF EXISTS agent_events_run_idx;
DROP INDEX IF EXISTS agent_attachments_conv_idx;
DROP INDEX IF EXISTS agent_requests_pending_expiry_idx;
DROP INDEX IF EXISTS agent_requests_run_idx;
DROP INDEX IF EXISTS agent_runs_conv_updated_idx;
DROP INDEX IF EXISTS agent_runs_conv_time_idx;
DROP INDEX IF EXISTS agent_runs_canceled_idx;
DROP INDEX IF EXISTS agent_runs_ready_idx;
DROP INDEX IF EXISTS agent_messages_conv_time_idx;
DROP INDEX IF EXISTS submission_import_items_batch_idx;
DROP INDEX IF EXISTS submission_imports_assignment_idx;
DROP INDEX IF EXISTS regrade_batches_question_state_idx;
DROP INDEX IF EXISTS regrade_batches_course_time_idx;
DROP INDEX IF EXISTS content_tags_course_idx;
DROP INDEX IF EXISTS topic_links_bank_version_idx;
DROP INDEX IF EXISTS topic_links_knowledge_idx;
DROP INDEX IF EXISTS topic_links_source_idx;
DROP INDEX IF EXISTS model_calls_reserved_idx;
DROP INDEX IF EXISTS model_calls_course_time_idx;
DROP INDEX IF EXISTS processing_jobs_asset_expr_idx;
DROP INDEX IF EXISTS processing_jobs_submission_expr_idx;
DROP INDEX IF EXISTS processing_jobs_question_expr_idx;
DROP INDEX IF EXISTS processing_jobs_knowledge_expr_idx;
DROP INDEX IF EXISTS processing_jobs_source_expr_idx;
DROP INDEX IF EXISTS processing_jobs_course_kind_time_idx;
DROP INDEX IF EXISTS processing_jobs_active_state_idx;
DROP INDEX IF EXISTS chunk_embeddings_space_chunk_idx;
DROP INDEX IF EXISTS retrieval_chunks_fragment_ids_gin_idx;
DROP INDEX IF EXISTS retrieval_chunks_resource_idx;
DROP INDEX IF EXISTS retrieval_chunks_knowledge_idx;
DROP INDEX IF EXISTS retrieval_chunks_source_idx;
DROP INDEX IF EXISTS retrieval_chunks_course_active_idx;
DROP INDEX IF EXISTS bank_question_assets_asset_idx;
DROP INDEX IF EXISTS material_assets_fragment_idx;
DROP INDEX IF EXISTS material_assets_source_idx;
DROP INDEX IF EXISTS material_sources_course_sha_idx;
DROP INDEX IF EXISTS industry_records_course_time_idx;
DROP INDEX IF EXISTS research_records_course_time_idx;
DROP INDEX IF EXISTS study_paths_course_student_idx;
DROP INDEX IF EXISTS learning_events_submission_idx;
DROP INDEX IF EXISTS learning_events_actor_resource_verb_idx;
DROP INDEX IF EXISTS grading_revisions_rubric_idx;
DROP INDEX IF EXISTS submissions_question_student_attempt_idx;
DROP INDEX IF EXISTS submissions_assignment_student_time_idx;
DROP INDEX IF EXISTS submissions_course_student_question_idx;
DROP INDEX IF EXISTS questions_resource_idx;
DROP INDEX IF EXISTS questions_point_idx;
DROP INDEX IF EXISTS questions_bound_rubric_idx;
DROP INDEX IF EXISTS questions_bank_version_idx;
DROP INDEX IF EXISTS resources_fragment_ids_gin_idx;
DROP INDEX IF EXISTS resources_source_idx;
DROP INDEX IF EXISTS enrollments_student_course_idx;
DROP INDEX IF EXISTS courses_teacher_idx;
ALTER TABLE assist_turns DROP COLUMN IF EXISTS resource_id;
