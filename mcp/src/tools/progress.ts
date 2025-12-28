/**
 * Progress-related MCP tools
 *
 * These tools allow Claude to:
 * - Add progress notes for visibility (add_progress_note)
 * - Signal ready for review when PR is opened (signal_ready_for_review)
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { query, type ProgressNote, type Epic } from '@doc-platform/db';

export const progressTools: Tool[] = [
	{
		name: 'add_progress_note',
		description:
			'Add a timestamped progress note to an epic or task. Use this to log significant milestones, decisions, or activity that the human should be able to see.',
		inputSchema: {
			type: 'object',
			properties: {
				epic_id: {
					type: 'string',
					description: 'The UUID of the epic (use this OR task_id)',
				},
				task_id: {
					type: 'string',
					description: 'The UUID of the task (use this OR epic_id)',
				},
				note: {
					type: 'string',
					description: 'The progress note text',
				},
			},
			required: ['note'],
		},
	},
	{
		name: 'signal_ready_for_review',
		description:
			'Signal that an epic is ready for human review by providing the PR URL. This sets the epic status to "in_review".',
		inputSchema: {
			type: 'object',
			properties: {
				epic_id: {
					type: 'string',
					description: 'The UUID of the epic',
				},
				pr_url: {
					type: 'string',
					description: 'The URL of the pull request',
				},
			},
			required: ['epic_id', 'pr_url'],
		},
	},
];

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

export async function handleProgressTool(
	name: string,
	args: Record<string, unknown> | undefined
): Promise<ToolResult> {
	switch (name) {
		case 'add_progress_note':
			return await addProgressNote(
				args?.epic_id as string | undefined,
				args?.task_id as string | undefined,
				args?.note as string
			);
		case 'signal_ready_for_review':
			return await signalReadyForReview(args?.epic_id as string, args?.pr_url as string);
		default:
			return {
				content: [{ type: 'text', text: `Unknown progress tool: ${name}` }],
				isError: true,
			};
	}
}

async function addProgressNote(
	epicId: string | undefined,
	taskId: string | undefined,
	note: string
): Promise<ToolResult> {
	if (!note) {
		return {
			content: [{ type: 'text', text: 'note is required' }],
			isError: true,
		};
	}

	if (!epicId && !taskId) {
		return {
			content: [{ type: 'text', text: 'Either epic_id or task_id is required' }],
			isError: true,
		};
	}

	if (epicId && taskId) {
		return {
			content: [{ type: 'text', text: 'Provide either epic_id or task_id, not both' }],
			isError: true,
		};
	}

	// Verify the parent exists
	if (epicId) {
		const epicCheck = await query(`SELECT id FROM epics WHERE id = $1`, [epicId]);
		if (epicCheck.rows.length === 0) {
			return {
				content: [{ type: 'text', text: `Epic not found: ${epicId}` }],
				isError: true,
			};
		}
	} else if (taskId) {
		const taskCheck = await query(`SELECT id FROM tasks WHERE id = $1`, [taskId]);
		if (taskCheck.rows.length === 0) {
			return {
				content: [{ type: 'text', text: `Task not found: ${taskId}` }],
				isError: true,
			};
		}
	}

	// Create progress note
	const result = await query<ProgressNote>(
		`INSERT INTO progress_notes (epic_id, task_id, note, created_by)
		 VALUES ($1, $2, $3, 'claude')
		 RETURNING *`,
		[epicId ?? null, taskId ?? null, note]
	);

	const progressNote = result.rows[0];
	if (!progressNote) {
		return {
			content: [{ type: 'text', text: 'Failed to create progress note' }],
			isError: true,
		};
	}

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(
					{
						created: {
							id: progressNote.id,
							note: progressNote.note,
							createdAt: progressNote.created_at,
						},
						message: 'Progress note added',
					},
					null,
					2
				),
			},
		],
	};
}

async function signalReadyForReview(epicId: string, prUrl: string): Promise<ToolResult> {
	if (!epicId || !prUrl) {
		return {
			content: [{ type: 'text', text: 'epic_id and pr_url are required' }],
			isError: true,
		};
	}

	// Update epic to in_review with PR URL
	const result = await query<Epic>(
		`UPDATE epics SET status = 'in_review', pr_url = $2 WHERE id = $1 RETURNING *`,
		[epicId, prUrl]
	);

	if (result.rows.length === 0) {
		return {
			content: [{ type: 'text', text: `Epic not found: ${epicId}` }],
			isError: true,
		};
	}

	// Add a progress note
	await query(
		`INSERT INTO progress_notes (epic_id, note, created_by)
		 VALUES ($1, $2, 'claude')`,
		[epicId, `Ready for review: ${prUrl}`]
	);

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(
					{
						epic: { id: epicId, status: 'in_review', prUrl },
						message: 'Epic marked as ready for review',
					},
					null,
					2
				),
			},
		],
	};
}
