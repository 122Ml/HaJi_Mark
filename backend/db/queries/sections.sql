-- name: CreateContentSection :one
INSERT INTO content_sections(id,course_id,source_id,revision,position,title,relation,fragment_ids,knowledge_point_id,reason,state)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,sqlc.narg(knowledge_point_id),$9,$10) RETURNING *;

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
