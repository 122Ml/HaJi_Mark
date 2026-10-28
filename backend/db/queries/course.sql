-- name: ListPublishedCourses :many
SELECT c.id, c.title, c.version, count(k.id)::integer AS knowledge_point_count
FROM courses c
LEFT JOIN knowledge_points k ON k.course_id = c.id
WHERE c.status = 'published'
GROUP BY c.id, c.title, c.version
ORDER BY c.id;
