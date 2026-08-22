-- Passkeys (WebAuthn credentials). One row per registered credential.
-- public_key holds the raw COSE key bytes (converted to a verify key per use).

CREATE TABLE webauthn_credentials (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	credential_id TEXT NOT NULL UNIQUE,          -- base64url of the raw credential id
	public_key BYTEA NOT NULL,                   -- raw COSE_Key bytes
	counter BIGINT NOT NULL DEFAULT 0,           -- signature counter (clone detection)
	transports TEXT[],                           -- client-reported, e.g. {internal,hybrid}
	aaguid UUID,
	device_type VARCHAR(32),                     -- singleDevice | multiDevice
	backed_up BOOLEAN NOT NULL DEFAULT FALSE,
	name VARCHAR(255) NOT NULL DEFAULT 'Passkey',
	created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
	last_used_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_webauthn_credentials_user_id ON webauthn_credentials(user_id);
