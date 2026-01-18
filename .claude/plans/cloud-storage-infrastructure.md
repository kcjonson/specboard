# COMPLETE - 2026-01-18

# Cloud Storage Infrastructure Plan

## Status: Requirements Gathering

---

## Requirements

### Confirmed Requirements

1. **AI-optimized latency** - Batch read of 100 files in <3 seconds (~30ms/file amortized)
2. **Multi-device sync** - 30 second propagation acceptable. 5-10s polling for v1, streaming later.
3. **Autosave every 5 seconds** - Writes to intermediate storage, not git branches
4. **Full monorepo support** - All text/source files for AI code research. No binaries. 100MB initial sizing, must scale (cost concern only, not technical).
5. **10,000+ active users** - Architecture must scale
6. **Manual pull** - User-controlled sync from GitHub (already built)
7. **Offline support** - Local storage on edit exists, sync to cloud. Refine later.

---

## Research Findings

### Storage Options Evaluated

| Option | Description | Instant? | Multi-device? | AI Scale? | Cost (10K users) |
|--------|-------------|----------|---------------|-----------|------------------|
| **Ephemeral container** | Clone to container local disk | ❌ Clone on restart | ❌ Per-container | ❌ Per-container | Free |
| **EFS** | Shared network filesystem | ❌ Clone once | ✅ Shared | ⚠️ Slow for git | ~$15K/mo |
| **EBS Volumes** | Block storage per container | ❌ Clone once | ❌ Single-attach | ❌ Per-container | ~$40K/mo |
| **GitHub API only** | Read/write via REST API | ✅ Instant | ✅ Stateless | ❌ 5K req/hr limit | ~$0 |
| **S3 + Redis** | Files in S3, pending in Redis | ✅ Instant | ✅ Shared Redis | ✅ No limits | ~$5K/mo |
| **S3 + Database** | Files in S3, pending in Postgres | ✅ Instant | ✅ Shared DB | ✅ No limits | ~$5K/mo |
| **Database only** | Store file content in Postgres | ✅ Instant | ✅ Shared | ✅ No limits | ~$3K/mo |

### Key Research Insights

1. **EBS doesn't scale** - Volumes are single-attach. One volume per user = operational nightmare.

2. **EFS is slow for git** - AWS explicitly discourages EFS for git operations (per-operation network latency on thousands of small files).

3. **GitHub API has rate limits** - 5000 requests/hour per user. One AI query = 50-100 requests. Only ~50-100 AI interactions/hour possible.

4. **VFSForGit/Scalar won't work** - Requires GVFS protocol which GitHub doesn't support (only Azure DevOps).

5. **Partial clone still requires clone** - `git clone --filter=blob:none` is faster but not instant.

---

## Solution Categories

### Category A: Clone-Based (Traditional Git)

Clone the repository somewhere, run git commands on it.

**Options:**
- A1: Clone to EFS (shared across containers)
- A2: Clone to EBS (per-container)
- A3: Clone to container ephemeral storage

**Pros:** Full git functionality, familiar patterns
**Cons:** Clone delay, storage costs, sync complexity

### Category B: API-Based (No Local Clone)

Use GitHub's REST/GraphQL API for all operations.

**Options:**
- B1: GitHub API only (no local storage)
- B2: GitHub API + Redis cache
- B3: GitHub API + S3 cache

**Pros:** Instant access, no storage infrastructure
**Cons:** Rate limits, API latency, can't batch commits easily

### Category C: Hybrid (S3 + Async Git)

Store files in S3, run git operations asynchronously.

**Options:**
- C1: S3 files + Redis pending + async git worker
- C2: S3 files + Postgres pending + async git worker
- C3: S3 files + GitHub API for commits

**Pros:** Instant access, scalable, no rate limits
**Cons:** S3 must stay in sync with GitHub, async commits

### Category D: Database-Centric

Store everything in the database, treat git as external sync.

**Options:**
- D1: Postgres stores file content + pending changes
- D2: Postgres metadata + S3 content

**Pros:** Single source of truth, transactional, simple
**Cons:** Database size limits, not designed for file storage

---

## Comparison Matrix

| Requirement | A (Clone) | B (API) | C (S3 Hybrid) | D (Database) |
|-------------|-----------|---------|---------------|--------------|
| Instant file access | ❌ | ✅ | ✅ | ✅ |
| Multi-device sync | ⚠️ Complex | ✅ | ✅ | ✅ |
| Autosave (5s) | ✅ Local | ❌ Rate limits | ✅ | ✅ |
| AI/MCP scale | ❌ Per-clone | ❌ Rate limits | ✅ | ✅ |
| 10K+ users | ❌ Cost | ⚠️ Limits | ✅ | ✅ |
| Full git history | ✅ | ⚠️ API calls | ⚠️ On commit | ⚠️ On commit |
| Offline support | ✅ | ❌ | ❌ | ❌ |

---

