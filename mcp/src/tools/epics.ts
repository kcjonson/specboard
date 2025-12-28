/**
 * Epic-related MCP tools
 *
 * These tools allow Claude to:
 * - Find available work (get_ready_epics)
 * - Read epic details and specs (get_epic)
 * - Get current work context (get_current_work)
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { query, type Epic, type Task, type ProgressNote } from '@doc-platform/db';

export const epicTools: Tool[] = [
	{
		name: 'get_ready_epics',
		description:
			'Get all epics in "ready" status that are available to work on. Returns epics with their linked spec paths and basic info. Use this to find new work to pick up.',
		inputSchema: {
			type: 'object',
			properties: {},
			required: [],
		},
	},
	{
		name: 'get_epic',
		description:
			'Get full details of an epic including its tasks, progress notes, and linked spec path. Use this after picking up an epic to understand the requirements.',
		inputSchema: {
			type: 'object',
			properties: {
				epic_id: {
					type: 'string',
					description: 'The UUID of the epic to retrieve',
				},
			},
			required: ['epic_id'],
		},
	},
	{
		name: 'get_current_work',
		description:
			'Get all in-progress and in-review epics with their tasks. Use this at the start of a session to understand what work is ongoing.',
		inputSchema: {
			type: 'object',
			properties: {},
			required: [],
		},
	},
];

interface TaskStats {
	total: number;
	completed: number;
	in_progress: number;
	blocked: number;
}

interface EpicWithDetails extends Epic {
	tasks: Task[];
	task_stats: TaskStats;
	progress_notes: ProgressNote[];
}

interface CurrentWorkResponse {
	in_progress_epics: EpicWithDetails[];
	ready_epics: Pick<Epic, 'id' | 'title' | 'spec_doc_path' | 'created_at'>[];
}

export async function handleEpicTool(
	name: string,
	args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
	switch (name) {
		case 'get_ready_epics':
			return await getReadyEpics();
		case 'get_epic':
			return await getEpic(args?.epic_id as string);
		case 'get_current_work':
			return await getCurrentWork();
		default:
			return {
				content: [{ type: 'text', text: `Unknown epic tool: ${name}` }],
				isError: true,
			};
	}
}

async function getReadyEpics(): Promise<{ content: Array<{ type: string; text: string }> }> {
	const result = await query<Epic>(
		`SELECT id, title, description, status, spec_doc_path, created_at
		 FROM epics
		 WHERE status = 'ready'
		 ORDER BY rank ASC`
	);

	const epics = result.rows.map((epic) => ({
		id: epic.id,
		title: epic.title,
		description: epic.description,
		specPath: epic.spec_doc_path,
		createdAt: epic.created_at,
	}));

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify({ epics, count: epics.length }, null, 2),
			},
		],
	};
}

async function getEpic(epicId: string): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
	if (!epicId) {
		return {
			content: [{ type: 'text', text: 'epic_id is required' }],
			isError: true,
		};
	}

	// Get epic
	const epicResult = await query<Epic>(`SELECT * FROM epics WHERE id = $1`, [epicId]);

	if (epicResult.rows.length === 0) {
		return {
			content: [{ type: 'text', text: `Epic not found: ${epicId}` }],
			isError: true,
		};
	}

	const epic = epicResult.rows[0]!;

	// Get tasks
	const tasksResult = await query<Task>(
		`SELECT * FROM tasks WHERE epic_id = $1 ORDER BY rank ASC`,
		[epicId]
	);

	// Get progress notes
	const notesResult = await query<ProgressNote>(
		`SELECT * FROM progress_notes WHERE epic_id = $1 ORDER BY created_at DESC LIMIT 20`,
		[epicId]
	);

	// Calculate task stats
	const tasks = tasksResult.rows;
	const taskStats: TaskStats = {
		total: tasks.length,
		completed: tasks.filter((t) => t.status === 'done').length,
		in_progress: tasks.filter((t) => t.status === 'in_progress').length,
		blocked: tasks.filter((t) => t.status === 'blocked').length,
	};

	const response = {
		id: epic.id,
		title: epic.title,
		description: epic.description,
		status: epic.status,
		specPath: epic.spec_doc_path,
		prUrl: epic.pr_url,
		createdAt: epic.created_at,
		updatedAt: epic.updated_at,
		tasks: tasks.map((t) => ({
			id: t.id,
			title: t.title,
			status: t.status,
			details: t.details,
			blockReason: t.block_reason,
		})),
		taskStats,
		progressNotes: notesResult.rows.map((n) => ({
			id: n.id,
			note: n.note,
			createdBy: n.created_by,
			createdAt: n.created_at,
		})),
	};

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(response, null, 2),
			},
		],
	};
}

async function getCurrentWork(): Promise<{ content: Array<{ type: string; text: string }> }> {
	// Get in-progress and in-review epics
	const activeResult = await query<Epic>(
		`SELECT * FROM epics WHERE status IN ('in_progress', 'in_review') ORDER BY rank ASC`
	);

	// Get ready epics for reference
	const readyResult = await query<Epic>(
		`SELECT id, title, spec_doc_path, created_at FROM epics WHERE status = 'ready' ORDER BY rank ASC`
	);

	// For each active epic, get tasks and recent notes
	const inProgressEpics = await Promise.all(
		activeResult.rows.map(async (epic) => {
			const tasksResult = await query<Task>(
				`SELECT * FROM tasks WHERE epic_id = $1 ORDER BY rank ASC`,
				[epic.id]
			);

			const notesResult = await query<ProgressNote>(
				`SELECT * FROM progress_notes WHERE epic_id = $1 ORDER BY created_at DESC LIMIT 5`,
				[epic.id]
			);

			const tasks = tasksResult.rows;
			const taskStats: TaskStats = {
				total: tasks.length,
				completed: tasks.filter((t) => t.status === 'done').length,
				in_progress: tasks.filter((t) => t.status === 'in_progress').length,
				blocked: tasks.filter((t) => t.status === 'blocked').length,
			};

			// Find current task (in_progress)
			const currentTask = tasks.find((t) => t.status === 'in_progress');

			return {
				id: epic.id,
				title: epic.title,
				status: epic.status,
				specPath: epic.spec_doc_path,
				taskStats,
				currentTask: currentTask
					? {
							id: currentTask.id,
							title: currentTask.title,
							status: currentTask.status,
							details: currentTask.details,
						}
					: null,
				recentNotes: notesResult.rows.map((n) => ({
					note: n.note,
					createdAt: n.created_at,
				})),
			};
		})
	);

	const response: CurrentWorkResponse = {
		in_progress_epics: inProgressEpics as unknown as EpicWithDetails[],
		ready_epics: readyResult.rows.map((e) => ({
			id: e.id,
			title: e.title,
			spec_doc_path: e.spec_doc_path,
			created_at: e.created_at,
		})),
	};

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(response, null, 2),
			},
		],
	};
}
