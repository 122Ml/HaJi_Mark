-- name: CreateContentSection :one
INSERT INTO content_sections(id,course_id,source_id,revision,position,title,relation,fragment_ids,knowledge_point_id,reason,state,time_start_ms,time_end_ms,split_quotes,start_char,end_char)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,sqlc.narg(knowledge_point_id),$9,$10,$11,$12,$13,$14,$15) RETURNING *;

-- name: ListContentSections :many
SELECT * FROM content_sections WHERE course_id=$1 AND source_id=$2 AND revision=$3 ORDER BY position;

-- name: DeleteContentSections :exec
DELETE FROM content_sections WHERE course_id=$1 AND source_id=$2 AND revision=$3;

-- name: SetContentSectionsState :execrows
UPDATE content_sections SET state=$4, edit_version=edit_version+1
 WHERE course_id=$1 AND source_id=$2 AND revision=$3
   AND (($4='accepted' AND state='proposed')
     OR ($4='rejected' AND state IN ('proposed','accepted'))
     OR ($4='proposed' AND state='rejected'));

-- name: UpdateContentSection :one
UPDATE content_sections
   SET title=$5, relation=$6, knowledge_point_id=sqlc.narg(knowledge_point_id), time_start_ms=$7, time_end_ms=$8, reason=$9, edit_version=edit_version+1
 WHERE id=$1 AND course_id=$2 AND source_id=$3 AND revision=$4 AND edit_version=$10 AND state IN ('proposed','rejected')
 RETURNING *;

-- name: ListSectionsByPoint :many
SELECT s.id, s.title, s.relation, s.time_start_ms, s.time_end_ms, s.state,
       s.source_id, m.title AS source_title, m.filename AS source_filename
FROM content_sections s
JOIN material_sources m ON m.id = s.source_id
WHERE s.course_id = $1
  AND m.course_id = $1
  AND m.state = 'active'
  AND s.revision = m.parse_revision
  AND s.knowledge_point_id = sqlc.arg(knowledge_point_id)::text
  AND s.state = 'accepted'
ORDER BY s.source_id, s.time_start_ms, s.position;
