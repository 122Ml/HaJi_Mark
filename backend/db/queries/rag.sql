-- name: CreateMaterialSource :one
INSERT INTO material_sources(id,course_id,created_by,title,filename,media_type,storage_path,source_note,source_url,sha256,allow_derived,version,supersedes_id)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *;

-- name: ListMaterialSources :many
SELECT s.*, (SELECT count(*) FROM material_fragments f WHERE f.source_id=s.id AND f.revision=s.parse_revision) AS fragment_count,
 (SELECT count(*) FROM material_fragments f WHERE f.source_id=s.id AND f.revision=s.parse_revision AND f.quality='needs_review') AS review_count
FROM material_sources s WHERE s.course_id=$1 ORDER BY s.created_at DESC;

-- name: GetMaterialSource :one
SELECT * FROM material_sources WHERE id=$1 AND course_id=$2;

-- name: UpdateSourceParse :one
UPDATE material_sources SET parse_state=$3,parse_error=$4,parse_revision=$5 WHERE id=$1 AND course_id=$2 RETURNING *;

-- name: RestoreSourceParse :exec
UPDATE material_sources SET parse_state=$3,parse_error=$4
WHERE id=$1 AND course_id=$2 AND parse_revision=$5 AND parse_state='running';

-- name: ArchiveMaterialSource :exec
UPDATE material_sources SET state='archived' WHERE id=$1 AND course_id=$2;

-- name: InsertMaterialFragment :one
INSERT INTO material_fragments(id,source_id,revision,position,heading,body,locator,quality) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *;

-- name: ListMaterialFragments :many
SELECT * FROM material_fragments WHERE source_id=$1 AND revision=$2 ORDER BY position;

-- name: GetMaterialFragment :one
SELECT f.* FROM material_fragments f JOIN material_sources s ON s.id=f.source_id WHERE f.id=$1 AND s.course_id=$2;

-- name: BindResourceFragments :exec
UPDATE resources SET source_id=$2,fragment_ids=$3,full_source=$4 WHERE id=$1;

-- name: ResourceContainsFragment :one
SELECT EXISTS(SELECT 1 FROM resources r WHERE r.course_id=$1 AND r.status='published' AND sqlc.arg(fragment_id)::text=ANY(r.fragment_ids));

-- name: StudentCanDownloadSource :one
SELECT EXISTS(SELECT 1 FROM resources r JOIN material_sources s ON s.id=r.source_id WHERE s.id=$1 AND s.course_id=$2 AND s.state='active' AND r.status='published' AND r.full_source=true);

-- name: CreateKnowledgeEntry :one
INSERT INTO knowledge_entries(id,course_id,created_by,title,body,category,content_kind,conditions,knowledge_point_ids,evidence,related_ids,student_visible,use_for_learning,use_for_grading,version,supersedes_id,origin)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,COALESCE(NULLIF(sqlc.arg(origin)::text,''),'source')) RETURNING *;

-- name: ListKnowledgeEntries :many
SELECT k.* FROM knowledge_entries k WHERE k.course_id=$1 AND (sqlc.arg(teacher)::boolean OR (k.state='confirmed' AND k.student_visible AND k.use_for_learning
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(k.evidence) ev WHERE NOT EXISTS(SELECT 1 FROM resources pr JOIN material_sources ms ON ms.id=pr.source_id WHERE pr.status='published' AND ms.state='active' AND ms.allow_derived AND ev->>'fragment_id'=ANY(pr.fragment_ids))))) ORDER BY created_at DESC;

-- name: GetKnowledgeEntry :one
SELECT * FROM knowledge_entries WHERE id=$1 AND course_id=$2;

-- name: EditKnowledgeEntry :one
UPDATE knowledge_entries SET title=$3,body=$4,category=$5,content_kind=$6,conditions=$7,knowledge_point_ids=$8,evidence=$9,related_ids=$10,student_visible=$11,use_for_learning=$12,use_for_grading=$13,edit_version=edit_version+1
WHERE id=$1 AND course_id=$2 AND state='draft' AND edit_version=$14 RETURNING *;

-- name: TransitionKnowledgeEntry :one
UPDATE knowledge_entries SET state=$3,confirmed_at=CASE WHEN $3='confirmed' THEN now() ELSE confirmed_at END
WHERE id=$1 AND course_id=$2 AND state=$4 AND edit_version=$5 RETURNING *;

