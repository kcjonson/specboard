-- Add signup metadata column to users table
-- Stores acquisition context captured at account creation time (invite key, UTM params, referral source)

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS signup_metadata JSONB NOT NULL DEFAULT '{}';
