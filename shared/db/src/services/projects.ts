/**
 * Project service - shared business logic for projects
 */

import { query, transaction } from '../index.ts';
import { type Project, type StorageMode, type RepositoryConfig, isLocalRepository } from '../types.ts';

// Maximum number of root paths per project to prevent abuse
const MAX_ROOT_PATHS = 20;

// ─────────────────────────────────────────────────────────────────────────────
// Response types (camelCase for API/MCP responses)
// ─────────────────────────────────────────────────────────────────────────────

export interface ProjectResponse {
	id: string;
	name: string;
	description: string | null;
	ownerId: string;
	storageMode: StorageMode;
	repository: RepositoryConfig | Record<string, never>;
	rootPaths: string[];
	createdAt: Date;
	updatedAt: Date;
}

export interface EpicCounts {
	ready: number;
	in_progress: number;
	in_review: number;
	done: number;
}

export interface ProjectWithStats extends ProjectResponse {
	epicCount: number;
	epicCounts: EpicCounts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────────────────────

function transformProject(project: Project): ProjectResponse {
	return {
		id: project.id,
		name: project.name,
		description: project.description,
		ownerId: project.owner_id,
		storageMode: project.storage_mode,
		repository: project.repository,
		rootPaths: project.root_paths,
		createdAt: project.created_at,
		updatedAt: project.updated_at,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Service functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get all projects for a user
 */
interface ProjectQueryRow extends Project {
	epic_count: string;
	ready_count: string;
	in_progress_count: string;
	in_review_count: string;
	done_count: string;
}

export async function getProjects(userId: string): Promise<ProjectWithStats[]> {
	const result = await query<ProjectQueryRow>(
		`SELECT p.*,
			COUNT(e.id)::text as epic_count,
			COUNT(CASE WHEN e.status = 'ready' THEN 1 END)::text as ready_count,
			COUNT(CASE WHEN e.status = 'in_progress' THEN 1 END)::text as in_progress_count,
			COUNT(CASE WHEN e.status = 'in_review' THEN 1 END)::text as in_review_count,
			COUNT(CASE WHEN e.status = 'done' THEN 1 END)::text as done_count
		FROM projects p
		LEFT JOIN epics e ON e.project_id = p.id
		WHERE p.owner_id = $1
		GROUP BY p.id
		ORDER BY p.updated_at DESC`,
		[userId]
	);

	return result.rows.map((row) => ({
		...transformProject(row),
		epicCount: parseInt(row.epic_count, 10),
		epicCounts: {
			ready: parseInt(row.ready_count, 10),
			in_progress: parseInt(row.in_progress_count, 10),
			in_review: parseInt(row.in_review_count, 10),
			done: parseInt(row.done_count, 10),
		},
	}));
}

/**
 * Get a single project by ID
 */
export async function getProject(
	projectId: string,
	userId: string
): Promise<ProjectResponse | null> {
	const result = await query<Project>(
		'SELECT * FROM projects WHERE id = $1 AND owner_id = $2',
		[projectId, userId]
	);

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
	repository?: RepositoryConfigInput;
}

export async function createProject(
	userId: string,
	data: CreateProjectInput
): Promise<ProjectResponse> {
	// If repository is provided, set up cloud mode
	if (data.repository) {
		const repoConfig = {
			type: 'cloud' as const,
			remote: {
				provider: data.repository.provider,
				owner: data.repository.owner,
				repo: data.repository.repo,
				url: data.repository.url,
			},
			branch: data.repository.branch,
		};

		const result = await query<Project>(
			`INSERT INTO projects (name, description, owner_id, storage_mode, repository, root_paths)
			 VALUES ($1, $2, $3, 'cloud', $4, $5)
			 RETURNING *`,
			[data.name, data.description || null, userId, JSON.stringify(repoConfig), JSON.stringify(['/'])]
		);

		return transformProject(result.rows[0]!);
	}

	// No repository - create with default storage_mode 'none'
	const result = await query<Project>(
		`INSERT INTO projects (name, description, owner_id)
		 VALUES ($1, $2, $3)
		 RETURNING *`,
		[data.name, data.description || null, userId]
	);

	return transformProject(result.rows[0]!);
}

/**
 * Update a project
 */
export interface UpdateProjectInput {
	name?: string;
	description?: string;
}

export async function updateProject(
	projectId: string,
	userId: string,
	data: UpdateProjectInput
): Promise<ProjectResponse | null> {
	const updates: string[] = [];
	const values: unknown[] = [];
	let paramIndex = 1;

	if (data.name !== undefined) {
		updates.push(`name = $${paramIndex++}`);
		values.push(data.name);
	}
	if (data.description !== undefined) {
		updates.push(`description = $${paramIndex++}`);
		values.push(data.description || null);
	}

	if (updates.length === 0) {
		return getProject(projectId, userId);
	}

	updates.push('updated_at = NOW()');
	values.push(projectId, userId);

	const result = await query<Project>(
		`UPDATE projects SET ${updates.join(', ')}
		 WHERE id = $${paramIndex++} AND owner_id = $${paramIndex}
		 RETURNING *`,
		values
	);

	if (result.rows.length === 0) {
		return null;
	}

	return transformProject(result.rows[0]!);
}

/**
 * Delete a project
 */
export async function deleteProject(projectId: string, userId: string): Promise<boolean> {
	const result = await query(
		'DELETE FROM projects WHERE id = $1 AND owner_id = $2',
		[projectId, userId]
	);
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
	userId: string,
	data: AddFolderInput
): Promise<ProjectResponse | null> {
	return transaction(async (client) => {
		// Get the project with FOR UPDATE lock to prevent race conditions
		const existing = await client.query<Project>(
			'SELECT * FROM projects WHERE id = $1 AND owner_id = $2 FOR UPDATE',
			[projectId, userId]
		);

		if (existing.rows.length === 0) {
			return null;
		}

		const project = existing.rows[0]!;

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

		const result = await client.query<Project>(
			`UPDATE projects
			 SET storage_mode = 'local',
			     repository = $1,
			     root_paths = $2,
			     updated_at = NOW()
			 WHERE id = $3 AND owner_id = $4
			 RETURNING *`,
			[JSON.stringify(newRepository), JSON.stringify(newRootPaths), projectId, userId]
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
	userId: string,
	rootPath: string
): Promise<ProjectResponse | null> {
	return transaction(async (client) => {
		// Get the project with FOR UPDATE lock to prevent race conditions
		const existing = await client.query<Project>(
			'SELECT * FROM projects WHERE id = $1 AND owner_id = $2 FOR UPDATE',
			[projectId, userId]
		);

		if (existing.rows.length === 0) {
			return null;
		}

		const project = existing.rows[0]!;
		const newRootPaths = project.root_paths.filter((p) => p !== rootPath);

		const result = await client.query<Project>(
			`UPDATE projects
			 SET root_paths = $1::jsonb,
			     repository = CASE WHEN jsonb_array_length($1::jsonb) = 0 THEN '{}'::jsonb ELSE repository END,
			     storage_mode = CASE WHEN jsonb_array_length($1::jsonb) = 0 THEN 'none' ELSE storage_mode END,
			     updated_at = NOW()
			 WHERE id = $2 AND owner_id = $3
			 RETURNING *`,
			[JSON.stringify(newRootPaths), projectId, userId]
		);

		if (result.rows.length === 0) {
			return null;
		}

		return transformProject(result.rows[0]!);
	});
}