-- name: PutRetrievalChunk :exec
INSERT INTO retrieval_chunks(id,course_id,source_id,knowledge_id,resource_id,fragment_ids,title,heading,body,locator,input_hash,search_tokens)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(id) DO UPDATE SET active=true;

-- name: GetEmbeddingSpace :one
SELECT * FROM embedding_spaces WHERE id=$1;

-- name: PutEmbeddingSpace :one
INSERT INTO embedding_spaces(id,profile_id,fingerprint,model,dimensions,chunker_version) VALUES($1,$2,$3,$4,$5,$6)
ON CONFLICT(fingerprint) DO UPDATE SET fingerprint=excluded.fingerprint RETURNING *;

-- name: ActivateEmbeddingSpace :exec
UPDATE courses SET embedding_space_id=$2 WHERE id=$1;

-- name: MissingChunkEmbeddings :many
SELECT c.id,c.title,c.heading,c.body FROM retrieval_chunks c WHERE c.course_id=$1 AND c.active AND NOT EXISTS(SELECT 1 FROM chunk_embeddings e WHERE e.chunk_id=c.id AND e.space_id=$2) ORDER BY c.id;

-- name: PutChunkEmbedding :exec
INSERT INTO chunk_embeddings(chunk_id,space_id,dimensions,embedding) VALUES($1,$2,$3,sqlc.arg(vector_text)::text::vector) ON CONFLICT DO NOTHING;

-- name: VectorSearch :many
SELECT c.id,c.source_id,c.knowledge_id,c.resource_id,c.fragment_ids,c.title,c.heading,c.body,c.locator,
 (e.embedding <=> sqlc.arg(vector_text)::text::vector)::float8 AS distance
FROM retrieval_chunks c JOIN chunk_embeddings e ON e.chunk_id=c.id
LEFT JOIN material_sources s ON s.id=c.source_id
LEFT JOIN knowledge_entries k ON k.id=c.knowledge_id
LEFT JOIN resources r ON r.id=c.resource_id
WHERE c.course_id=sqlc.arg(course_id) AND e.space_id=sqlc.arg(space_id) AND c.active
AND (sqlc.arg(purpose)::text<>'comparison' OR k.id IS NOT NULL)
AND ((s.state='active' AND (sqlc.arg(teacher)::boolean OR EXISTS(SELECT 1 FROM resources pr WHERE pr.status='published' AND pr.course_id=c.course_id AND c.fragment_ids <@ pr.fragment_ids)))
 OR (k.state='confirmed' AND CASE WHEN sqlc.arg(purpose)::text='grading' THEN k.use_for_grading WHEN sqlc.arg(purpose)::text='comparison' THEN k.use_for_grading OR k.use_for_learning ELSE k.use_for_learning END AND (sqlc.arg(teacher)::boolean OR k.student_visible)
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(k.evidence) ev LEFT JOIN material_sources ms ON ms.id=ev->>'source_id' WHERE ms.id IS NULL OR ms.state<>'active' OR NOT ms.allow_derived OR (NOT sqlc.arg(teacher)::boolean AND NOT EXISTS(SELECT 1 FROM resources pr WHERE pr.status='published' AND ev->>'fragment_id'=ANY(pr.fragment_ids)))))
 OR (r.status='published' AND r.source_id IS NULL))
ORDER BY distance,c.id LIMIT 20;

-- name: KeywordSearch :many
SELECT c.id,c.source_id,c.knowledge_id,c.resource_id,c.fragment_ids,c.title,c.heading,c.body,c.locator,
 ts_rank_cd(c.search_document,to_tsquery('simple',sqlc.arg(query_tokens)::text))::float8 AS rank
FROM retrieval_chunks c
LEFT JOIN material_sources s ON s.id=c.source_id
LEFT JOIN knowledge_entries k ON k.id=c.knowledge_id
LEFT JOIN resources r ON r.id=c.resource_id
WHERE c.course_id=sqlc.arg(course_id) AND c.active AND c.search_document @@ to_tsquery('simple',sqlc.arg(query_tokens)::text)
AND (sqlc.arg(purpose)::text<>'comparison' OR k.id IS NOT NULL)
AND ((s.state='active' AND (sqlc.arg(teacher)::boolean OR EXISTS(SELECT 1 FROM resources pr WHERE pr.status='published' AND pr.course_id=c.course_id AND c.fragment_ids <@ pr.fragment_ids)))
 OR (k.state='confirmed' AND CASE WHEN sqlc.arg(purpose)::text='grading' THEN k.use_for_grading WHEN sqlc.arg(purpose)::text='comparison' THEN k.use_for_grading OR k.use_for_learning ELSE k.use_for_learning END AND (sqlc.arg(teacher)::boolean OR k.student_visible)
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(k.evidence) ev LEFT JOIN material_sources ms ON ms.id=ev->>'source_id' WHERE ms.id IS NULL OR ms.state<>'active' OR NOT ms.allow_derived OR (NOT sqlc.arg(teacher)::boolean AND NOT EXISTS(SELECT 1 FROM resources pr WHERE pr.status='published' AND ev->>'fragment_id'=ANY(pr.fragment_ids)))))
 OR (r.status='published' AND r.source_id IS NULL))
