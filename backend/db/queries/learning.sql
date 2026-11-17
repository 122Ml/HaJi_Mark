-- name: GetBusinessCourse :one
SELECT * FROM courses WHERE id=$1;

-- name: CreateBusinessCourse :one
INSERT INTO courses(id,title,teacher_id) VALUES($1,$2,$3) RETURNING *;

-- name: PublishBusinessCourse :one
UPDATE courses SET status='published',version=version+1 WHERE id=$1 AND teacher_id=$2 RETURNING *;

-- name: ListBusinessPoints :many
SELECT * FROM knowledge_points WHERE course_id=$1 ORDER BY position,id;

-- name: AddBusinessPoint :one
INSERT INTO knowledge_points(id,course_id,title,position,parent_id,kind,description) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *;

-- name: ListBusinessMembers :many
SELECT u.id,u.display_name,u.username FROM enrollments e JOIN users u ON u.id=e.student_id WHERE e.course_id=$1 ORDER BY u.display_name,u.id;

-- name: IsEnrolled :one
SELECT EXISTS(SELECT 1 FROM enrollments WHERE course_id=$1 AND student_id=$2);

-- name: EnrollByUsername :one
INSERT INTO enrollments(course_id,student_id)
SELECT $1,u.id FROM users u WHERE u.username=$2 AND u.role='student'
ON CONFLICT DO NOTHING RETURNING student_id;

-- name: ListBusinessResources :many
SELECT * FROM resources WHERE course_id=$1 AND (sqlc.arg(teacher)::boolean OR status='published') ORDER BY created_at,id;

-- name: GetBusinessResource :one
SELECT * FROM resources WHERE id=$1;

-- name: CreateBusinessResource :one
INSERT INTO resources(id,course_id,title,content,source_url,locator,created_by,knowledge_point_id,source_note)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *;

-- name: PublishBusinessResource :one
UPDATE resources SET status='published',reviewed_by=$2,published_at=now() WHERE id=$1 AND status='draft' RETURNING *;

-- name: AddLearningEvent :one
INSERT INTO learning_events(id,course_id,actor_id,resource_id,verb,request_id,object_version)
VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING *;

-- name: AddSubmissionEvent :exec
INSERT INTO learning_events(id,course_id,actor_id,submission_id,verb,request_id,object_version,occurred_at)
VALUES($1,$2,$3,$4,'submission.submitted',$5,$6,$7);

-- name: GetLearningEventByRequest :one
SELECT * FROM learning_events WHERE actor_id=$1 AND request_id=$2;

-- name: ListMyLearningEvents :many
SELECT * FROM learning_events WHERE course_id=$1 AND actor_id=$2 ORDER BY occurred_at DESC;

-- name: ListBusinessAssignments :many
SELECT * FROM assignments WHERE course_id=$1 AND (sqlc.arg(teacher)::boolean OR status IN ('published','closed')) ORDER BY created_at DESC,id;

-- name: GetBusinessAssignment :one
SELECT * FROM assignments WHERE id=$1;

-- name: CreateBusinessAssignment :one
INSERT INTO assignments(id,course_id,title,description,type,max_score,due_at,created_by)
VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *;

-- name: UpdateBusinessAssignmentState :one
UPDATE assignments SET status=$2,published_at=CASE WHEN $2='published' THEN now() ELSE published_at END
WHERE id=$1 AND status=$3 RETURNING *;

-- name: ListBusinessQuestions :many
SELECT * FROM questions WHERE assignment_id=$1 ORDER BY position,id;

-- name: GetBusinessQuestion :one
SELECT * FROM questions WHERE id=$1;

-- name: CreateBusinessQuestion :one
INSERT INTO questions(id,assignment_id,prompt,type,max_score,rubric,position,options,correct_answer,knowledge_point_id,resource_id)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *;

-- name: GetAnswerDraft :one
SELECT * FROM answer_drafts WHERE student_id=$1 AND question_id=$2;

-- name: SaveAnswerDraft :one
INSERT INTO answer_drafts(student_id,question_id,answer_text) VALUES($1,$2,$3)
ON CONFLICT(student_id,question_id) DO UPDATE SET answer_text=excluded.answer_text,updated_at=now() RETURNING *;

-- name: GetBusinessSubmission :one
SELECT * FROM submissions WHERE id=$1;

