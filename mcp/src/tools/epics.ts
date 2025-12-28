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

	const epic = epicResult.rows[0];
	if (!epic) {
		return {
			content: [{ type: 'text', text: `Epic not found: ${epicId}` }],
			isError: true,
		};
	}

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

	// Early return if no active epics
	if (activeResult.rows.length === 0) {
		const response: CurrentWorkResponse = {
			in_progress_epics: [],
			ready_epics: readyResult.rows.map((e) => ({
				id: e.id,
				title: e.title,
				spec_doc_path: e.spec_doc_path,
				created_at: e.created_at,
			})),
		};
		return {
			content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
		};
	}

	// Batch fetch all tasks and notes for active epics
	const epicIds = activeResult.rows.map((e) => e.id);

	const [tasksResult, notesResult] = await Promise.all([
		query<Task>(
			`SELECT * FROM tasks WHERE epic_id = ANY($1) ORDER BY epic_id, rank ASC`,
			[epicIds]
		),
		query<ProgressNote & { row_num: number }>(
			`SELECT * FROM (
				SELECT *, ROW_NUMBER() OVER (PARTITION BY epic_id ORDER BY created_at DESC) as row_num
				FROM progress_notes
				WHERE epic_id = ANY($1)
			) sub WHERE row_num <= 5`,
			[epicIds]
		),
	]);

	// Group tasks and notes by epic_id
	const tasksByEpic = new Map<string, Task[]>();
	const notesByEpic = new Map<string, ProgressNote[]>();

	for (const task of tasksResult.rows) {
		const epicTasks = tasksByEpic.get(task.epic_id) ?? [];
		epicTasks.push(task);
		tasksByEpic.set(task.epic_id, epicTasks);
	}

	for (const note of notesResult.rows) {
		if (note.epic_id) {
			const epicNotes = notesByEpic.get(note.epic_id) ?? [];
			epicNotes.push(note);
			notesByEpic.set(note.epic_id, epicNotes);
		}
	}

	// Build response for each active epic
	const inProgressEpics = activeResult.rows.map((epic) => {
		const tasks = tasksByEpic.get(epic.id) ?? [];
		const notes = notesByEpic.get(epic.id) ?? [];

		const taskStats: TaskStats = {
			total: tasks.length,
			completed: tasks.filter((t) => t.status === 'done').length,
			in_progress: tasks.filter((t) => t.status === 'in_progress').length,
			blocked: tasks.filter((t) => t.status === 'blocked').length,
		};

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
			recentNotes: notes.map((n) => ({
				note: n.note,
				createdAt: n.created_at,
			})),
		};
	});

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
