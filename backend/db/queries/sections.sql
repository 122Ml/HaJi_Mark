-- name: CreateContentSection :one
INSERT INTO content_sections(id,course_id,source_id,revision,position,title,relation,fragment_ids,knowledge_point_id,reason)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,sqlc.narg(knowledge_point_id),$9) RETURNING *;

-- name: ListContentSections :many
SELECT * FROM content_sections WHERE source_id=$1 AND revision=$2 ORDER BY position;

-- name: DeleteContentSections :exec
DELETE FROM content_sections WHERE source_id=$1 AND revision=$2;

-- name: SetContentSectionsState :exec
UPDATE content_sections SET state=$3, edit_version=edit_version+1 WHERE source_id=$1 AND revision=$2;
