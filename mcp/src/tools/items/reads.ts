/**
 * Read handlers for work item MCP tools.
 *
 * Handles: get_ready_epics, get_epic, get_current_work
 */

import {
	getReadyEpics as getReadyEpicsService,
	getEpicWithDetails,
	getCurrentWork as getCurrentWorkService,
	type EpicType,
} from '@specboard/db';

import type { ToolResult } from './index.ts';

export async function getReadyEpics(projectId: string, itemType?: EpicType): Promise<ToolResult> {
	const epics = await getReadyEpicsService(projectId, itemType);

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify({ epics, count: epics.length }, null, 2),
			},
		],
	};
}

export async function getEpic(projectId: string, epicId: string): Promise<ToolResult> {
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

export async function getCurrentWork(projectId: string): Promise<ToolResult> {
	const result = await getCurrentWorkService(projectId);

	return {
		content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
	};
}
