-- +goose Up
ALTER TABLE interventions ADD COLUMN resource_id text REFERENCES resources(id);
ALTER TABLE interventions ADD COLUMN assignment_id text REFERENCES assignments(id);

-- +goose Down
ALTER TABLE interventions DROP COLUMN assignment_id;
ALTER TABLE interventions DROP COLUMN resource_id;
