-- +goose Up
ALTER TABLE users ADD COLUMN username text UNIQUE;
ALTER TABLE users ADD COLUMN password_hash text;
ALTER TABLE users ADD CONSTRAINT users_login_pair CHECK (
 (username IS NULL AND password_hash IS NULL) OR
 (username IS NOT NULL AND password_hash IS NOT NULL AND length(username) BETWEEN 1 AND 64)
);

CREATE TABLE sessions (
 token_hash text PRIMARY KEY CHECK (length(token_hash) = 64),
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

-- +goose Down
DROP TABLE sessions;
ALTER TABLE users DROP CONSTRAINT users_login_pair;
ALTER TABLE users DROP COLUMN password_hash;
ALTER TABLE users DROP COLUMN username;
