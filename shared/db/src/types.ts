/**
 * Database entity types
 * These must match the schema defined in migrations
 */

/**
 * Known user roles. New roles can be added as needed.
 * - admin: Full system administration access
 * Future roles might include: moderator, editor, viewer, etc.
 */
export type UserRole = 'admin';

export interface User {
	id: string;
	/** NULL until claimed during onboarding (email-only signup) */
	username: string | null;
	first_name: string | null;
	last_name: string | null;
	email: string;
	email_verified: boolean;
	email_verified_at: Date | null;
	phone_number: string | null;
	avatar_url: string | null;
	roles: string[];
	is_active: boolean;
	deactivated_at: Date | null;
	signup_metadata: SignupMetadata;
	created_at: Date;
	updated_at: Date;
}

/**
 * Typed structure for signup metadata.
 * Used when building the metadata object at signup time.
 * The DB column is JSONB so it can hold additional fields beyond these.
 */
export interface SignupMetadata {
	invite_key?: string;
	referral_source?: string;
	utm_source?: string;
	utm_medium?: string;
	utm_campaign?: string;
	utm_term?: string;
	utm_content?: string;
	[key: string]: unknown;
}

export interface UserPassword {
	user_id: string;
	password_hash: string;
	created_at: Date;
	updated_at: Date;
}

export interface EmailVerificationToken {
	id: string;
	user_id: string;
	email: string;
	token_hash: string;
	expires_at: Date;
	created_at: Date;
}

export interface PasswordResetToken {
	id: string;
	user_id: string;
	token_hash: string;
	expires_at: Date;
	created_at: Date;
}

export interface GitHubConnection {
	id: string;
	user_id: string;
	github_user_id: string;
	github_username: string;
	access_token: string; // Encrypted
	refresh_token: string | null; // Encrypted
	token_expires_at: Date | null;
	scopes: string[];
	connected_at: Date;
}

export interface McpToken {
	id: string;
	user_id: string;
	client_id: string;
	access_token_hash: string;
	refresh_token_hash: string | null;
	scopes: string[];
	expires_at: Date;
	access_token_expires_at: Date;
	created_at: Date;
}

export interface OAuthCode {
	code: string;
	user_id: string;
	client_id: string;
	code_challenge: string;
	code_challenge_method: string;
	scopes: string[];
	redirect_uri: string;
	expires_at: Date;
}

/**
 * Planning entity types
 */

export type StorageMode = 'none' | 'local' | 'cloud';

export interface RepositoryConfigLocal {
	type: 'local';
	localPath: string;
	branch: string;
}

export interface RepositoryConfigCloud {
	type: 'cloud';
	remote: {
		provider: 'github';
		owner: string;
		repo: string;
		url: string;
	};
	branch: string;
}

export type RepositoryConfig = RepositoryConfigLocal | RepositoryConfigCloud;

/**
 * Type guard for local repository config
 */
export function isLocalRepository(repo: RepositoryConfig | Record<string, never>): repo is RepositoryConfigLocal {
	return 'type' in repo && repo.type === 'local';
}

/**
 * Type guard for cloud repository config
 */
export function isCloudRepository(repo: RepositoryConfig | Record<string, never>): repo is RepositoryConfigCloud {
	return 'type' in repo && repo.type === 'cloud';
}

export type SyncStatus = 'pending' | 'syncing' | 'completed' | 'failed';

export interface Project {
	id: string;
	/** URL identifier, unique per owner (e.g. "specboard"). */
	slug: string;
	/** Short uppercase prefix for item keys, unique per owner (e.g. "SB"). */
	key: string;
	/** Allocator for per-project item numbers; the last number handed out. */
	item_seq: number;
	name: string;
	description: string | null;
	owner_id: string;
	storage_mode: StorageMode;
	repository: RepositoryConfig | Record<string, never>;
	root_paths: string[];
	system_prompt: string | null;
	last_synced_commit_sha: string | null;
	sync_status: SyncStatus | null;
	sync_started_at: Date | null;
	sync_completed_at: Date | null;
	sync_error: string | null;
	created_at: Date;
	updated_at: Date;
}

