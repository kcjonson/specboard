/**
 * Progress-related MCP tools
 *
 * These tools allow Claude to:
 * - Add progress notes for visibility (add_progress_note)
 * - Signal ready for review when PR is opened (signal_ready_for_review)
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
	addEpicProgressNote,
	addTaskProgressNote,
	signalReadyForReview as signalReadyForReviewService,
} from '@doc-platform/db';

export const progressTools: Tool[] = [
	{
		name: 'add_progress_note',
		description:
			'Add a timestamped progress note to an epic or task. Use this to log significant milestones, decisions, or activity that the human should be able to see.',
		inputSchema: {
			type: 'object',
			properties: {
				project_id: {
					type: 'string',
					description: 'The UUID of the project',
				},
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
			required: ['project_id', 'note'],
		},
	},
	{
		name: 'signal_ready_for_review',
		description:
			'Signal that an epic is ready for human review by providing the PR URL. This sets the epic status to "in_review".',
		inputSchema: {
			type: 'object',
			properties: {
				project_id: {
					type: 'string',
					description: 'The UUID of the project',
				},
				epic_id: {
					type: 'string',
					description: 'The UUID of the epic',
				},
				pr_url: {
					type: 'string',
					description: 'The URL of the pull request',
				},
			},
			required: ['project_id', 'epic_id', 'pr_url'],
		},
	},
];

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

export async function handleProgressTool(
	name: string,
	args: Record<string, unknown> | undefined
): Promise<ToolResult> {
	const projectId = args?.project_id as string;
	if (!projectId) {
		return {
			content: [{ type: 'text', text: 'project_id is required' }],
			isError: true,
		};
	}

	try {
		switch (name) {
			case 'add_progress_note':
				return await addProgressNote(
					args?.epic_id as string | undefined,
					args?.task_id as string | undefined,
					args?.note as string
				);
			case 'signal_ready_for_review':
				return await signalReadyForReview(projectId, args?.epic_id as string, args?.pr_url as string);
			default:
				return {
					content: [{ type: 'text', text: `Unknown progress tool: ${name}` }],
					isError: true,
				};
		}
	} catch (error) {
		return {
			content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
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

	let progressNote;
	if (epicId) {
		progressNote = await addEpicProgressNote(epicId, note, 'claude');
	} else if (taskId) {
		progressNote = await addTaskProgressNote(taskId, note, 'claude');
	}

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
							createdAt: progressNote.createdAt,
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

async function signalReadyForReview(
	projectId: string,
	epicId: string,
	prUrl: string
): Promise<ToolResult> {
	if (!epicId || !prUrl) {
		return {
			content: [{ type: 'text', text: 'epic_id and pr_url are required' }],
			isError: true,
		};
	}

	const epic = await signalReadyForReviewService(projectId, epicId, prUrl);

	if (!epic) {
		return {
			content: [{ type: 'text', text: 'Epic not found' }],
			isError: true,
		};
	}

	// Also add a progress note
	await addEpicProgressNote(epicId, `Ready for review: ${prUrl}`, 'claude');

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(
					{
						epic: { id: epic.id, status: epic.status, prUrl: epic.prUrl },
						message: 'Epic marked as ready for review',
					},
					null,
					2
				),
			},
		],
	};
}
