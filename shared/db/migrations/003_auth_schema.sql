-- Auth schema update: Replace Cognito with PostgreSQL + bcrypt
-- This migration restructures the users table and adds password-based auth

-- First, drop tables that depend on users (will be recreated or already dropped)
DROP TABLE IF EXISTS oauth_codes CASCADE;
DROP TABLE IF EXISTS mcp_tokens CASCADE;
DROP TABLE IF EXISTS github_connections CASCADE;
DROP TABLE IF EXISTS user_emails CASCADE;

-- Drop foreign key constraints from epics/tasks that reference users
ALTER TABLE epics DROP CONSTRAINT IF EXISTS epics_creator_fkey;
ALTER TABLE epics DROP CONSTRAINT IF EXISTS epics_assignee_fkey;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_assignee_fkey;

-- Drop and recreate users table with new schema
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(255) NOT NULL UNIQUE,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    email_verified BOOLEAN DEFAULT FALSE,
    email_verified_at TIMESTAMPTZ,
    phone_number VARCHAR(50),
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User passwords (for username/password auth)
CREATE TABLE user_passwords (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Email verification tokens
CREATE TABLE email_verification_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Password reset tokens
CREATE TABLE password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recreate GitHub connections table
CREATE TABLE github_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    github_user_id VARCHAR(255) NOT NULL UNIQUE,
    github_username VARCHAR(255) NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    scopes TEXT[] NOT NULL,
    connected_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recreate MCP OAuth tokens table
CREATE TABLE mcp_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id VARCHAR(255) NOT NULL,
    access_token_hash VARCHAR(255) NOT NULL UNIQUE,
    refresh_token_hash VARCHAR(255),
    scopes TEXT[] NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recreate OAuth authorization codes table
CREATE TABLE oauth_codes (
    code VARCHAR(255) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id VARCHAR(255) NOT NULL,
    code_challenge VARCHAR(255) NOT NULL,
    code_challenge_method VARCHAR(10) NOT NULL,
    scopes TEXT[] NOT NULL,
    redirect_uri TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

-- Re-add foreign key constraints to epics/tasks
ALTER TABLE epics ADD CONSTRAINT epics_creator_fkey
    FOREIGN KEY (creator) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE epics ADD CONSTRAINT epics_assignee_fkey
    FOREIGN KEY (assignee) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD CONSTRAINT tasks_assignee_fkey
    FOREIGN KEY (assignee) REFERENCES users(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_email_verification_tokens_user ON email_verification_tokens(user_id);
CREATE INDEX idx_email_verification_tokens_expires ON email_verification_tokens(expires_at);
CREATE INDEX idx_password_reset_tokens_user ON password_reset_tokens(user_id);
CREATE INDEX idx_password_reset_tokens_expires ON password_reset_tokens(expires_at);
CREATE INDEX idx_mcp_tokens_user_id ON mcp_tokens(user_id);
CREATE INDEX idx_mcp_tokens_expires_at ON mcp_tokens(expires_at);
CREATE INDEX idx_oauth_codes_expires_at ON oauth_codes(expires_at);

-- Trigger for updated_at on users
CREATE OR REPLACE FUNCTION update_users_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_users_timestamp();

-- Trigger for updated_at on user_passwords
CREATE OR REPLACE FUNCTION update_user_passwords_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_passwords_updated_at
    BEFORE UPDATE ON user_passwords
    FOR EACH ROW
    EXECUTE FUNCTION update_user_passwords_timestamp();