ORDER BY rank DESC,c.id LIMIT 20;

-- name: ListLegacyIndexResources :many
SELECT * FROM resources WHERE course_id=$1 AND source_id IS NULL AND status='published';

-- name: ListIndexKnowledge :many
SELECT * FROM knowledge_entries WHERE course_id=$1 AND state='confirmed';

-- name: CreateProcessingJob :one
INSERT INTO processing_jobs(id,course_id,created_by,kind,input) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING *;

-- name: PendingCourseIndex :one
SELECT * FROM processing_jobs WHERE course_id=$1 AND kind='index' AND state='queued' LIMIT 1;

-- name: RetireObsoleteSourceChunks :exec
UPDATE retrieval_chunks c SET active=false FROM material_sources s WHERE c.source_id=s.id AND s.course_id=$1
AND NOT EXISTS(SELECT 1 FROM material_fragments f WHERE f.id=ANY(c.fragment_ids) AND f.revision=s.parse_revision)
AND NOT EXISTS(SELECT 1 FROM resources r WHERE r.status='published' AND c.fragment_ids <@ r.fragment_ids);

-- name: GetProcessingJob :one
SELECT * FROM processing_jobs WHERE id=$1 AND course_id=$2;

-- name: ListProcessingJobs :many
SELECT * FROM processing_jobs WHERE course_id=$1
AND (sqlc.arg(kind)::text='' OR kind=sqlc.arg(kind))
AND (sqlc.arg(question_id)::text='' OR input->>'question_id'=sqlc.arg(question_id))
AND (sqlc.arg(submission_id)::text='' OR input->>'submission_id'=sqlc.arg(submission_id))
AND (sqlc.arg(rubric_id)::text='' OR input->>'rubric_id'=sqlc.arg(rubric_id))
AND (sqlc.arg(source_id)::text='' OR input->>'source_id'=sqlc.arg(source_id))
AND (sqlc.arg(knowledge_id)::text='' OR input->>'knowledge_id'=sqlc.arg(knowledge_id))
AND (sqlc.arg(asset_id)::text='' OR input->>'asset_id'=sqlc.arg(asset_id))
ORDER BY created_at DESC,id LIMIT 60;

-- name: ListProcessingJobPage :many
SELECT * FROM processing_jobs WHERE course_id=$1
AND (sqlc.arg(kind)::text='' OR kind=ANY(string_to_array(sqlc.arg(kind),',')))
AND (sqlc.arg(source_id)::text='' OR input->>'source_id'=sqlc.arg(source_id))
AND (sqlc.arg(knowledge_id)::text='' OR input->>'knowledge_id'=sqlc.arg(knowledge_id))
AND (sqlc.arg(question_id)::text='' OR input->>'question_id'=sqlc.arg(question_id))
AND (sqlc.arg(submission_id)::text='' OR input->>'submission_id'=sqlc.arg(submission_id))
AND (sqlc.arg(rubric_id)::text='' OR input->>'rubric_id'=sqlc.arg(rubric_id))
AND (sqlc.arg(asset_id)::text='' OR input->>'asset_id'=sqlc.arg(asset_id))
ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: PendingProcessingJobs :many
SELECT * FROM processing_jobs WHERE state='queued' OR (state='running' AND kind IN ('parse','index') AND started_at<now()-interval '15 minutes') ORDER BY created_at LIMIT 20;

-- name: ClaimProcessingJob :one
UPDATE processing_jobs SET state='running',started_at=now(),attempt=attempt+1,error='' WHERE id=$1 AND (state='queued' OR (state='running' AND kind IN ('parse','index') AND started_at<now()-interval '15 minutes')) RETURNING *;

-- name: ExpireInterruptedGenerationJobs :exec
UPDATE processing_jobs SET state='failed',finished_at=now(),error='任务执行中断，模型结果未知；请核对调用记录后显式重试'
WHERE state='running' AND kind NOT IN ('parse','index') AND started_at<now()-interval '15 minutes';

