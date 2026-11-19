-- name: ListTopics :many
SELECT * FROM knowledge_topics WHERE course_id=$1 ORDER BY title,id;

-- name: CreateTopic :one
INSERT INTO knowledge_topics(id,course_id,title,description) VALUES($1,$2,$3,$4) RETURNING *;

-- name: GetTopicByID :one
SELECT * FROM knowledge_topics WHERE id=$1 AND course_id=$2;

-- name: UpdateTopic :one
UPDATE knowledge_topics SET title=$3,description=$4,active=$5,edit_version=edit_version+1 WHERE id=$1 AND course_id=$2 AND edit_version=$6 RETURNING *;

-- name: TopicLinks :many
SELECT l.* FROM topic_links l JOIN knowledge_topics t ON t.id=l.topic_id WHERE t.course_id=$1;

-- name: ClearTopicLinks :exec
DELETE FROM topic_links WHERE source_id=sqlc.narg(source_id) OR knowledge_id=sqlc.narg(knowledge_id) OR bank_version_id=sqlc.narg(bank_version_id);

-- name: LinkTopic :execrows
INSERT INTO topic_links(topic_id,source_id,knowledge_id,bank_version_id)
SELECT id,$3,$4,$5 FROM knowledge_topics WHERE id=$1 AND course_id=$2 AND active ON CONFLICT DO NOTHING;

-- name: PutContentTags :exec
INSERT INTO content_tags(course_id,object_kind,object_id,tags,knowledge_point_ids) VALUES($1,$2,$3,$4,$5) ON CONFLICT(object_kind,object_id) DO UPDATE SET tags=excluded.tags,knowledge_point_ids=excluded.knowledge_point_ids;

-- name: ListContentTags :many
SELECT * FROM content_tags WHERE course_id=$1 ORDER BY object_kind,object_id;

-- name: SourceDuplicate :one
SELECT * FROM material_sources WHERE course_id=$1 AND sha256=$2 ORDER BY created_at DESC LIMIT 1;