## Open Questions for Discussion

1. **Which category makes most sense?**
   - Clone-based (A) gives full git but doesn't meet instant/scale requirements
   - API-based (B) is simple but hits rate limits
   - S3 Hybrid (C) meets all requirements but adds complexity
   - Database (D) is simplest but unconventional

2. **Where should pending changes live?**
   - Redis (fast, but data loss risk if Redis fails)
   - Postgres (durable, but adds queries)
   - Both (Redis as cache, Postgres as backup)

3. **How to keep S3/DB in sync with GitHub?**
   - Webhook from GitHub on push
   - Poll periodically
   - Sync on user access
   - Manual "pull" action

4. **What happens on commit conflict?**
   - Attempt merge
   - Create branch with user's changes
   - Force user to pull first

---

## Industry Research: How AI Coding Assistants Handle This

### Cursor
- Uses **Turbopuffer** (multi-tenant DB) to store encrypted files and Merkle trees
- Avoids storing full source code on servers
- Uses **git worktrees** to isolate parallel AI agents on different branches
- Pricing: Per-user + usage-based hybrid (~$20/month + token costs)

### GitHub Copilot
- **Local index** for projects <2,500 files
- **Remote index** for larger projects (uses GitHub's code search + RAG)
- Vector embeddings with Matryoshka Representation Learning
- Pricing: $10-39/user/month

### Sourcegraph Cody
- **Pre-indexes entire repository** with vector embeddings
- Handles 300,000+ repos and 90GB+ monorepos
- ~100,000 lines of related code per response
- Re-indexes regularly for freshness
- Pricing: $19-59/user/month

### Augment Code
- Processes **400,000-500,000 files simultaneously**
- 200k-token context window
- Supports 100M+ lines of code
- Uses approximate nearest neighbor (ANN) for fast semantic search
- Real-time millisecond-level sync with code changes

### Gitpod / CodeSandbox
- **Kubernetes pods** or **Firecracker microVMs** per workspace
- Persistent volumes (Longhorn) for storage
- Memory snapshotting for fast resume (500ms-2s boot)
- Pricing: Usage-based credits

### Key Patterns Identified

1. **Vector embeddings** - Most use embeddings for semantic search at scale
2. **Local + remote hybrid** - Small repos indexed locally, large repos use server
3. **No full clones for AI** - AI accesses indexed/embedded content, not raw git
4. **Workspace isolation** - Containers/VMs per user for editing, but shared indexes for reading

---

## Additional Research: GitHub API-Only Approach

### Key Finding: No Clone Needed for Git Operations

GitHub's Git Data API allows creating commits, branches, and PRs entirely via API calls - no filesystem clone required.

**Creating a commit (API only):**
1. `POST /repos/{owner}/{repo}/git/blobs` → Create blob for each changed file
2. `POST /repos/{owner}/{repo}/git/trees` → Create tree referencing blobs (use `base_tree` for efficiency)
3. `POST /repos/{owner}/{repo}/git/commits` → Create commit pointing to tree
4. `PATCH /repos/{owner}/{repo}/git/refs` → Update branch to new commit

**Creating a branch:**
```
POST /repos/{owner}/{repo}/git/refs
{ "ref": "refs/heads/feature-branch", "sha": "commit-sha" }
```

**Opening a PR:**
```
POST /repos/{owner}/{repo}/pulls
{ "title": "...", "head": "feature-branch", "base": "main" }
```

**Rate limits:**
- 5,000 requests/hour per user
- Content creation: ~80 requests/min or 500/hour
- Blob size: 100MB max

**Implication:** We can store file content anywhere (database, S3) and only use GitHub API for git operations.

---

## Category E: API-Only Git Operations (New)

Store file content in Postgres/S3. Use GitHub API for all git operations. No clone ever.

**Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│                         Postgres                            │
│                                                             │
│  files table:           pending_changes table:              │
│  - project_id           - project_id                        │
│  - path                  - user_id                          │
│  - content               - path                             │
│  - sha (from GitHub)     - content                          │
│  - synced_at             - created_at                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      GitHub API                             │
│                                                             │
│  On connect: GET /repos/.../git/trees (fetch all files)     │
│  On pull:    GET /repos/.../git/trees (refresh files)       │
│  On commit:  POST blobs → POST tree → POST commit → PATCH ref│
│  On PR:      POST /repos/.../pulls                          │
└─────────────────────────────────────────────────────────────┘
```

**Pros:**
- No filesystem storage needed (no EFS, EBS, S3)
- Postgres is durable (survives deploys)
- Fast reads from database
- Already have RDS Postgres
- Simple architecture

**Cons:**
- Database size: 100MB × 10K users = 1TB (manageable with Aurora)
- Must keep Postgres in sync with GitHub
- Initial fetch on connect (one-time)

---

## Pending Changes: Why Not Redis?

**Problem:** Redis is not durable. On deploy or restart, pending changes would be lost.

**Options for pending changes storage:**

| Option | Durability | Already Have | Writes/sec | Verdict |
|--------|------------|--------------|------------|---------|
| Redis | ❌ Lost on restart | ✅ Yes | ✅ Fast | ❌ No |
| Postgres | ✅ Durable | ✅ Aurora | ✅ Fine for 5s autosave | ✅ Yes |
| S3 | ✅ Durable | ✅ Yes | ⚠️ Not ideal for small frequent writes | ⚠️ Maybe |
| DynamoDB | ✅ Durable | ❌ New service | ✅ Fast | ⚠️ Overkill |

**Decision:** Use Postgres for pending changes. It's durable, we already have it, and 5-second autosave is well within its capabilities.

---

## Exotic Options Research

### Alternative Git Implementations

**libgit2 (C library with custom backends)**
- Reimplements Git core algorithms
- Pluggable backends: can swap filesystem for SQLite, Redis, MySQL, Postgres
- Used by GitHub Desktop, GitKraken
- Complexity: Medium-High (C bindings, implement backend 100-500 LOC)

**go-git (Pure Go)**
- Full Git reimplementation in Go
- Pluggable `Storer` interface - implement any backend
- Used by Gitpod, SourceGraph
- Complexity: Low-Medium
- **Could implement Postgres-backed storer**

**isomorphic-git (Pure JavaScript)**
- Works in browser, Node.js, WebWorkers
- ~200KB gzipped
- Good for browser-side git operations
- Complexity: Low
- **Good for editor UI layer**

### Git-Like Alternatives

**Dolt (SQL database with Git semantics)**
- Branch, merge, commit at table level
- Cell-level conflict detection
- Not mature for 10K+ users
- **Skip - too complex for our use case**

**Fossil SCM (SQLite-based VCS)**
- Entire repo in single SQLite file
- Built-in wiki, issue tracker
- Single-file bottleneck under load
- **Skip - doesn't scale to 10K users**

**lakeFS (Git for object storage)**
- Git-like versioning over S3/MinIO
- Branching, merging, atomic commits
- Used by Netflix, Arm, Microsoft
- Complexity: Medium
- **Viable for document storage if we use S3**

### Collaborative/Real-Time Approaches

**CRDTs (Automerge / Yjs)**
- Conflict-free replicated data types
- Automatic merge across distributed peers
- Character-level change tracking
- Automerge: preserves full history, supports branching
- Yjs: high-performance, real-time focused
- Used by Notion, Figma-like apps
- Complexity: High
- **Good for real-time collaboration layer on top of Git**

### Edge/Distributed Approaches

**LiteFS (Distributed SQLite)**
- FUSE-based, replicates SQLite across regions
- One primary (writes), many replicas (reads)
- Sub-millisecond sync within regions
- Created by Fly.io
- Complexity: Low
- **Good for read-heavy metadata (task manager)**

**Cloudflare Durable Objects**
- Stateful serverless at edge
- SQLite storage per object
- Strong consistency
- 10GB limit per object, expensive at scale
- **Skip - too expensive, vendor lock-in**

### Event Sourcing

**Store edits as immutable events, derive state by replay**
- Append-only event table
- Snapshots for performance
- Perfect for audit trails
- Frameworks: Marten (.NET), Emmett (Node.js)
- Complexity: Medium
- **Good supplement to Git for audit/compliance**

Example schema:
```sql
CREATE TABLE document_events (
  id SERIAL PRIMARY KEY,
  document_id UUID,
  type VARCHAR(50),  -- 'edited', 'commented', 'committed'
  user_id UUID,
  data JSONB,
  created_at TIMESTAMP
);
```

### Content-Addressable Storage / IPFS

- Store by content hash (like Git internals)
- IPFS: public P2P, no ACL
- **Skip - not suitable for private data**

---

## Updated Solution Categories

### Category F: go-git with Postgres Backend (New)

Use go-git library with custom Postgres-backed `Storer`. Git objects stored in database.

**Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│                         Postgres                            │
│                                                             │
│  git_objects table:     git_refs table:                     │
│  - hash (PRIMARY KEY)   - name (e.g., refs/heads/main)      │
│  - type (blob/tree/     - hash                              │
│    commit/tag)          - project_id                        │
│  - data (bytea)                                             │
│  - project_id           pending_changes table:              │
│                         - (as before)                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    go-git with custom Storer
                              │
                              ▼
                    Full Git operations locally
                    (no GitHub API for commits)
```

**Pros:**
- Full Git compatibility (can export/import standard repos)
- All data in Postgres (durable, queryable)
- No GitHub API rate limits for operations
- Can run git log, diff, blame, etc. locally

**Cons:**
- Need to implement Postgres storer (medium effort)
- Sync with GitHub still needed (push/pull)
- go-git is Go, our API is Node.js (need bridge or rewrite)

### Category G: lakeFS over S3 (New)

Use lakeFS for Git-like versioning of documents stored in S3.

**Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│                           S3                                │
│                                                             │
│  s3://bucket/repos/{project_id}/files/...                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                         lakeFS                              │
│                                                             │
│  Branches, commits, merges over S3 objects                  │
│  Metadata in local database                                 │
│  Atomic commits across files                                │
└─────────────────────────────────────────────────────────────┘
```

**Pros:**
- S3 scales infinitely
- Git-like semantics without Git complexity
- Used by Netflix, Arm, Microsoft at scale

**Cons:**
- Another service to run
- Not Git-compatible (can't push to GitHub directly)
- Need bridge layer for GitHub sync

### Category H: Hybrid with CRDT Layer (New)

Git for persistence + Automerge for real-time collaboration.

**Architecture:**
```
User edits (real-time)
        │
        ▼
┌───────────────────┐
│    Automerge      │  ← Real-time sync, no conflicts
│  (CRDT document)  │
└─────────┬─────────┘
          │ Periodic snapshot
          ▼
┌───────────────────┐
│       Git         │  ← Permanent history
│   (via go-git     │
│    or API)        │
└───────────────────┘
```

**Pros:**
- Real-time collaboration (Google Docs-like)
- No merge conflicts during editing
- Git history preserved

**Cons:**
- High complexity
- Two systems to maintain
- Automerge storage overhead

---

## Comparison Matrix (Updated)

| Category | Git Compatible | Instant Access | 10K Users | AI Batch Reads | Complexity | Notes |
|----------|----------------|----------------|-----------|----------------|------------|-------|
| A: Clone-based | ✅ Full | ❌ Clone delay | ❌ Storage cost | ❌ Per-clone | Low | Traditional |
| B: GitHub API only | ✅ Full | ✅ Yes | ❌ Rate limits | ❌ Rate limits | Low | Simple but limited |
| C: S3 + async git | ⚠️ Sync needed | ✅ Yes | ✅ Yes | ✅ Yes | Medium | Viable |
| D: Postgres only | ⚠️ Sync needed | ✅ Yes | ✅ Yes | ✅ Yes | Low | Simple |
| E: Postgres + GitHub API | ✅ Full | ✅ Yes | ✅ Yes | ✅ Yes | Medium | **Strong option** |
| F: go-git + Postgres | ✅ Full | ✅ Yes | ✅ Yes | ✅ Yes | Medium-High | **Full git locally** |
| G: lakeFS + S3 | ⚠️ Git-like | ✅ Yes | ✅ Yes | ✅ Yes | Medium | S3 native |
| H: CRDT + Git | ✅ Full | ✅ Yes | ✅ Yes | ✅ Yes | High | Real-time collab |

---

## Reframing: It's Not About Git

### Key Insight

Git is just the **sync target**. We can commit via API. The real questions are:

1. **File storage** - Where do we store file content?
2. **Change tracking** - How do we track uncommitted edits?
3. **Queryability** - How does AI batch-read 100 files fast?

### The Actual Problem

```
┌─────────────────────────────────────────────────────────────┐
│                    STORAGE LAYER                            │
│                                                             │
│   Store files + pending changes                             │
│   Support fast batch reads (AI)                             │
│   Support fast writes (autosave every 5s)                   │
│   Durable (survives deploys)                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    GITHUB SYNC                              │
│                                                             │
│   On pull: Fetch files from GitHub → store                  │
│   On commit: Read changes → GitHub API (blobs→tree→commit)  │
└─────────────────────────────────────────────────────────────┘
```

### Storage Options (Simplified)

| Option | Fast Reads | Fast Writes | Queryable | Already Have | Scale |
|--------|------------|-------------|-----------|--------------|-------|
| **Postgres** | ✅ Yes | ✅ Yes | ✅ SQL | ✅ Aurora | ⚠️ 1TB+ |
| **S3** | ✅ Yes (parallel) | ⚠️ Not ideal for small writes | ❌ List only | ✅ Yes | ✅ Unlimited |
| **Postgres + S3** | ✅ Yes | ✅ Yes | ✅ Metadata | ✅ Yes | ✅ Best of both |
| **SQLite (embedded)** | ✅ Very fast | ✅ Yes | ✅ SQL | ❌ New | ⚠️ Single file |

### Simplest Solution: Postgres Only

**Schema:**
```sql
-- Committed files (synced from GitHub)
CREATE TABLE files (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  path TEXT NOT NULL,
  content TEXT,
  sha TEXT,  -- GitHub blob SHA
  synced_at TIMESTAMP,
  UNIQUE(project_id, path)
);

-- Uncommitted changes (user edits)
CREATE TABLE pending_changes (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  user_id UUID REFERENCES users(id),
  path TEXT NOT NULL,
  content TEXT,
  action TEXT,  -- 'modified', 'created', 'deleted'
  updated_at TIMESTAMP,
  UNIQUE(project_id, user_id, path)
);

-- Indexes for AI batch reads
CREATE INDEX idx_files_project ON files(project_id);
CREATE INDEX idx_pending_project_user ON pending_changes(project_id, user_id);
```

**Operations:**
- **Read file:** `SELECT content FROM files WHERE project_id = ? AND path = ?`
- **Read 100 files:** `SELECT path, content FROM files WHERE project_id = ? AND path = ANY(?)`
- **Write (autosave):** `UPSERT INTO pending_changes ...`
- **Commit:** Read pending_changes → GitHub API → clear pending_changes → update files
- **Pull:** Fetch from GitHub → UPSERT files → optionally warn about conflicts

**Performance:**
- 100 files × ~10KB each = 1MB
- Postgres can return 1MB in <100ms easily
- Batch reads are just `WHERE path IN (...)`

### When to Add S3

Add S3 only if:
- Files get very large (>1MB each)
- Total storage exceeds comfortable Postgres size (~100GB+)
- Need CDN delivery to users

For now, **Postgres alone is probably sufficient**.

---

## Deep Dive: File Storage Options

### Industry Research: What Do They Use?

| Company | Pattern | Scale |
|---------|---------|-------|
| **Replit** | btrfs → Margarine → GCS | 300M repos, petabytes |
| **Google Docs** | Spanner (metadata) + Colossus (files) | 1.8B users |
| **Notion** | Postgres (metadata) + S3 + Kafka | 200B blocks |
| **Figma** | RDS sharded (metadata) + dedicated servers | 20M+ files |
| **CodeSandbox** | Persistent VMs + git snapshots | 10M+ sandboxes |

**Pattern: Metadata in database, files in object storage.**

### Option Analysis

**1. Postgres TEXT/BYTEA columns**
- Works but not optimal
- TOAST compression helps (up to 98%)
- At 1TB scale, Aurora needs expensive tiers
- Storage cost: ~$0.10/GB/month = $100/month per TB
- Verdict: **Fine for MVP, may need to migrate later**

**2. MongoDB / CouchDB**
- GridFS chunks files into 255KB pieces
- No major code editor uses this
- Still not cheaper than S3
- Verdict: **Skip - no advantage over S3**

**3. S3 + Postgres metadata** ✅
- Purpose-built for files
- Storage cost: ~$0.023/GB/month = $23/month per TB (4x cheaper)
- 11 nines durability
- Parallel reads for batch access
- Verdict: **Industry standard, recommended**

**4. DynamoDB**
- 400KB item size limit (blocker for files)
- Good for metadata only
- Verdict: **Skip for file content**

**5. SQLite / Turso / LiteFS**
- 1 writer, limited concurrency
- 10K users × 1 write/5s = 2K writes/sec (too much)
- Verdict: **Wrong direction - scales down, not up**

**6. Content-Addressable Storage (hash-based)**
- Natural deduplication
- Replit uses this (btrfs snapshots)
- Adds complexity
- Verdict: **Overkill unless massive duplication**

**7. CockroachDB / TiDB**
- Good for distributed metadata
- Still has size limits for BYTEA
- Verdict: **Metadata only, not files**

### Cost Comparison at 1TB

| Option | Storage Cost | Notes |
|--------|--------------|-------|
| Aurora Postgres | ~$100/month | Plus compute for large queries |
| S3 Standard | ~$23/month | Plus ~$50-100 request costs |
| DynamoDB | ~$250/month | Plus read/write capacity |
| MongoDB Atlas | ~$150/month | Plus compute |

### Recommendation: S3 + Postgres

**Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│                           S3                                │
│                                                             │
│  s3://bucket/{project_id}/files/{path}                      │
│  - File content (text)                                      │
│  - Versioned (S3 versioning)                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Aurora Postgres                        │
│                                                             │
│  files table:                                               │
│  - project_id, path (key)                                   │
│  - s3_key (pointer)                                         │
│  - size_bytes, content_hash                                 │
│  - synced_at                                                │
│                                                             │
│  pending_changes table:                                     │
│  - project_id, user_id, path                                │
│  - content (TEXT - stored here, small)                      │
│  - OR s3_key (if large)                                     │
│  - action, updated_at                                       │
│                                                             │
│  For AI search:                                             │
│  - full_text_index (tsvector)                               │
│  - content_vector (pgvector for embeddings)                 │
└─────────────────────────────────────────────────────────────┘
```

**Why this works:**
- S3 for bulk storage (cheap, durable, scalable)
- Postgres for metadata + search (already have it)
- Pending changes can stay in Postgres (small, frequent writes)
- AI search via pgvector + tsvector

**Operations:**
- Read file: Postgres lookup → S3 GET (or Redis cache)
- Batch read 100 files: Parallel S3 GETs (~2-4 seconds)
- Autosave: UPSERT pending_changes (in Postgres, small)
- Commit: Read pending → GitHub API → S3 upload → update Postgres
- Pull: GitHub API → S3 upload → update Postgres

### Alternative: Postgres Only (Simpler MVP)

If we want to start simpler:
- Store content in Postgres TEXT column
- Migrate to S3 later when hitting scale limits
- Works fine up to ~100GB

**Trade-off:** Faster to build now, may need migration later.

---

## Final Recommendation

### Decision: S3 + Postgres Metadata (Category C/E Hybrid)

Based on the research:

| Factor | Decision |
|--------|----------|
| **File content storage** | S3 (4x cheaper than Postgres at scale, purpose-built) |
| **Metadata + search** | Postgres (already have RDS, good for queries) |
| **Pending changes** | Postgres (durable, frequent small writes OK) |
| **Git operations** | GitHub API only (no local clone needed) |

**Why not Postgres-only?**
- Works for MVP but costs 4x more at scale
- Would require migration later anyway
- S3 adds minimal complexity upfront

**Why not exotic options (go-git, lakeFS, CRDTs)?**
- go-git requires Go runtime (our API is Node.js)
- lakeFS is another service to manage
- CRDTs are overkill without real-time collaboration

---

## Pre-Implementation: Fix Documentation

The docs incorrectly say "Aurora" when we have RDS PostgreSQL. Fix these files:

| File | Change |
|------|--------|
| `CLAUDE.md:16` | "Aurora Postgres" → "RDS Postgres" |
| `docs/tech-stack.md:42` | "Aurora Serverless v2" → "RDS PostgreSQL" |
| `docs/tech-stack.md:322` | Update Aurora section to RDS |
| `docs/tech-stack.md:384` | Update decision table |
| `docs/status.md:276` | "Aurora Postgres" → "RDS Postgres" |
| `docs/specs/mcp-integration.md:64` | "Aurora" → "RDS" in diagram |
| `.claude/plans/tech-stack-documentation.md:33` | "Aurora Serverless v2" → "RDS PostgreSQL" |

**Actual infrastructure (verified via AWS API):**
- `db.t4g.micro` RDS PostgreSQL 16.10
- 20GB storage, single-AZ
- ~$12-15/month

---

## Implementation Plan

### Architecture: Storage Service = Dumb Storage

**Key Insight:** File service is just a custom filesystem. It doesn't know about GitHub.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Clients                                      │
│              (Web App, Desktop App, MCP Server)                      │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Main API                                      │
│                                                                      │
│  SMART LAYER - handles all business logic:                           │
│  • GitHub OAuth & token management (existing)                        │
│  • Fetch from GitHub → store in storage service                         │
│  • Read from storage service → commit to GitHub                         │
│  • User auth, project ownership, permissions                         │
│                                                                      │
│  DB: app-db (users, projects, github_connections)                    │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ Internal calls
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Storage Service (NEW) - DUMB STORAGE                 │
│                                                                      │
│  Just a filesystem API. No GitHub knowledge. No user auth.           │
│                                                                      │
│  PUT    /files/:projectId/*path        # Store content               │
│  GET    /files/:projectId/*path        # Retrieve content            │
│  GET    /files/:projectId              # List files                  │
│  DELETE /files/:projectId/*path        # Delete file                 │
│                                                                      │
│  PUT    /pending/:projectId/:userId/*path   # Store pending change   │
│  GET    /pending/:projectId/:userId         # List pending changes   │
│  DELETE /pending/:projectId/:userId/*path   # Clear pending change   │
│  DELETE /pending/:projectId/:userId         # Clear all pending      │
│                                                                      │
│  DB: file-db (file metadata only)                                    │
│  Storage: S3 (file content)                                          │
└─────────────────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
┌──────────────────┐              ┌────────────┐
│   file-db (RDS)  │              │     S3     │
│                  │              │            │
│  project_files   │              │  /files/   │
│  pending_changes │              │  /pending/ │
└──────────────────┘              └────────────┘
```

**Main API orchestrates GitHub sync:**
```
POST /api/projects/:id/sync    → Main API fetches GitHub trees/blobs
                               → Main API calls storage service to store each file

POST /api/projects/:id/commit  → Main API reads pending from storage service
                               → Main API creates GitHub commit (blobs→tree→commit)
                               → Main API clears pending in storage service
```

---

### Security Architecture

**Service-to-Service Authentication:**
File service is internal-only (no public ALB exposure).

```typescript
// Main API → Storage Service request
fetch('http://storage.internal:3001/files/...', {
  headers: {
    'X-Internal-API-Key': process.env.STORAGE_SERVICE_API_KEY,
  }
});

// Storage Service validates (simple middleware)
if (context.req.header('X-Internal-API-Key') !== process.env.STORAGE_SERVICE_API_KEY) {
  return context.json({ error: 'Unauthorized' }, 401);
}
```

- No user auth in storage service (main API already validated)
- No GitHub tokens needed (main API handles GitHub)
- Just project isolation via projectId in path

**Path Traversal Protection:**
Reuse existing `validatePath()` from `api/src/handlers/storage/utils.ts`:
- Normalizes path (removes `..`, `//`, etc.)
- Validates path stays within project boundary

**Rate Limiting (in Main API, not storage service):**
- File reads: 100 req/min per user
- File writes: 20 req/min per user
- GitHub sync: 10 req/min per project

### Storage Service Database (Separate RDS Instance)

```sql
-- File metadata (synced from GitHub)
CREATE TABLE project_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,  -- References main DB, but no FK
  path TEXT NOT NULL,
  s3_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,  -- GitHub blob SHA
  size_bytes INTEGER NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(project_id, path)
);

CREATE INDEX idx_project_files_project ON project_files(project_id);

-- Uncommitted user changes (durable)
CREATE TABLE pending_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  user_id UUID NOT NULL,
  path TEXT NOT NULL,
  content TEXT,              -- Inline if <100KB
  s3_key TEXT,               -- S3 key if >100KB
  action TEXT NOT NULL CHECK (action IN ('modified', 'created', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(project_id, user_id, path)
);

CREATE INDEX idx_pending_changes_project_user ON pending_changes(project_id, user_id);
```

**Note:** No foreign keys to main DB (cross-database). project_id/user_id are UUIDs that reference main DB but enforced at application level.

### Data Flow

**1. Sync from GitHub (Pull)**
```
Main API:
  → GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=true
  → For each .md/.mdx file:
      → GET /repos/{owner}/{repo}/git/blobs/{sha}
      → PUT http://storage.internal/files/{projectId}/{path}
          (storage service stores in S3 + records in project_files)
```

**2. Read File (User or AI)**
```
Main API:
  → GET http://storage.internal/pending/{projectId}/{userId}/{path}
      (check for uncommitted edit first)
  → If no pending: GET http://storage.internal/files/{projectId}/{path}
      (storage service reads from S3)
```

**3. Autosave (Every 5s)**
```
Main API:
  → PUT http://storage.internal/pending/{projectId}/{userId}/{path}
      (storage service stores in Postgres, or S3 if >100KB)
```

**4. Commit to GitHub**
```
Main API:
  → GET http://storage.internal/pending/{projectId}/{userId}
      (list all pending changes)
  → For each change:
      → POST /repos/{owner}/{repo}/git/blobs (create blob)
  → POST /repos/{owner}/{repo}/git/trees (with base_tree)
  → POST /repos/{owner}/{repo}/git/commits
  → PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}
  → PUT http://storage.internal/files/{projectId}/{path}
      (update committed files)
  → DELETE http://storage.internal/pending/{projectId}/{userId}
      (clear pending changes)
```

**5. Manual Pull (Refresh)**
```
Main API:
  → Same as #1, but compare SHAs first
  → Warn if pending_changes exist for changed files
```

### S3 Structure

```
s3://doc-platform-files/
  └── {projectId}/
      └── files/
          └── {path}          # e.g., docs/getting-started.md
      └── pending/
          └── {userId}/
              └── {path}      # Large pending changes (>100KB)
```

### Storage Service Implementation

**New package:** `storage/` (sibling to `api/`)

Uses **Hono** to match existing API architecture. Very simple - just storage operations.

```
storage/
  ├── package.json              # hono, @hono/node-server, @aws-sdk/client-s3, pg
  ├── Dockerfile
  ├── src/
  │   ├── index.ts              # Hono server (matches api/ pattern)
  │   ├── middleware/
  │   │   └── auth.ts           # X-Internal-API-Key validation
  │   ├── handlers/
  │   │   ├── files.ts          # GET/PUT/DELETE /files/:projectId/*
  │   │   └── pending.ts        # GET/PUT/DELETE /pending/:projectId/:userId/*
  │   ├── services/
  │   │   └── s3.ts             # S3 read/write operations
  │   └── db/
  │       ├── index.ts          # Postgres pool (reuse @doc-platform/db patterns)
  │       ├── queries.ts        # Raw SQL queries for files/pending
  │       └── migrations/       # Schema (project_files, pending_changes)
  └── tests/
```

**~200 lines of handler code total** - it's just CRUD on S3 + Postgres.

**Main API changes:**
- Add `StorageClient` class to call storage service internally
- Add GitHub sync handlers that orchestrate: GitHub API ↔ Storage Service
- Keep `LocalStorageProvider` for desktop/local mode (unchanged)

### Infrastructure (CDK)

```typescript
// ─────────────────────────────────────────────────────────────────
// Storage Service Database (separate from main app DB)
// ─────────────────────────────────────────────────────────────────
const fileDbCredentials = new secretsmanager.Secret(this, 'FileDbCredentials', {
  generateSecretString: {
    secretStringTemplate: JSON.stringify({ username: 'postgres' }),
    generateStringKey: 'password',
    excludePunctuation: true,
  },
});

const fileDatabase = new rds.DatabaseInstance(this, 'FileDatabase', {
  engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
  vpc,
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  credentials: rds.Credentials.fromSecret(fileDbCredentials),
  databaseName: 'storage',
  allocatedStorage: 20,
  maxAllocatedStorage: 100,
});

// ─────────────────────────────────────────────────────────────────
// S3 Bucket for file content
// ─────────────────────────────────────────────────────────────────
const filesBucket = new s3.Bucket(this, 'FilesBucket', {
  versioned: true,
  encryption: s3.BucketEncryption.S3_MANAGED,
  lifecycleRules: [{
    noncurrentVersionExpiration: Duration.days(30),
  }],
});

// ─────────────────────────────────────────────────────────────────
// Storage Service (ECS Fargate)
// ─────────────────────────────────────────────────────────────────
const fileService = new ecs.FargateService(this, 'FileService', {
  cluster,
  taskDefinition: fileServiceTaskDef,
  desiredCount: 1,
  // Internal only - not exposed to public ALB
});

// Service discovery for internal communication
const fileServiceNamespace = new servicediscovery.PrivateDnsNamespace(this, 'FileServiceNamespace', {
  name: 'internal',
  vpc,
});

fileService.enableCloudMap({
  name: 'storage',
  dnsRecordType: servicediscovery.DnsRecordType.A,
  cloudMapNamespace: fileServiceNamespace,
});

// Main API calls storage service at: http://storage.internal:3001
```

### Implementation Order

1. **Fix docs** - Aurora → RDS in all documentation (7 files)

2. **Infrastructure (CDK)**
   - Add file-db (separate RDS instance)
   - Add S3 bucket with versioning
   - Add storage ECS task definition
   - Add CloudMap service discovery
   - Add STORAGE_SERVICE_API_KEY secret

3. **Storage Service package** (new `storage/` directory)
   - Hono server scaffold (copy patterns from api/)
   - X-Internal-API-Key middleware
   - Postgres connection pool
   - S3 client initialization
   - Database migrations

4. **Storage Service endpoints** (~200 LOC)
   - `GET/PUT/DELETE /files/:projectId/*path`
   - `GET/PUT/DELETE /pending/:projectId/:userId/*path`
   - Health check endpoint

5. **Main API: StorageClient**
   - HTTP client for internal storage service calls
   - Methods: `getFile()`, `putFile()`, `listFiles()`, `getPending()`, etc.

6. **Main API: GitHub sync handlers**
   - `POST /api/projects/:id/sync` - fetch GitHub → store in storage service
   - `POST /api/projects/:id/commit` - read storage service → commit to GitHub
   - Uses existing GitHub token encryption from `@doc-platform/auth`

7. **Testing**
   - File service unit tests
   - Integration tests for sync/commit flow
   - Manual verification with real GitHub repo

### Verification

1. **Connect repository** - Select repo, verify files appear in S3 and Postgres
2. **Read files** - Open file in editor, verify content loads
3. **Autosave** - Edit file, verify pending_changes updated every 5s
4. **AI batch read** - Query 100 files, verify <3s response
5. **Commit** - Commit changes, verify GitHub shows new commit
6. **Pull** - Make change on GitHub, pull, verify local updates
7. **Multi-device** - Edit on device A, verify device B sees pending change

---

## Cost Estimate

### Staging (Current + New)

| Resource | Description | Monthly Cost |
|----------|-------------|--------------|
| **Existing** | | |
| Main API (ECS) | Fargate 0.25 vCPU, 0.5GB | ~$9 |
| App DB (RDS) | t4g.micro PostgreSQL | ~$12 |
| Redis | cache.t4g.micro | ~$12 |
| **New (Storage Service)** | | |
| Storage Service (ECS) | Fargate 0.25 vCPU, 0.5GB | ~$9 |
| File DB (RDS) | t4g.micro PostgreSQL | ~$12 |
| S3 Storage | ~10GB initially | ~$0.25 |
| S3 Requests | ~100K/month | ~$0.05 |
| Service Discovery | Cloud Map namespace | ~$1 |
| **Total Staging** | | **~$55/month** |

### At Scale (10K Users)

| Resource | Calculation | Monthly Cost |
|----------|-------------|--------------|
| S3 Storage | 10K × 100MB | ~$23 |
| S3 Requests | ~10M reads | ~$4 |
| File DB (RDS) | t4g.small or medium | ~$25-50 |
| Storage Service (ECS) | Scale as needed | ~$20-50 |
| **Storage Service Total** | | **~$75-125/month** |

Still much cheaper than EFS (~$15K/month) or EBS (~$40K/month).

---

## Out of Scope (Future)

- Real-time collaboration (CRDTs)
- Vector embeddings for AI search (pgvector)
- File content caching (Redis)
- Conflict resolution UI
- Branch support (beyond main)
- Binary file support