-- name: SettleInterruptedModelCalls :exec
WITH expired AS (
 UPDATE model_calls SET state='unknown',charged_micro_cny=reserved_micro_cny,error_code='worker_interrupted'
 WHERE state='reserved' AND created_at<now()-interval '15 minutes'
 RETURNING reserved_micro_cny
)
UPDATE model_budget SET reserved_micro_cny=reserved_micro_cny-amount.total,spent_micro_cny=spent_micro_cny+amount.total
FROM (SELECT coalesce(sum(reserved_micro_cny),0)::bigint AS total FROM expired) amount WHERE id=1;

-- name: FinishProcessingJob :exec
UPDATE processing_jobs SET state=$2,output=$3,error=$4,progress=CASE WHEN $2='succeeded' THEN 100 ELSE progress END,finished_at=now() WHERE id=$1 AND state='running';

-- name: LockProcessingJob :one
SELECT * FROM processing_jobs WHERE id=$1 FOR UPDATE;

-- name: ProgressProcessingJob :exec
UPDATE processing_jobs SET progress=$2 WHERE id=$1 AND state='running';

-- name: CancelProcessingJob :one
UPDATE processing_jobs SET state='canceled',finished_at=now() WHERE id=$1 AND course_id=$2 AND state IN ('queued','running') RETURNING *;

-- name: ReserveModelBudget :one
UPDATE model_budget SET reserved_micro_cny=reserved_micro_cny+sqlc.arg(amount)::bigint WHERE id=1 AND spent_micro_cny+reserved_micro_cny+sqlc.arg(amount)::bigint<=limit_micro_cny RETURNING *;

-- name: CreateModelCall :exec
INSERT INTO model_calls(id,course_id,actor_id,profile_id,purpose,reserved_micro_cny) VALUES($1,$2,$3,$4,$5,$6);

-- name: SettleModelBudget :exec
UPDATE model_budget SET reserved_micro_cny=reserved_micro_cny-$1,spent_micro_cny=spent_micro_cny+$2 WHERE id=1;

-- name: FinishModelCall :one
UPDATE model_calls SET state=$2,charged_micro_cny=$3,input_tokens=$4,output_tokens=$5,duration_ms=$6,error_code=$7 WHERE id=$1 AND state='reserved' RETURNING id;

-- name: GetModelBudget :one
SELECT * FROM model_budget WHERE id=1;

-- name: AttachRubricEvidence :exec
UPDATE rubric_versions SET evidence_refs=$2 WHERE id=$1 AND state='draft';

-- name: AttachGradingJob :exec
UPDATE grading_revisions SET ai_job_id=$2 WHERE id=$1 AND state='draft';

-- name: LockMaterialSource :one
SELECT * FROM material_sources WHERE id=$1 AND course_id=$2 FOR UPDATE;

-- name: SetSourceDerivation :one
UPDATE material_sources SET allow_derived=$3 WHERE id=$1 AND course_id=$2 RETURNING *;

-- name: ListCourseModelCalls :many
SELECT id,profile_id,purpose,state,input_tokens,output_tokens,charged_micro_cny,duration_ms,error_code,created_at FROM model_calls WHERE course_id=$1 ORDER BY created_at DESC LIMIT 50;

-- name: ObjectRetrievalStatus :one
SELECT count(c.id)::int AS keyword_chunks, count(e.chunk_id)::int AS vector_chunks
FROM retrieval_chunks c JOIN courses course ON course.id=c.course_id
LEFT JOIN chunk_embeddings e ON e.chunk_id=c.id AND e.space_id=course.embedding_space_id
WHERE c.course_id=sqlc.arg(course_id) AND c.active AND (
 (sqlc.arg(resource_id)::text<>'' AND EXISTS(SELECT 1 FROM resources r WHERE r.id=sqlc.arg(resource_id) AND r.course_id=c.course_id AND r.status='published' AND
  (c.resource_id=r.id OR (c.source_id=r.source_id AND cardinality(c.fragment_ids)>0 AND c.fragment_ids <@ r.fragment_ids))))
 OR (sqlc.arg(source_id)::text<>'' AND c.source_id=sqlc.arg(source_id) AND EXISTS(SELECT 1 FROM material_sources s JOIN material_fragments f ON f.source_id=s.id AND f.revision=s.parse_revision WHERE s.id=c.source_id AND f.id=ANY(c.fragment_ids)))
);
