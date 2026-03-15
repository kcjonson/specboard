/**
 * Project-related MCP tools
 *
 * These tools allow Claude to:
 * - Discover projects and their IDs (list_projects)
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getProjects as getProjectsService } from '@specboard/db';

export const projectTools: Tool[] = [
	{
		name: 'list_projects',
		description:
			'List all projects the user has access to, with epic counts by status. Use this first to discover the project_id needed by all other tools.',
		inputSchema: {
			type: 'object',
			properties: {},
		},
	},
];

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

export async function handleProjectTool(
	name: string,
	_args: Record<string, unknown> | undefined,
	userId: string
): Promise<ToolResult> {
	try {
		switch (name) {
			case 'list_projects':
				return await listProjects(userId);
			default:
				return {
					content: [{ type: 'text', text: `Unknown project tool: ${name}` }],
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

async function listProjects(userId: string): Promise<ToolResult> {
	const projects = await getProjectsService(userId);

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(
					{
						projects: projects.map((p) => ({
							id: p.id,
							name: p.name,
							description: p.description,
							epicCounts: p.epicCounts,
						})),
						count: projects.length,
					},
					null,
					2
				),
			},
		],
	};
}
