/**
 * Project-related MCP tools
 *
 * Discover projects and their slugs (list_projects). When a repo's committed .mcp.json sends an
 * X-Specboard-Project header (the project slug), list_projects scopes to that one project.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getProjects as getProjectsService } from '@specboard/db';

export const projectTools: Tool[] = [
	{
		name: 'list_projects',
		description:
			'List the projects the user has access to, with epic counts by status. Each project has a `slug` — the identifier every other tool takes as project_slug — and a `key`, which is only the prefix of that project\'s item keys (key "SB" means its items are SB-1, SB-2, ...). When the repo is bound (its committed .mcp.json sends an X-Specboard-Project header) only that one project is returned; otherwise all projects are returned.',
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
	boundProjectSlug?: string
): Promise<ToolResult> {
	try {
		switch (name) {
			case 'list_projects':
				return await listProjects(userId, boundProjectSlug);
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

async function listProjects(userId: string, boundProjectSlug?: string): Promise<ToolResult> {
	const allProjects = await getProjectsService(userId);

	// When the repo is bound (committed .mcp.json X-Specboard-Project header), surface only that
	// project. A binding that resolves to no accessible project is a misconfiguration (wrong slug,
	// or access lost) — surface it explicitly instead of a silent empty list.
	let projects = allProjects;
	if (boundProjectSlug) {
		projects = allProjects.filter((p) => p.slug === boundProjectSlug);
		if (projects.length === 0) {
			return {
				content: [
					{
						type: 'text',
						text: "This repo's .mcp.json binding (X-Specboard-Project) points to a project that's unavailable — it may not exist, or your Specboard account may not have access to it. Verify the project slug committed in .mcp.json and that your account has access to that project.",
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
							slug: p.slug,
							itemKeyPrefix: p.key,
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
