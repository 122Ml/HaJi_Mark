-- +goose Up
-- Section-level split inside a single fragment.
-- split_quotes: at most one quote; when set, this section starts at the first
--               occurrence of the quote inside its first fragment.
-- start_char / end_char: rune offsets relative to the first / last fragment.
--               end_char = 0 means "to the end of the last fragment".
ALTER TABLE content_sections
  ADD COLUMN split_quotes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN start_char integer NOT NULL DEFAULT 0,
  ADD COLUMN end_char integer NOT NULL DEFAULT 0;

ALTER TABLE content_sections
  ADD CONSTRAINT content_sections_single_split CHECK (cardinality(split_quotes) <= 1),
  ADD CONSTRAINT content_sections_char_span CHECK (start_char >= 0 AND end_char >= 0),
  ADD CONSTRAINT content_sections_char_order CHECK (cardinality(fragment_ids) > 1 OR end_char = 0 OR end_char > start_char);

-- +goose Down
ALTER TABLE content_sections
  DROP CONSTRAINT content_sections_char_order,
  DROP CONSTRAINT content_sections_char_span,
  DROP CONSTRAINT content_sections_single_split,
  DROP COLUMN end_char,
  DROP COLUMN start_char,
  DROP COLUMN split_quotes;