-- name: InsertMaterialAsset :one
INSERT INTO material_assets(id,source_id,fragment_id,storage_path,media_type,kind,locator,native_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *;

-- name: GetMaterialAsset :one
SELECT a.* FROM material_assets a JOIN material_sources s ON s.id=a.source_id WHERE a.id=$1 AND s.course_id=$2;

-- name: ListMaterialAssets :many
SELECT a.* FROM material_assets a WHERE a.source_id=$1 ORDER BY created_at,id;

-- name: AssetRevisions :many
SELECT r.* FROM asset_revisions r JOIN material_assets a ON a.id=r.asset_id WHERE a.source_id=$1 ORDER BY r.revision DESC;

-- name: CreateAssetRevision :one
INSERT INTO asset_revisions(id,asset_id,revision,body,structured,state,model_job_id,created_by)
SELECT $1,$2,(COALESCE(MAX(revision),0)+1)::integer,$3,$4,$5,$6,$7 FROM asset_revisions WHERE asset_id=$2 RETURNING *;

-- name: LockMaterialAsset :one
SELECT a.* FROM material_assets a JOIN material_sources s ON s.id=a.source_id WHERE a.id=$1 AND s.course_id=$2 FOR UPDATE OF a;

-- name: GetAssetRevision :one
SELECT * FROM asset_revisions WHERE id=$1;

-- name: CreateContentDecision :one
INSERT INTO content_decisions(id,course_id,actor_id,kind,object_id,inputs,output,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *;

-- name: ContentDecisions :many
SELECT * FROM content_decisions WHERE course_id=$1 AND (sqlc.arg(object_id)::text='' OR object_id=sqlc.arg(object_id)) ORDER BY created_at DESC,id LIMIT 100;

-- name: LockKnowledgeEntry :one
SELECT * FROM knowledge_entries WHERE id=$1 AND course_id=$2 FOR UPDATE;

-- name: RejectKnowledgeDraft :execrows
UPDATE knowledge_entries SET state='archived',edit_version=edit_version+1 WHERE id=$1 AND course_id=$2 AND state='draft' AND edit_version=$3;

-- name: SearchQuestionBank :many
SELECT b.archived,v.* FROM question_bank b
JOIN LATERAL(SELECT * FROM bank_question_versions bv WHERE bv.bank_id=b.id ORDER BY version DESC LIMIT 1) v ON true
WHERE b.course_id=sqlc.arg(course_id)
AND (sqlc.arg(search)::text='' OR strpos(lower(v.title||' '||v.prompt),lower(sqlc.arg(search)))>0)
AND (sqlc.arg(state)::text='' OR CASE WHEN sqlc.arg(state)='archived' THEN b.archived ELSE NOT b.archived AND v.state=sqlc.arg(state) END)
AND (sqlc.arg(question_type)::text='' OR v.type=sqlc.arg(question_type))
AND (sqlc.arg(point_id)::text='' OR v.knowledge_point_id=sqlc.arg(point_id))
AND (sqlc.arg(topic_id)::text='' OR EXISTS(SELECT 1 FROM topic_links l WHERE l.bank_version_id=v.id AND l.topic_id=sqlc.arg(topic_id)))
ORDER BY b.created_at DESC,b.id LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);

-- name: CountSearchQuestionBank :one
SELECT count(*) FROM question_bank b
JOIN LATERAL(SELECT * FROM bank_question_versions bv WHERE bv.bank_id=b.id ORDER BY version DESC LIMIT 1) v ON true
WHERE b.course_id=sqlc.arg(course_id)
AND (sqlc.arg(search)::text='' OR strpos(lower(v.title||' '||v.prompt),lower(sqlc.arg(search)))>0)
AND (sqlc.arg(state)::text='' OR CASE WHEN sqlc.arg(state)='archived' THEN b.archived ELSE NOT b.archived AND v.state=sqlc.arg(state) END)
AND (sqlc.arg(question_type)::text='' OR v.type=sqlc.arg(question_type))
AND (sqlc.arg(point_id)::text='' OR v.knowledge_point_id=sqlc.arg(point_id))
AND (sqlc.arg(topic_id)::text='' OR EXISTS(SELECT 1 FROM topic_links l WHERE l.bank_version_id=v.id AND l.topic_id=sqlc.arg(topic_id)));

-- name: CreateRegradeBatch :one
INSERT INTO regrade_batches(id,course_id,question_id,rubric_id,correct_answer,reason,question_snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *;

-- name: GetRegradeBatch :one
SELECT * FROM regrade_batches WHERE id=$1 AND course_id=$2;

-- name: LockRegradeBatch :one
SELECT * FROM regrade_batches WHERE id=$1 AND course_id=$2 FOR UPDATE;

-- name: ListRegradeBatches :many
SELECT * FROM regrade_batches WHERE course_id=$1 ORDER BY created_at DESC;

-- name: EffectiveQuestionSubmissions :many
SELECT DISTINCT ON (s.student_id) s.* FROM submissions s WHERE s.question_id=$1 ORDER BY s.student_id,s.attempt DESC,s.id;

-- name: CreateRegradeItem :exec
INSERT INTO regrade_items(batch_id,submission_id,answer_sha256,baseline_revision) VALUES($1,$2,$3,$4);

-- name: ListRegradeItems :many
SELECT i.*,s.student_id,s.answer_text,s.attempt,u.display_name FROM regrade_items i JOIN submissions s ON s.id=i.submission_id JOIN users u ON u.id=s.student_id WHERE i.batch_id=$1 ORDER BY s.student_id;

-- name: GetRegradeItem :one
SELECT i.*,s.student_id,s.answer_text,s.attempt,u.display_name FROM regrade_items i JOIN submissions s ON s.id=i.submission_id JOIN users u ON u.id=s.student_id WHERE i.batch_id=$1 AND i.submission_id=$2;

-- name: SaveRegradeItem :one
UPDATE regrade_items SET score=$3,feedback=$4,point_scores=$5,confirmed=$6,ai_job_id=$7,edit_version=edit_version+1 WHERE batch_id=$1 AND submission_id=$2 AND edit_version=$8 RETURNING *;

-- name: RegradeBatchState :one
UPDATE regrade_batches SET state=$3,released_at=CASE WHEN $3='released' THEN now() ELSE released_at END WHERE id=$1 AND course_id=$2 AND state='active' RETURNING *;

-- name: AttachRegradeRevision :exec
UPDATE grading_revisions SET regrade_batch_id=$2 WHERE id=$1;

-- name: CreateReleasedRegradeRevision :one
INSERT INTO grading_revisions(id,submission_id,revision,score,feedback,method,state,reviewer_id,request_id,rubric_id,point_scores,ai_job_id,regrade_batch_id,released_at)
VALUES($1,$2,$3,$4,$5,$6,'released',$7,$8,$9,$10,$11,$12,now()) RETURNING *;

-- name: ActiveRegradeForQuestion :one
SELECT EXISTS(SELECT 1 FROM regrade_batches WHERE question_id=$1 AND state='active');

-- name: GetActiveRegradeBatchForQuestion :one
SELECT id FROM regrade_batches WHERE question_id=$1 AND state='active' ORDER BY created_at DESC LIMIT 1;

-- name: GradingManagedByRegrade :one
SELECT EXISTS(SELECT 1 FROM regrade_batches WHERE question_id=$1 AND state IN('active','released'));

-- name: ListResourceAssetsBatch :many
SELECT DISTINCT a.* FROM material_assets a
JOIN material_fragments f ON f.locator->>'asset_id'=a.id
WHERE a.source_id=$1 AND f.id=ANY(sqlc.arg(fragment_ids)::text[]) AND a.kind<>'page'
ORDER BY a.created_at,a.id;

-- name: GetLatestAssetRevision :one
SELECT * FROM asset_revisions WHERE asset_id=$1 ORDER BY revision DESC LIMIT 1;

-- name: SetRevisionMethod :exec
UPDATE grading_revisions SET method=$2 WHERE id=$1;

-- name: LinkKnowledgeRelations :one
UPDATE knowledge_entries SET related_ids=(SELECT array_agg(DISTINCT v) FROM unnest(related_ids||sqlc.arg(related_ids)::text[]) AS v),edit_version=edit_version+1 WHERE id=$1 AND course_id=$2 RETURNING *;

-- name: BankProvenance :many
SELECT * FROM content_decisions d WHERE d.course_id=$1 AND (d.object_id=$2 OR
 (d.kind='paper_adopt' AND EXISTS(SELECT 1 FROM jsonb_array_elements(d.output->'versions') v WHERE v->>'id'=$2))) ORDER BY d.created_at;

-- name: DecisionByJob :one
SELECT * FROM content_decisions WHERE course_id=$1 AND kind=$2 AND inputs->>'job_id'=sqlc.arg(job_id)::text ORDER BY created_at LIMIT 1;

-- name: ContentImpact :many
WITH RECURSIVE sk AS (
 SELECT k.id FROM knowledge_entries k WHERE k.course_id=sqlc.arg(course_id) AND
 (k.id=sqlc.arg(knowledge_id)::text OR EXISTS(SELECT 1 FROM jsonb_array_elements(k.evidence) ev WHERE ev->>'source_id'=sqlc.arg(source_id)::text))
 UNION SELECT k.id FROM knowledge_entries k JOIN sk ON sk.id=ANY(k.related_ids) WHERE k.course_id=sqlc.arg(course_id)
), bq AS (
 SELECT v.id FROM bank_question_versions v JOIN question_bank b ON b.id=v.bank_id WHERE b.course_id=sqlc.arg(course_id) AND
 (EXISTS(SELECT 1 FROM jsonb_array_elements(v.evidence_refs) ev WHERE ev->>'source_id'=NULLIF(sqlc.arg(source_id)::text,'') OR ev->>'knowledge_id' IN (SELECT id FROM sk))
 OR EXISTS(SELECT 1 FROM content_decisions d, jsonb_array_elements(d.output->'versions') pv WHERE d.kind='paper_adopt' AND d.course_id=b.course_id AND d.object_id=NULLIF(sqlc.arg(source_id)::text,'') AND pv->>'id'=v.id)
 OR EXISTS(SELECT 1 FROM bank_question_assets l JOIN material_assets a ON a.id=l.asset_id WHERE l.version_id=v.id AND a.source_id=NULLIF(sqlc.arg(source_id)::text,'')))
), rb AS (
 SELECT r.id FROM rubric_versions r WHERE r.bank_question_version_id IN(SELECT id FROM bq) OR EXISTS(
 SELECT 1 FROM jsonb_array_elements(r.evidence_refs) ev WHERE ev->>'source_id'=NULLIF(sqlc.arg(source_id)::text,'') OR ev->>'knowledge_id' IN(SELECT id FROM sk))
), aq AS (
 SELECT q.id,q.assignment_id FROM questions q JOIN assignments a ON a.id=q.assignment_id WHERE a.course_id=sqlc.arg(course_id) AND
 (q.bank_question_version_id IN(SELECT id FROM bq) OR q.bound_rubric_id IN(SELECT id FROM rb) OR q.id IN(SELECT r.question_id FROM rubric_versions r WHERE r.id IN(SELECT id FROM rb)) OR q.resource_id IN(SELECT id FROM resources WHERE source_id=NULLIF(sqlc.arg(source_id)::text,'')))
)
SELECT 'knowledge'::text AS kind,k.id,k.title,k.state,k.version,NULL::text AS parent_id FROM knowledge_entries k WHERE k.id IN(SELECT id FROM sk)
UNION ALL SELECT 'question',v.id,v.title,v.state,v.version,v.bank_id FROM bank_question_versions v WHERE v.id IN(SELECT id FROM bq)
UNION ALL SELECT CASE WHEN r.bank_question_version_id IS NOT NULL THEN 'rubric' ELSE 'assignment_rubric' END,r.id,'评分标准',r.state,r.version,COALESCE(r.bank_question_version_id,(SELECT q.assignment_id FROM questions q WHERE q.id=r.question_id)) FROM rubric_versions r WHERE r.id IN(SELECT id FROM rb)
UNION ALL SELECT 'assignment',a.id,a.title,a.status,a.version,NULL::text FROM assignments a WHERE a.id IN(SELECT assignment_id FROM aq)
UNION ALL SELECT 'assignment_question',q.id,q.prompt,a.status,a.version,a.id FROM questions q JOIN assignments a ON a.id=q.assignment_id WHERE q.id IN(SELECT id FROM aq)
UNION ALL SELECT 'resource',r.id,r.title,r.status,r.version,NULL::text FROM resources r WHERE r.course_id=sqlc.arg(course_id) AND r.source_id=NULLIF(sqlc.arg(source_id)::text,'')
UNION ALL SELECT 'result',g.id,'正式评分',g.state,g.revision,s.assignment_id FROM grading_revisions g JOIN submissions s ON s.id=g.submission_id WHERE s.course_id=sqlc.arg(course_id) AND g.state='released' AND (g.rubric_id IN(SELECT id FROM rb) OR s.question_id IN(SELECT id FROM aq));

-- name: GetAssignmentForUpdate :one
SELECT * FROM assignments WHERE id=$1 FOR UPDATE;

-- name: LinkBankAsset :exec
INSERT INTO bank_question_assets(version_id,asset_id) VALUES($1,$2);

-- name: BankAssets :many
SELECT a.* FROM material_assets a JOIN bank_question_assets l ON l.asset_id=a.id WHERE l.version_id=$1 ORDER BY a.id;

-- name: StudentAssetAccess :one
SELECT EXISTS(SELECT 1 FROM material_assets a JOIN material_sources s ON s.id=a.source_id WHERE a.id=$1 AND s.course_id=$2 AND a.kind<>'page'
AND (EXISTS(SELECT 1 FROM resources r JOIN material_fragments f ON f.id=ANY(r.fragment_ids) WHERE r.course_id=s.course_id AND r.status='published' AND f.locator->>'asset_id'=a.id)
OR EXISTS(SELECT 1 FROM bank_question_assets l JOIN questions q ON q.bank_question_version_id=l.version_id JOIN assignments w ON w.id=q.assignment_id WHERE l.asset_id=a.id AND w.course_id=s.course_id AND w.status IN ('published','closed'))));