// A single status enum across all item types. Tasks/bugs use ready/in_progress/blocked/done;
// epics additionally use in_review. The service layer validates which values apply per type.
export type ItemStatus = 'ready' | 'in_progress' | 'blocked' | 'in_review' | 'done';
export type ItemType = 'epic' | 'task' | 'bug';
export type SubStatus = 'not_started' | 'scoping' | 'in_development' | 'paused' | 'needs_input' | 'pr_open' | 'complete';
export type SpecType = 'product' | 'technical';

/**
 * Actor — who or what performed an action. Stored as JSONB (items.origin.actor,
 * item_blockers.created_by/cleared_by, item_workers.actor). Always constructed
 * server-side from the authenticated context, never accepted from a client
 * payload; an event record, so it deliberately holds snapshots, not FKs.
 */
export interface UserActor {
	type: 'user';
	userId: string;
}

export interface AgentActor {
	type: 'agent';
	/** The human whose OAuth token the agent holds. */
	userId: string;
	/** OAuth client id (mcp_tokens.client_id). */
	clientId: string;
	/** User-chosen device name from OAuth consent (mcp_tokens.device_name). */
	deviceName?: string;
	/** MCP transport session UUID. */
	sessionId?: string;
	/** MCP protocol clientInfo from initialize. */
	client?: { name: string; version?: string };
}

export interface SystemActor {
	type: 'system';
	/** What triggered the action, e.g. 'blocking_item_done'. */
	cause: string;
}

export type Actor = UserActor | AgentActor | SystemActor;

export function isUserActor(actor: Actor): actor is UserActor {
	return actor.type === 'user';
}

export function isAgentActor(actor: Actor): actor is AgentActor {
	return actor.type === 'agent';
}

/**
 * Immutable creation provenance (items.origin). discoveredFrom is a snapshot of
 * the item being worked when this one was filed — not an FK, so it survives
 * deletion of the source. NULL column = predates tracking.
 */
export interface ItemOrigin {
	actor: Actor;
	discoveredFrom?: { itemId: string; itemKey: string };
}

// One unified item. `parent_id` is null for top-level items; an epic is an optional container,
// and tasks/bugs may be nested under a parent or stand alone.
export interface Item {
	id: string;
	project_id: string | null;
	/**
	 * Per-project sequence number. Combined with the project's key it forms the
	 * item's address (`SB-345`). Null only for items with no project.
	 */
	number: number | null;
	parent_id: string | null;
	type: ItemType;
	title: string;
	description: string | null;
	status: ItemStatus;
	sub_status: SubStatus | null;
	origin: ItemOrigin | null;
	assignee: string | null;
	rank: number;
	due_date: Date | null;
	pr_url: string | null;
	branch_name: string | null;
	notes: string | null;
	note: string | null;
	created_at: Date;
	updated_at: Date;
}

export interface ItemSpec {
	id: string;
	item_id: string;
	project_id: string;
	path: string;
	spec_type: SpecType;
	created_at: Date;
}

// One blocker on an item: another item (FK) XOR free text. Cleared rows are
// tombstones; an item is blocked while any row has cleared_at NULL (or its
// status is 'blocked' — the separate manual hold).
export interface ItemBlocker {
	id: string;
	item_id: string;
	project_id: string;
	blocker_item_id: string | null;
	blocker_text: string | null;
	created_by: Actor | null;
	created_at: Date;
	cleared_at: Date | null;
	cleared_by: Actor | null;
}

// One observed agent-session episode on an item. actor always carries sessionId
// here (it keys the active-episode unique index).
export interface ItemWorker {
	id: string;
	item_id: string;
	project_id: string;
	actor: AgentActor;
	branch: string | null;
	started_at: Date;
	last_seen_at: Date;
	ended_at: Date | null;
}

export interface ProgressNote {
	id: string;
	item_id: string;
	note: string;
	created_by: string;
	created_at: Date;
}

/**
 * User API key providers
 */
export type ApiKeyProvider = 'anthropic' | 'gemini';

/**
 * User API key for external services
 */
export interface UserApiKey {
	id: string;
	user_id: string;
	provider: ApiKeyProvider;
	key_name: string;
	encrypted_key: string;
	iv: string;
	auth_tag: string;
	masked_key: string;
	last_used_at: Date | null;
	created_at: Date;
	updated_at: Date;
}
