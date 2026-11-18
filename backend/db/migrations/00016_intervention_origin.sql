-- +goose Up
ALTER TABLE interventions
 ADD COLUMN source_submission_id text REFERENCES submissions(id),
 ADD COLUMN diagnosis_report_id text REFERENCES intelligence_reports(id),
 ADD COLUMN diagnosis_label_id text;
ALTER TABLE interventions ADD CONSTRAINT intervention_diagnosis_origin CHECK (
 (diagnosis_report_id IS NULL AND diagnosis_label_id IS NULL) OR
 (diagnosis_report_id IS NOT NULL AND diagnosis_label_id IS NOT NULL AND source_submission_id IS NOT NULL)
);

-- +goose Down
ALTER TABLE interventions DROP CONSTRAINT intervention_diagnosis_origin;
ALTER TABLE interventions DROP COLUMN source_submission_id, DROP COLUMN diagnosis_report_id, DROP COLUMN diagnosis_label_id;
