/**
 * Epic-related MCP tools
 *
 * These tools allow Claude to:
 * - Find available work (get_ready_epics)
 * - Read epic details and specs (get_epic)
 * - Get current work context (get_current_work)
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
	getReadyEpics as getReadyEpicsService,
	getEpicWithDetails,
	getCurrentWork as getCurrentWorkService,
	verifyProjectAccess,
} from '@doc-platform/db';

export const epicTools: Tool[] = [
	{
		name: 'get_ready_epics',
		description:
			'Get all epics in "ready" status that are available to work on. Returns epics with their linked spec paths and basic info. Use this to find new work to pick up.',
		inputSchema: {
			type: 'object',
			properties: {
				project_id: {
					type: 'string',
					description: 'The UUID of the project to query',
				},
			},
			required: ['project_id'],
		},
	},
	{
		name: 'get_epic',
		description:
			'Get full details of an epic including its tasks, progress notes, and linked spec path. Use this after picking up an epic to understand the requirements.',
		inputSchema: {
			type: 'object',
			properties: {
				project_id: {
					type: 'string',
					description: 'The UUID of the project',
				},
				epic_id: {
					type: 'string',
					description: 'The UUID of the epic to retrieve',
				},
			},
			required: ['project_id', 'epic_id'],
		},
	},
	{
		name: 'get_current_work',
		description:
			'Get all in-progress and in-review epics with their tasks. Use this at the start of a session to understand what work is ongoing.',
		inputSchema: {
			type: 'object',
			properties: {
				project_id: {
					type: 'string',
					description: 'The UUID of the project to query',
				},
			},
			required: ['project_id'],
		},
	},
];

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

export async function handleEpicTool(
	name: string,
	args: Record<string, unknown> | undefined,
	userId: string
): Promise<ToolResult> {
	const projectId = args?.project_id as string;
	if (!projectId) {
		return {
			content: [{ type: 'text', text: 'project_id is required' }],
			isError: true,
		};
	}

	// Security: Verify the user has access to this project
	const hasAccess = await verifyProjectAccess(projectId, userId);
	if (!hasAccess) {
		return {
			content: [{ type: 'text', text: 'Access denied: You do not have permission to access this project' }],
			isError: true,
		};
	}

	try {
		switch (name) {
			case 'get_ready_epics':
				return await getReadyEpics(projectId);
			case 'get_epic':
				return await getEpic(projectId, args?.epic_id as string);
			case 'get_current_work':
				return await getCurrentWork(projectId);
			default:
				return {
					content: [{ type: 'text', text: `Unknown epic tool: ${name}` }],
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

async function getReadyEpics(projectId: string): Promise<ToolResult> {
	const epics = await getReadyEpicsService(projectId);

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify({ epics, count: epics.length }, null, 2),
			},
		],
	};
}

async function getEpic(projectId: string, epicId: string): Promise<ToolResult> {
	if (!epicId) {
		return {
			content: [{ type: 'text', text: 'epic_id is required' }],
			isError: true,
		};
	}

	const epic = await getEpicWithDetails(projectId, epicId);

	if (!epic) {
		return {
			content: [{ type: 'text', text: 'Epic not found' }],
			isError: true,
		};
	}

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(epic, null, 2),
			},
		],
	};
}

async function getCurrentWork(projectId: string): Promise<ToolResult> {
	const result = await getCurrentWorkService(projectId);

	return {
		content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
	};
}
