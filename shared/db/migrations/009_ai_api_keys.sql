-- User API keys for external services (e.g., Anthropic)
-- Keys are encrypted using AES-256-GCM before storage

CREATE TABLE user_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,  -- e.g., 'anthropic'
    key_name VARCHAR(255) NOT NULL,
    encrypted_key TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    masked_key VARCHAR(20) NOT NULL,  -- Pre-computed masked key for display (avoids decryption)
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, provider)  -- One key per provider per user
);

-- Index for user lookups
CREATE INDEX idx_user_api_keys_user_id ON user_api_keys(user_id);
