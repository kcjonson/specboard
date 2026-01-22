-- Waitlist signups for early access
CREATE TABLE IF NOT EXISTS waitlist_signups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    company VARCHAR(255),
    role VARCHAR(255),
    use_case TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for email lookups
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist_signups(email);

-- Index for ordering by signup date
CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist_signups(created_at DESC);