-- name: GetSubmissionByRequest :one
SELECT * FROM submissions WHERE student_id=$1 AND request_id=$2;

-- name: NextSubmissionAttempt :one
SELECT (COALESCE(max(attempt),0)+1)::integer AS next_attempt FROM submissions WHERE student_id=$1 AND question_id=$2;

-- name: CreateBusinessSubmission :one
INSERT INTO submissions(id,assignment_id,question_id,course_id,student_id,attempt,answer_text,answer_sha256,request_id,assignment_version)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *;

-- name: ListBusinessSubmissions :many
SELECT s.*,u.display_name AS student_name,EXISTS(SELECT 1 FROM submission_import_items i WHERE i.submission_id=s.id) AS teacher_imported FROM submissions s JOIN users u ON u.id=s.student_id
WHERE s.assignment_id=$1 AND (sqlc.arg(teacher)::boolean OR s.student_id=sqlc.arg(actor_id)) ORDER BY s.submitted_at DESC,s.id;

-- name: LockBusinessAssignment :one
SELECT id FROM assignments WHERE id=$1 FOR UPDATE;

-- name: LockBusinessSubmission :one
SELECT id FROM submissions WHERE id=$1 FOR UPDATE;

-- name: ListBusinessRevisions :many
SELECT * FROM grading_revisions WHERE submission_id=$1 AND (sqlc.arg(teacher)::boolean OR state='released') ORDER BY revision DESC;

-- name: CreateRuleRevision :one
INSERT INTO grading_revisions(id,submission_id,revision,score,feedback,method,state,reviewer_id,request_id,released_at)
VALUES($1,$2,1,$3,'根据教师已发布的标准答案自动判分','rule','released',$4,$5,now()) RETURNING *;

-- name: CourseReleasedEvidence :many
SELECT DISTINCT ON (s.student_id,s.question_id) s.id AS submission_id,s.student_id,s.question_id,s.answer_text,s.attempt,r.id AS revision_id,r.score,r.feedback,q.max_score,q.prompt,q.knowledge_point_id,q.resource_id,r.released_at,r.rubric_id,r.point_scores,rv.version AS rubric_version
FROM submissions s JOIN questions q ON q.id=s.question_id
JOIN LATERAL (SELECT * FROM grading_revisions g WHERE g.submission_id=s.id AND g.state='released' ORDER BY g.revision DESC LIMIT 1) r ON true
LEFT JOIN rubric_versions rv ON rv.id=r.rubric_id
WHERE s.course_id=$1 AND (sqlc.arg(teacher)::boolean OR s.student_id=sqlc.arg(actor_id))
ORDER BY s.student_id,s.question_id,s.attempt DESC;

-- name: GetBusinessRevision :one
SELECT * FROM grading_revisions WHERE id=$1;

-- name: GetRevisionByRequest :one
SELECT * FROM grading_revisions WHERE reviewer_id=$1 AND request_id=$2;

-- name: NextBusinessRevision :one
SELECT (COALESCE(max(revision),0)+1)::integer AS next_revision FROM grading_revisions WHERE submission_id=$1;

-- name: CreateBusinessRevision :one
INSERT INTO grading_revisions(id,submission_id,revision,score,feedback,reviewer_id,request_id)
VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *;

-- name: TransitionBusinessRevision :one
UPDATE grading_revisions SET state=$2,released_at=CASE WHEN $2='released' THEN now() ELSE released_at END
WHERE id=$1 AND state=$3 RETURNING *;

-- name: MarkBusinessSubmissionGraded :exec
UPDATE submissions SET status='graded' WHERE id=$1;

-- name: ListBusinessInterventions :many
SELECT i.*,u.display_name AS student_name FROM interventions i JOIN users u ON u.id=i.student_id
WHERE i.course_id=$1 AND (sqlc.arg(teacher)::boolean OR (i.student_id=sqlc.arg(actor_id) AND i.status<>'draft')) ORDER BY i.created_at DESC;

-- name: GetBusinessIntervention :one
SELECT * FROM interventions WHERE id=$1;

