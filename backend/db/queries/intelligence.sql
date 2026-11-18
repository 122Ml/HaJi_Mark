-- name: CreateIntelligenceReport :one
INSERT INTO intelligence_reports(id,course_id,owner_id,kind,question_id,job_id,request_id,input_hash,input) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *;
-- name: IntelligenceReport :one
SELECT r.*,j.state AS job_state,j.error AS job_error FROM intelligence_reports r JOIN processing_jobs j ON j.id=r.job_id WHERE r.id=$1 AND r.course_id=$2;
-- name: IntelligenceRequest :one
SELECT id FROM intelligence_reports WHERE course_id=$1 AND owner_id=$2 AND request_id=$3;
-- name: ListIntelligenceReports :many
SELECT r.id,r.kind,r.question_id,r.job_id,r.state,r.edit_version,r.created_at,j.state AS job_state,j.error AS job_error FROM intelligence_reports r JOIN processing_jobs j ON j.id=r.job_id WHERE r.course_id=$1 AND r.owner_id=$2 AND r.kind=$3 ORDER BY r.created_at DESC,r.id DESC LIMIT 50;
-- name: FinishIntelligenceReport :execrows
UPDATE intelligence_reports SET output=$2 WHERE id=$1 AND output='{}'::jsonb;
-- name: ConfirmDiagnosis :one
UPDATE intelligence_reports SET output=$3,state='confirmed',edit_version=edit_version+1 WHERE id=$1 AND owner_id=$2 AND kind='diagnosis' AND state='draft' AND edit_version=$4 RETURNING *;
-- name: SaveDiagnosis :one
UPDATE intelligence_reports SET output=$3,edit_version=edit_version+1 WHERE id=$1 AND owner_id=$2 AND kind='diagnosis' AND state='draft' AND edit_version=$4 RETURNING *;
-- name: ListDiagnosisLabels :many
SELECT * FROM diagnosis_labels WHERE course_id=$1 ORDER BY title,id;
-- name: PutDiagnosisLabel :one
INSERT INTO diagnosis_labels(id,course_id,title) VALUES($1,$2,$3) ON CONFLICT(course_id,title) DO UPDATE SET active=true,edit_version=diagnosis_labels.edit_version+1 RETURNING *;
-- name: SetDiagnosisLabel :one
UPDATE diagnosis_labels SET active=$3,edit_version=edit_version+1 WHERE id=$1 AND course_id=$2 AND edit_version=$4 RETURNING *;
-- name: RecommendationChoices :many
SELECT * FROM recommendation_choices WHERE report_id=$1;
-- name: PutRecommendationChoice :exec
INSERT INTO recommendation_choices(report_id,candidate_id,choice) VALUES($1,$2,$3) ON CONFLICT(report_id,candidate_id) DO UPDATE SET choice=excluded.choice;
