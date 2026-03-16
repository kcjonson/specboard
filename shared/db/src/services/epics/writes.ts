/**
 * Epic service write operations
 */

import { query } from '../../index.ts';
import type { Epic, Task, EpicStatus, SubStatus } from '../../types.ts';
import type { EpicResponse, CreateEpicInput, UpdateEpicInput } from './types.ts';
import { transformEpic, calculateTaskStats } from './transforms.ts';
import { getItems } from './reads.ts';

/**
 * Derive board status from sub_status at key transitions.
 * Returns the new status, or undefined if sub_status doesn't force a transition.
 */
function deriveStatusFromSubStatus(subStatus: SubStatus): EpicStatus | undefined {
	switch (subStatus) {
		case 'scoping':
		case 'in_development':
		case 'pr_open':
			return 'in_progress';
		case 'complete':
			return 'done';
		default:
			// paused, needs_input, not_started: no auto-transition
			return undefined;
	}
}

/**
 * Derive a reasonable sub_status from a board status.
 * Used when creating epics with a non-default status to keep fields consistent.
 */
function deriveSubStatusFromStatus(status: EpicStatus): SubStatus {
	switch (status) {
		case 'in_progress': return 'in_development';
		case 'in_review': return 'pr_open';
		case 'done': return 'complete';
		default: return 'not_started';
	}
}

/**
 * Create a new epic
 */
export async function createEpic(
	projectId: string,
	data: CreateEpicInput
): Promise<EpicResponse> {
	// Get next rank if not provided
	let rank = data.rank;
	if (rank === undefined) {
		const rankResult = await query<{ max: number }>(
			'SELECT COALESCE(MAX(rank), 0) as max FROM epics WHERE project_id = $1',
			[projectId]
		);
		rank = (rankResult.rows[0]?.max ?? 0) + 1;
	}

	// Derive initial sub_status from status to keep them consistent
	const initialStatus = data.status || 'ready';
	const initialSubStatus = deriveSubStatusFromStatus(initialStatus);

	const result = await query<Epic>(
		`INSERT INTO epics (project_id, title, type, description, status, sub_status, creator, rank, spec_doc_path)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 RETURNING *`,
		[
			projectId,
			data.title,
			data.type || 'epic',
			data.description || null,
			initialStatus,
			initialSubStatus,
			data.creator || null,
			rank,
			data.specDocPath || null,
		]
	);

	const epic = result.rows[0]!;
	return {
		...transformEpic(epic),
		taskStats: { total: 0, done: 0, inProgress: 0, blocked: 0 },
	};
}

/**
 * Update an epic
 */
export async function updateEpic(
	projectId: string,
	epicId: string,
	data: UpdateEpicInput
): Promise<EpicResponse | null> {
	const updates: string[] = [];
	const values: unknown[] = [];
	let paramIndex = 1;

	// Auto-derive board status from sub_status if provided (and status not explicitly set)
	if (data.subStatus !== undefined && data.status === undefined) {
		const derivedStatus = deriveStatusFromSubStatus(data.subStatus);
		if (derivedStatus) {
			data.status = derivedStatus;
		}
	}

	if (data.title !== undefined) {
		updates.push(`title = $${paramIndex++}`);
		values.push(data.title);
	}
	if (data.description !== undefined) {
		updates.push(`description = $${paramIndex++}`);
		values.push(data.description);
	}
	if (data.status !== undefined) {
		updates.push(`status = $${paramIndex++}`);
		values.push(data.status);
	}
	if (data.subStatus !== undefined) {
		updates.push(`sub_status = $${paramIndex++}`);
		values.push(data.subStatus);
	}
	if (data.rank !== undefined) {
		updates.push(`rank = $${paramIndex++}`);
		values.push(data.rank);
	}
	if (data.specDocPath !== undefined) {
		updates.push(`spec_doc_path = $${paramIndex++}`);
		values.push(data.specDocPath);
	}
	if (data.prUrl !== undefined) {
		updates.push(`pr_url = $${paramIndex++}`);
		values.push(data.prUrl);
	}
	if (data.branchName !== undefined) {
		updates.push(`branch_name = $${paramIndex++}`);
		values.push(data.branchName);
	}
	if (data.notes !== undefined) {
		// Append to existing notes with timestamp
		const timestamp = new Date().toISOString().split('T')[0];
		const entry = `[${timestamp}] ${data.notes}`;
		updates.push(`notes = CASE WHEN notes IS NULL THEN $${paramIndex++} ELSE notes || E'\\n' || $${paramIndex - 1} END`);
		values.push(entry);
	}

	if (updates.length === 0) {
		const items = await getItems({ projectId, itemId: epicId });
		return items[0] ?? null;
	}

	updates.push('updated_at = NOW()');
	values.push(epicId, projectId);

	const result = await query<Epic>(
		`UPDATE epics SET ${updates.join(', ')}
		 WHERE id = $${paramIndex++} AND project_id = $${paramIndex}
		 RETURNING *`,
		values
	);

	if (result.rows.length === 0) {
		return null;
	}

	const epic = result.rows[0]!;

	// Get task stats
	const tasksResult = await query<Task>(
		'SELECT status FROM tasks WHERE epic_id = $1',
		[epicId]
	);

	return {
		...transformEpic(epic),
		taskStats: calculateTaskStats(tasksResult.rows),
	};
}

/**
 * Delete an epic
 */
export async function deleteEpic(projectId: string, epicId: string): Promise<boolean> {
	const result = await query(
		'DELETE FROM epics WHERE id = $1 AND project_id = $2',
		[epicId, projectId]
	);
	return (result.rowCount ?? 0) > 0;
}

/**
 * Signal epic is ready for review (set status and PR URL)
 */
export async function signalReadyForReview(
	projectId: string,
	epicId: string,
	prUrl: string
): Promise<EpicResponse | null> {
	return updateEpic(projectId, epicId, { status: 'in_progress', subStatus: 'pr_open', prUrl });
}