-- name: CreateBusinessIntervention :one
INSERT INTO interventions(id,course_id,student_id,title,description,teacher_id,resource_id,assignment_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *;

-- name: TransitionBusinessIntervention :one
UPDATE interventions SET status=$2,
answer_text=CASE WHEN $2='submitted' THEN $4 ELSE answer_text END,
review_note=CASE WHEN $2='reviewed' THEN $4 ELSE review_note END,
assigned_at=CASE WHEN $2='assigned' THEN now() ELSE assigned_at END,
submitted_at=CASE WHEN $2='submitted' THEN now() ELSE submitted_at END,
reviewed_at=CASE WHEN $2='reviewed' THEN now() ELSE reviewed_at END
WHERE id=$1 AND status=$3 RETURNING *;

-- name: ListBusinessInteractions :many
SELECT i.*,u.display_name AS author_name,u.role AS author_role FROM interactions i JOIN users u ON u.id=i.actor_id WHERE i.course_id=$1 ORDER BY i.created_at DESC,i.id;

-- name: GetBusinessInteraction :one
SELECT * FROM interactions WHERE id=$1;

-- name: CreateBusinessInteraction :one
INSERT INTO interactions(id,course_id,actor_id,kind,title,content,parent_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *;

-- name: BusinessOverview :many
SELECT u.id,u.display_name,
 (SELECT count(DISTINCT resource_id) FROM learning_events l WHERE l.course_id=e.course_id AND l.actor_id=u.id AND l.verb='completed')::integer AS completed_events,
 (SELECT count(DISTINCT s.assignment_id) FROM submissions s WHERE s.course_id=e.course_id AND s.student_id=u.id)::integer AS submitted_assignments,
 (SELECT count(*) FROM interventions i WHERE i.course_id=e.course_id AND i.student_id=u.id AND i.status='assigned')::integer AS pending_interventions
FROM enrollments e JOIN users u ON u.id=e.student_id WHERE e.course_id=$1 ORDER BY u.display_name,u.id;

-- name: ListResearchRecords :many
SELECT * FROM research_records WHERE course_id=$1 ORDER BY created_at DESC;

-- name: CreateResearchRecord :one
INSERT INTO research_records(id,course_id,teacher_id,title,content) VALUES($1,$2,$3,$4,$5) RETURNING *;

-- name: ListIndustryRecords :many
SELECT * FROM industry_records WHERE course_id=$1 ORDER BY created_at DESC;

-- name: CreateIndustryRecord :one
INSERT INTO industry_records(id,course_id,title,source_url,skills,teacher_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *;

-- name: UpdateActorName :one
UPDATE users SET display_name=$2 WHERE id=$1 RETURNING id,username,display_name,role;

-- name: GetActorPassword :one
SELECT password_hash FROM users WHERE id=$1;

-- name: UpdateActorPassword :exec
UPDATE users SET password_hash=$2 WHERE id=$1;

-- name: DeleteActorSessions :exec
DELETE FROM sessions WHERE user_id=$1;

-- name: UpdateAssignmentDraft :one
UPDATE assignments SET title=$2,description=$3,type=$4,max_score=$5,due_at=$6,version=version+1 WHERE id=$1 AND status='draft' RETURNING *;

-- name: DeleteDraftQuestions :exec
DELETE FROM questions WHERE assignment_id=$1;

-- name: ListLearningNotes :many
SELECT n.* FROM learning_notes n JOIN resources r ON r.id=n.resource_id WHERE n.actor_id=$1 AND r.course_id=$2 ORDER BY n.updated_at DESC;

-- name: SaveLearningNote :one
INSERT INTO learning_notes(actor_id,resource_id,note,favorite) VALUES($1,$2,$3,$4)
ON CONFLICT(actor_id,resource_id) DO UPDATE SET note=excluded.note,favorite=excluded.favorite,updated_at=now() RETURNING *;

-- name: GetKnowledgePoint :one
SELECT * FROM knowledge_points WHERE id=$1;

-- name: ListCourseEdges :many
SELECT * FROM course_edges WHERE course_id=$1 ORDER BY from_id,to_id;

-- name: AddCourseEdge :one
INSERT INTO course_edges(course_id,from_id,to_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *;

-- name: CreateStudyPath :one
INSERT INTO study_paths(id,course_id,student_id,rule_version) VALUES($1,$2,$3,$4) RETURNING *;

-- name: AddStudyPathItem :exec
INSERT INTO study_path_items(path_id,knowledge_point_id,position,reason) VALUES($1,$2,$3,$4);

-- name: LatestStudyPath :one
SELECT * FROM study_paths WHERE course_id=$1 AND student_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1;

-- name: ListStudyPathItems :many
SELECT i.*,k.title,k.description FROM study_path_items i JOIN knowledge_points k ON k.id=i.knowledge_point_id WHERE path_id=$1 ORDER BY i.position;

-- name: CreateResourceRevision :one
INSERT INTO resources(id,course_id,knowledge_point_id,title,content,source_url,locator,version,created_by,supersedes_id,source_note)
SELECT $1,r.course_id,r.knowledge_point_id,$2,$3,$4,$5,r.version+1,$6,r.id,$8 FROM resources r WHERE r.id=$7 AND r.status='published' RETURNING *;

-- name: AssignmentSubmissionRoster :many
SELECT u.id AS student_id,u.display_name,
 (SELECT count(DISTINCT s.question_id)::integer FROM submissions s WHERE s.assignment_id=sqlc.arg(assignment_id) AND s.student_id=u.id) AS submitted_questions,
 (SELECT count(*)::integer FROM questions q WHERE q.assignment_id=sqlc.arg(assignment_id)) AS total_questions,
 COALESCE(latest.id,'')::text AS submission_id,COALESCE(latest.attempt,0)::integer AS attempt,
 COALESCE(latest.answer_text,'')::text AS answer_text,COALESCE(latest.answer_sha256,'')::text AS answer_sha256,latest.submitted_at
FROM enrollments e JOIN users u ON u.id=e.student_id
LEFT JOIN LATERAL (
 SELECT s.id,s.attempt,s.answer_text,s.answer_sha256,s.submitted_at FROM submissions s
 WHERE s.assignment_id=sqlc.arg(assignment_id) AND s.student_id=u.id
 ORDER BY s.submitted_at DESC,s.id DESC LIMIT 1
) latest ON true
WHERE e.course_id=sqlc.arg(course_id) ORDER BY u.display_name,u.id;

-- name: ListCourseActivity :many
SELECT e.id,e.actor_id,u.display_name,e.verb,e.resource_id,e.submission_id,e.object_version,e.occurred_at,
 COALESCE(r.title,a.title,'')::text AS title,COALESCE(r.locator,'')::text AS locator,
 COALESCE(r.source_note,'')::text AS source_note,COALESCE(r.source_url,'')::text AS source_url,
 COALESCE(s.attempt,0)::integer AS attempt,COALESCE(s.answer_sha256,'')::text AS answer_sha256
FROM learning_events e JOIN users u ON u.id=e.actor_id
LEFT JOIN resources r ON r.id=e.resource_id
LEFT JOIN submissions s ON s.id=e.submission_id
LEFT JOIN assignments a ON a.id=s.assignment_id
WHERE e.course_id=sqlc.arg(course_id) AND (sqlc.arg(student_id)::text='' OR e.actor_id=sqlc.arg(student_id) OR s.student_id=sqlc.arg(student_id))
ORDER BY e.occurred_at DESC,e.id DESC LIMIT 500;

-- name: LockBusinessCourse :one
SELECT id FROM courses WHERE id=$1 FOR UPDATE;

-- name: HasInterventionLearning :one
SELECT EXISTS(SELECT 1 FROM learning_events WHERE actor_id=$1 AND resource_id=$2 AND verb='completed' AND occurred_at >= $3);

-- name: HasInterventionSubmission :one
SELECT EXISTS(SELECT 1 FROM questions q WHERE q.assignment_id=$2 GROUP BY q.assignment_id HAVING count(*) = (
 SELECT count(DISTINCT s.question_id) FROM submissions s
 WHERE s.student_id=$1 AND s.assignment_id=$2 AND s.submitted_at >= $3
 AND NOT EXISTS(SELECT 1 FROM submission_import_items i WHERE i.submission_id=s.id)
));

-- name: RenameBusinessCourse :one
UPDATE courses SET title=$2 WHERE id=$1 RETURNING *;

-- name: EditResearchRecord :one
UPDATE research_records SET title=$3,content=$4 WHERE id=$1 AND course_id=$2 RETURNING *;

-- name: DeleteResearchRecord :one
DELETE FROM research_records WHERE id=$1 AND course_id=$2 RETURNING id;

-- name: EditIndustryRecord :one
UPDATE industry_records SET title=$3,source_url=$4,skills=$5 WHERE id=$1 AND course_id=$2 RETURNING *;

-- name: DeleteIndustryRecord :one
DELETE FROM industry_records WHERE id=$1 AND course_id=$2 RETURNING id;
