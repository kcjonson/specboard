/**
 * Project service - shared business logic for projects
 */

import { query } from '../index.js';
import type { Project } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Response types (camelCase for API/MCP responses)
// ─────────────────────────────────────────────────────────────────────────────

export interface ProjectResponse {
	id: string;
	name: string;
	description: string | null;
	ownerId: string;
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
export interface CreateProjectInput {
	name: string;
	description?: string;
}

export async function createProject(
	userId: string,
	data: CreateProjectInput
): Promise<ProjectResponse> {
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
