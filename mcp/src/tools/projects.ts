/**
 * Project-related MCP tools
 *
 * Discover projects and their IDs (list_projects). When a repo's committed .mcp.json sends an
 * X-Specboard-Project header (the project UUID), list_projects scopes to that one project.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getProjects as getProjectsService } from '@specboard/db';

export const projectTools: Tool[] = [
	{
		name: 'list_projects',
		description:
			'List the projects the user has access to, with epic counts by status. When the repo is bound (its committed .mcp.json sends an X-Specboard-Project header) only that one project is returned; otherwise all projects are returned.',
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
	userId: string,
	boundProjectId?: string
): Promise<ToolResult> {
	try {
		switch (name) {
			case 'list_projects':
				return await listProjects(userId, boundProjectId);
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

async function listProjects(userId: string, boundProjectId?: string): Promise<ToolResult> {
	const allProjects = await getProjectsService(userId);

	// When the repo is bound (committed .mcp.json X-Specboard-Project header), surface only that
	// project. A binding that resolves to no accessible project is a misconfiguration (wrong UUID,
	// or access lost) — surface it explicitly instead of a silent empty list.
	let projects = allProjects;
	if (boundProjectId) {
		projects = allProjects.filter((p) => p.id === boundProjectId);
		if (projects.length === 0) {
			return {
				content: [
					{
						type: 'text',
						text: "This repo's .mcp.json binding (X-Specboard-Project) points to a project that's unavailable — it may not exist, or your Specboard account may not have access to it. Verify the project UUID committed in .mcp.json and that your account has access to that project.",
					},
				],
				isError: true,
			};
		}
	}

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
							itemCounts: p.itemCounts,
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
