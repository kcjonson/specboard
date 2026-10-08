/**
 * Project service - shared business logic for projects
 */

import {
	slugifyProjectName,
	deriveProjectKey,
	withSuffix,
} from '@specboard/core/identifiers';
import { query, transaction } from '../index.ts';
import { getUserSlug, USER_DISPLAY_NAME_SQL } from './users.ts';
import {
	type Project,
	type StorageMode,
	type RepositoryConfig,
	type RepositoryConfigCloud,
	type SyncStatus,
	isLocalRepository,
} from '../types.ts';

/** Postgres unique-violation SQLSTATE, raised when a slug or key is already taken. */
const UNIQUE_VIOLATION = '23505';

/** How many suffixed candidates to try before giving up on a free slug/key. */
const MAX_IDENTIFIER_ATTEMPTS = 50;

// Maximum number of root paths per project to prevent abuse
const MAX_ROOT_PATHS = 20;

// ─────────────────────────────────────────────────────────────────────────────
// Response types (camelCase for API/MCP responses)
// ─────────────────────────────────────────────────────────────────────────────

export interface ProjectResponse {
	id: string;
	/** URL identifier, unique per owner (e.g. "roadmap"). */
	slug: string;
	/** The owner's user slug, the other half of the project's address (acme/roadmap). */
	ownerSlug: string;
	/** The owner's display name, so a member's view can say whose project it is. */
	ownerName: string;
	/** Short uppercase prefix for this project's item keys (e.g. "SB"). */
	key: string;
	name: string;
	description: string | null;
	storageMode: StorageMode;
	repository: RepositoryConfig | Record<string, never>;
	rootPaths: string[];
	systemPrompt: string | null;
	syncStatus: SyncStatus | null;
	syncError: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface ItemCounts {
	ready: number;
	in_progress: number;
	in_review: number;
	done: number;
}

export interface ProjectWithStats extends ProjectResponse {
	itemCount: number;
	itemCounts: ItemCounts;
	/** The caller's role as granted: owner for their own projects, else their membership's. */
	grantedRole: ProjectRole;
	/** The role access checks use (a granted editor without GitHub works as a viewer). */
	effectiveRole: ProjectRole;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────────────────────

/** A projects row plus its owner's slug and name, which every query that returns a project joins in. */
interface ProjectRow extends Project {
	owner_slug: string;
	owner_name: string;
}

/** Select list and join for reads that return a ProjectResponse. */
const PROJECT_SELECT = `SELECT p.*, u.slug AS owner_slug, ${USER_DISPLAY_NAME_SQL} AS owner_name
	FROM projects p JOIN users u ON u.id = p.owner_id`;

/** RETURNING clause for writes that return a ProjectResponse. */
const PROJECT_RETURNING = `RETURNING *,
	(SELECT u.slug FROM users u WHERE u.id = projects.owner_id) AS owner_slug,
	(SELECT ${USER_DISPLAY_NAME_SQL} FROM users u WHERE u.id = projects.owner_id) AS owner_name`;

function transformProject(project: ProjectRow): ProjectResponse {
	return {
		id: project.id,
		slug: project.slug,
		ownerSlug: project.owner_slug,
		ownerName: project.owner_name,
		key: project.key,
		name: project.name,
		description: project.description,
		storageMode: project.storage_mode,
		repository: project.repository,
		rootPaths: project.root_paths,
		systemPrompt: project.system_prompt,
		syncStatus: project.sync_status,
		syncError: project.sync_error,
		createdAt: project.created_at,
		updatedAt: project.updated_at,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Service functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The identity a request needs once its project address has been resolved: the
 * internal primary key for every downstream query, the key that prefixes item keys,
 * and both halves of the address.
 */
export interface ResolvedProject {
	id: string;
	slug: string;
	key: string;
	ownerSlug: string;
}

/** A role on a project. The owner is projects.owner_id; editor and viewer are memberships. */
export type ProjectRole = 'owner' | 'editor' | 'viewer';

/** The roles a membership row can grant. Ownership is never granted. */
export type MemberRole = Exclude<ProjectRole, 'owner'>;

const ROLE_RANK: Record<ProjectRole, number> = { viewer: 0, editor: 1, owner: 2 };

/** A caller's standing on a project: the granted role and the one access checks use. */
export interface ProjectAccess {
	project: ResolvedProject;
	grantedRole: ProjectRole;
	effectiveRole: ProjectRole;
}

/**
 * Why a member can't do something that needs a higher role: they were granted view
 * access, they are an editor who hasn't connected GitHub, or it is the owner's alone.
 */
export type AccessDenial = 'viewer' | 'github_not_connected' | 'owner_only';

export const ACCESS_DENIAL_MESSAGES: Record<AccessDenial, string> = {
	viewer: 'You have view access to this project',
	github_not_connected: 'Connect GitHub to edit this project',
	owner_only: 'Only the project owner can do this',
};

/**
 * Whether a member with `access` may do what needs `minRole`: null when they may, else
 * the reason they can't. The one comparison of a role against a requirement, for REST
 * routes and MCP tools alike.
 */
export function accessDenial(
	access: Pick<ProjectAccess, 'grantedRole' | 'effectiveRole'>,
	minRole: ProjectRole
): AccessDenial | null {
	if (ROLE_RANK[access.effectiveRole] >= ROLE_RANK[minRole]) return null;
	if (minRole === 'owner') return 'owner_only';
	return access.grantedRole === 'editor' ? 'github_not_connected' : 'viewer';
}

/**
 * SQL for the effective role: a granted editor without a GitHub connection works as a
 * viewer, since commits run on the actor's own token and they have none to commit with.
 * Every other granted role is also the effective one.
 */
export function effectiveRoleSql(grantedRole: string, githubConnected: string): string {
	return `CASE WHEN ${grantedRole} = 'editor' AND NOT (${githubConnected}) THEN 'viewer' ELSE ${grantedRole} END`;
}

/**
 * The caller's granted and effective role on project `p`, and the joins they need. The
 * one definition of who can reach a project, shared by the resolver and the project
 * list: the owner is projects.owner_id, and everyone else needs a project_members row.
 */
function accessSql(userParam: string): { columns: string; joins: string; reachable: string } {
	const granted = `CASE WHEN p.owner_id = ${userParam} THEN 'owner' ELSE m.role END`;
	return {
		columns: `${granted} AS "grantedRole",
			${effectiveRoleSql(granted, 'gc.user_id IS NOT NULL')} AS "effectiveRole"`,
		joins: `LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ${userParam}
			LEFT JOIN github_connections gc ON gc.user_id = ${userParam}`,
		reachable: `(p.owner_id = ${userParam} OR m.user_id IS NOT NULL)`,
	};
}

/**
 * Resolve an `owner/project` address for a user, with the user's role on it. This is
 * the one place a project address becomes a project and the one place access is
 * decided: every REST route and MCP tool goes through it, in one query. Returns null
 * when the address doesn't exist or the user is neither its owner nor a member;
 * callers surface both as "not found" so other users' projects aren't probeable.
 */
export async function resolveProjectAccess(
	ownerSlug: string,
	projectSlug: string,
	userId: string
): Promise<ProjectAccess | null> {
	const access = accessSql('$3');
	const result = await query<ResolvedProject & { grantedRole: ProjectRole; effectiveRole: ProjectRole }>(
		`SELECT p.id, p.slug, p.key, u.slug AS "ownerSlug", ${access.columns}
		 FROM projects p
		 JOIN users u ON u.id = p.owner_id
		 ${access.joins}
		 WHERE u.slug = $1 AND p.slug = $2 AND ${access.reachable}`,
		[ownerSlug, projectSlug, userId]
	);
	const row = result.rows[0];
	if (!row) return null;
	const { grantedRole, effectiveRole, ...project } = row;
	return { project, grantedRole, effectiveRole };
}

interface ProjectQueryRow extends ProjectRow {
	item_count: string;
	ready_count: string;
	in_progress_count: string;
	in_review_count: string;
	done_count: string;
	grantedRole: ProjectRole;
	effectiveRole: ProjectRole;
}

/** Every project the user owns or is a member of, each with the user's role on it. */
export async function getProjects(userId: string): Promise<ProjectWithStats[]> {
	const access = accessSql('$1');
	// Count top-level items (parent_id IS NULL) per project, by status.
	const result = await query<ProjectQueryRow>(
		`SELECT p.*, u.slug AS owner_slug, ${USER_DISPLAY_NAME_SQL} AS owner_name, ${access.columns},
			COUNT(i.id)::text as item_count,
			COUNT(CASE WHEN i.status = 'ready' THEN 1 END)::text as ready_count,
			COUNT(CASE WHEN i.status = 'in_progress' THEN 1 END)::text as in_progress_count,
			COUNT(CASE WHEN i.status = 'in_review' THEN 1 END)::text as in_review_count,
			COUNT(CASE WHEN i.status = 'done' THEN 1 END)::text as done_count
		FROM projects p
		JOIN users u ON u.id = p.owner_id
		${access.joins}
		LEFT JOIN items i ON i.project_id = p.id AND i.parent_id IS NULL
		WHERE ${access.reachable}
		GROUP BY p.id, u.id, m.role, gc.user_id
		ORDER BY p.updated_at DESC, p.created_at DESC, p.id`,
		[userId]
	);

	return result.rows.map((row) => ({
		...transformProject(row),
		itemCount: parseInt(row.item_count, 10),
		itemCounts: {
			ready: parseInt(row.ready_count, 10),
			in_progress: parseInt(row.in_progress_count, 10),
			in_review: parseInt(row.in_review_count, 10),
			done: parseInt(row.done_count, 10),
		},
		grantedRole: row.grantedRole,
		effectiveRole: row.effectiveRole,
	}));
}

/**
 * Get a single project by its internal id. The id comes from resolveProjectAccess,
 * which has already decided the caller may see it; nothing here re-checks access.
 */
export async function getProject(projectId: string): Promise<ProjectResponse | null> {
	const result = await query<ProjectRow>(`${PROJECT_SELECT} WHERE p.id = $1`, [projectId]);

	if (result.rows.length === 0) {
		return null;
	}

	return transformProject(result.rows[0]!);
}

/**
 * Create a new project
 */
export interface RepositoryConfigInput {
	provider: 'github';
	owner: string;
	repo: string;
	branch: string;
	url: string;
}

export interface CreateProjectInput {
	name: string;
	description?: string;
	systemPrompt?: string;
	repository?: RepositoryConfigInput;
}

/**
 * Insert a project, retrying until it finds a slug and key that are free for this
 * owner. The unique indexes are the arbiter rather than a pre-flight SELECT, so two
 * concurrent creates can't agree on the same identifier. Each identifier is bumped
 * only when it is the one that collided — "Spectrum" alongside an existing "Specboard"
 * takes the free slug `spectrum` and only suffixes the contested key.
 */
async function insertProject(
	name: string,
	columns: string,
	placeholders: string,
	values: unknown[]
): Promise<ProjectRow> {
	const baseSlug = slugifyProjectName(name);
	const baseKey = deriveProjectKey(name);
	let slugAttempt = 1;
	let keyAttempt = 1;

	while (slugAttempt <= MAX_IDENTIFIER_ATTEMPTS && keyAttempt <= MAX_IDENTIFIER_ATTEMPTS) {
		try {
			const result = await query<ProjectRow>(
				`INSERT INTO projects (${columns}, slug, key)
				 VALUES (${placeholders}, $${values.length + 1}, $${values.length + 2})
				 ${PROJECT_RETURNING}`,
				[...values, withSuffix(baseSlug, slugAttempt, 'slug'), withSuffix(baseKey, keyAttempt, 'key')]
			);
			return result.rows[0]!;
		} catch (error) {
			const { code, constraint } = error as { code?: string; constraint?: string };
			if (code !== UNIQUE_VIOLATION) throw error;
			if (constraint === 'idx_projects_owner_key') keyAttempt++;
			else slugAttempt++;
		}
	}

	throw new Error(`Could not find a free slug or key for project name "${name}"`);
}

/** Cloud projects always expose the whole checkout; root paths are a local-mode concept. */
const CLOUD_ROOT_PATHS: readonly string[] = ['/'];

function toCloudRepository(input: RepositoryConfigInput): RepositoryConfigCloud {
	return {
		type: 'cloud',
		remote: {
			provider: input.provider,
			owner: input.owner,
			repo: input.repo,
			url: input.url,
		},
		branch: input.branch,
	};
}

/** Raised when a user who hasn't claimed a slug creates a project it could never be addressed by. */
export class ProjectOwnerWithoutSlugError extends Error {
	constructor() {
		super('Finish onboarding before creating a project');
		this.name = 'ProjectOwnerWithoutSlugError';
	}
}

export async function createProject(
	userId: string,
	data: CreateProjectInput
): Promise<ProjectResponse> {
	if (!(await getUserSlug(userId))) {
		throw new ProjectOwnerWithoutSlugError();
	}

	// If repository is provided, set up cloud mode
	if (data.repository) {
		const project = await insertProject(
			data.name,
			'name, description, owner_id, storage_mode, repository, root_paths, system_prompt',
			"$1, $2, $3, 'cloud', $4, $5, $6",
			// Empty string or undefined → NULL in DB
			[data.name, data.description || null, userId, JSON.stringify(toCloudRepository(data.repository)), JSON.stringify(CLOUD_ROOT_PATHS), data.systemPrompt || null]
		);

		return transformProject(project);
	}

	// No repository - create with default storage_mode 'none'
	const project = await insertProject(
		data.name,
		'name, description, owner_id, system_prompt',
		'$1, $2, $3, $4',
		// Empty string or undefined → NULL in DB
		[data.name, data.description || null, userId, data.systemPrompt || null]
	);

	return transformProject(project);
}

/**
 * Update a project
 */
export interface UpdateProjectInput {
	name?: string;
	description?: string;
	systemPrompt?: string;
	slug?: string;
	key?: string;
	/**
	 * Attach a GitHub repository to a project that has no storage yet, switching it to
	 * cloud mode. Only accepted while storage_mode is 'none': changing or removing a
	 * configured repository is not supported.
	 */
	repository?: RepositoryConfigInput;
}

/** Raised when a requested slug or key is already used by another of the owner's projects. */
export class ProjectIdentifierTakenError extends Error {
	readonly field: 'slug' | 'key';

	constructor(field: 'slug' | 'key') {
		super(`Project ${field} is already in use`);
		this.name = 'ProjectIdentifierTakenError';
		this.field = field;
	}
}

/** Raised when a repository is attached to a project that already has one. */
export class ProjectHasRepositoryError extends Error {
	constructor() {
		super('Project already has a repository');
		this.name = 'ProjectHasRepositoryError';
	}
}

/** Update a project. The resolver has already authorized the caller as its owner. */
export async function updateProject(
	projectId: string,
	data: UpdateProjectInput
): Promise<ProjectResponse | null> {
	const updates: string[] = [];
	const values: unknown[] = [];
	let paramIndex = 1;
	const conditions: string[] = [];

	if (data.name !== undefined) {
		updates.push(`name = $${paramIndex++}`);
		values.push(data.name);
	}
	if (data.description !== undefined) {
		updates.push(`description = $${paramIndex++}`);
		values.push(data.description || null);
	}
	if (data.systemPrompt !== undefined) {
		updates.push(`system_prompt = $${paramIndex++}`);
		values.push(data.systemPrompt || null);  // Empty string or undefined → NULL in DB
	}
	// Renaming a project deliberately leaves its slug and key alone: they're in URLs
	// and item keys, so they only change when asked for explicitly.
	if (data.slug !== undefined) {
		updates.push(`slug = $${paramIndex++}`);
		values.push(data.slug);
	}
	if (data.key !== undefined) {
		updates.push(`key = $${paramIndex++}`);
		values.push(data.key);
	}
	if (data.repository !== undefined) {
		updates.push(
			"storage_mode = 'cloud'",
			`repository = $${paramIndex++}`,
			`root_paths = $${paramIndex++}`,
			// Projects that removeFolder moved out of cloud mode before it refused them still
			// carry sync state; a stale pending status or commit sha must not leak into the new repo.
			'last_synced_commit_sha = NULL',
			'sync_status = NULL',
			'sync_started_at = NULL',
			'sync_completed_at = NULL',
			'sync_error = NULL'
		);
		values.push(JSON.stringify(toCloudRepository(data.repository)), JSON.stringify(CLOUD_ROOT_PATHS));
		// The guard lives in the WHERE clause so two concurrent attaches can't both win.
		conditions.push("storage_mode = 'none'");
	}

	if (updates.length === 0) {
		return getProject(projectId);
	}

	updates.push('updated_at = NOW()');
	values.push(projectId);
	conditions.unshift(`id = $${paramIndex}`);

	let result;
	try {
		result = await query<ProjectRow>(
			`UPDATE projects SET ${updates.join(', ')}
			 WHERE ${conditions.join(' AND ')}
			 ${PROJECT_RETURNING}`,
			values
		);
	} catch (error) {
		const { code, constraint } = error as { code?: string; constraint?: string };
		if (code === UNIQUE_VIOLATION) {
			throw new ProjectIdentifierTakenError(constraint === 'idx_projects_owner_key' ? 'key' : 'slug');
		}
		throw error;
	}

	if (result.rows.length === 0) {
		// Nothing matched: either the project is gone, or the storage_mode guard held
		// because it already has a repository. Tell those two apart.
		if (data.repository !== undefined && (await getProject(projectId))) {
			throw new ProjectHasRepositoryError();
		}
		return null;
	}

	return transformProject(result.rows[0]!);
}

/** Delete a project. The resolver has already authorized the caller as its owner. */
export async function deleteProject(projectId: string): Promise<boolean> {
	const result = await query('DELETE FROM projects WHERE id = $1', [projectId]);
	return (result.rowCount ?? 0) > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage management
// ─────────────────────────────────────────────────────────────────────────────

export interface AddFolderInput {
	repoPath: string; // Git repository root path
	rootPath: string; // Path within repo to display (e.g., "/docs")
	branch: string;
}

/**
 * Add a folder to a project (local mode)
 * This sets the repository config and adds a root path
 * Uses transaction with FOR UPDATE to prevent race conditions
 */
export async function addFolder(
	projectId: string,
	data: AddFolderInput
): Promise<ProjectResponse | null> {
	return transaction(async (client) => {
		// Get the project with FOR UPDATE lock to prevent race conditions
		const existing = await client.query<Project>(
			'SELECT * FROM projects WHERE id = $1 FOR UPDATE',
			[projectId]
		);

		if (existing.rows.length === 0) {
			return null;
		}

		const project = existing.rows[0]!;

		// Cloud -> local is unsupported; the managed checkout and sync state belong to the repo.
		if (project.storage_mode === 'cloud') {
			throw new Error('CLOUD_PROJECT');
		}

		// If project already has a local path, verify it matches
		const currentRepo = project.repository as RepositoryConfig | Record<string, never>;
		if (isLocalRepository(currentRepo) && currentRepo.localPath !== data.repoPath) {
			throw new Error('DIFFERENT_REPO');
		}

		// Check if root path already exists
		if (project.root_paths.includes(data.rootPath)) {
			throw new Error('DUPLICATE_PATH');
		}

		// Enforce maximum root paths limit
		if (project.root_paths.length >= MAX_ROOT_PATHS) {
			throw new Error('MAX_ROOT_PATHS_EXCEEDED');
		}

		// Update project with new storage config
		const newRepository = {
			type: 'local' as const,
			localPath: data.repoPath,
			branch: data.branch,
		};
		const newRootPaths = [...project.root_paths, data.rootPath];

		const result = await client.query<ProjectRow>(
			`UPDATE projects
			 SET storage_mode = 'local',
			     repository = $1,
			     root_paths = $2,
			     updated_at = NOW()
			 WHERE id = $3
			 ${PROJECT_RETURNING}`,
			[JSON.stringify(newRepository), JSON.stringify(newRootPaths), projectId]
		);

		if (result.rows.length === 0) {
			return null;
		}

		return transformProject(result.rows[0]!);
	});
}

/**
 * Remove a folder from a project (doesn't delete files)
 * Uses transaction with FOR UPDATE to prevent race conditions
 */
export async function removeFolder(
	projectId: string,
	rootPath: string
): Promise<ProjectResponse | null> {
	return transaction(async (client) => {
		// Get the project with FOR UPDATE lock to prevent race conditions
		const existing = await client.query<Project>(
			'SELECT * FROM projects WHERE id = $1 FOR UPDATE',
			[projectId]
		);

		if (existing.rows.length === 0) {
			return null;
		}

		const project = existing.rows[0]!;

		// Dropping a cloud project's only root path would reset it to 'none' and orphan its
		// managed checkout and sync state.
		if (project.storage_mode === 'cloud') {
			throw new Error('CLOUD_PROJECT');
		}

		const newRootPaths = project.root_paths.filter((p) => p !== rootPath);

		const result = await client.query<ProjectRow>(
			`UPDATE projects
			 SET root_paths = $1::jsonb,
			     repository = CASE WHEN jsonb_array_length($1::jsonb) = 0 THEN '{}'::jsonb ELSE repository END,
			     storage_mode = CASE WHEN jsonb_array_length($1::jsonb) = 0 THEN 'none' ELSE storage_mode END,
			     updated_at = NOW()
			 WHERE id = $2
			 ${PROJECT_RETURNING}`,
			[JSON.stringify(newRootPaths), projectId]
		);

		if (result.rows.length === 0) {
			return null;
		}

		return transformProject(result.rows[0]!);
	});
}
