-- Magic link login tokens
-- One row per pending sign-in email; carries both the URL token and the short
-- typed code. Single-use is enforced by delete-on-consume; the code's low
-- entropy is bounded by code_attempts (checked in the handler) plus expiry.

CREATE TABLE magic_link_tokens (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	token_hash VARCHAR(255) NOT NULL,
	code_hash VARCHAR(255) NOT NULL,
	code_attempts SMALLINT NOT NULL DEFAULT 0,
	next_path TEXT,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_magic_link_tokens_token_hash ON magic_link_tokens(token_hash);
-- One pending sign-in per user, enforced so issuing can UPSERT atomically
-- rather than DELETE-then-INSERT (which races into duplicate live rows).
CREATE UNIQUE INDEX idx_magic_link_tokens_user_id ON magic_link_tokens(user_id);
CREATE INDEX idx_magic_link_tokens_expires_at ON magic_link_tokens(expires_at);
