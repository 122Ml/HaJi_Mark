-- +goose Up
ALTER TABLE resources ADD COLUMN supersedes_id text REFERENCES resources(id);
CREATE UNIQUE INDEX resource_single_draft_revision_idx ON resources(supersedes_id) WHERE supersedes_id IS NOT NULL;

-- +goose Down
DROP INDEX resource_single_draft_revision_idx;
ALTER TABLE resources DROP COLUMN supersedes_id;
