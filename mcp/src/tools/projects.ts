/**
 * Project-related MCP tools
 *
 * Discover projects and their refs (list_projects). When a repo's committed .mcp.json sends an
 * X-Specboard-Project header (owner/project, or a bare slug for the caller's own), list_projects
 * scopes to that one project.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getProjects as getProjectsService } from '@specboard/db';
import { formatProjectRef } from '@specboard/core/identifiers';
import {
	bindingUnavailableResult,
	expandProjectRef,
	invalidBindingResult,
	type ProjectBinding,
	type ToolResult,
} from './project-ref.ts';

export const projectTools: Tool[] = [
	{
		name: 'list_projects',
		description:
			'List the projects the user has access to, with epic counts by status. Each project has a `ref` (owner/project, e.g. "acme/roadmap"), the identifier every other tool takes as `project`, built from its `owner` and `slug`; and a `key`, which is only the prefix of that project\'s item keys (key "SB" means its items are SB-1, SB-2, ...). When the repo is bound (its committed .mcp.json sends an X-Specboard-Project header) only that one project is returned; otherwise all projects are returned.',
		inputSchema: {
			type: 'object',
			properties: {},
		},
	},
];

export async function handleProjectTool(
	name: string,
	userId: string,
	binding: ProjectBinding
): Promise<ToolResult> {
	try {
		switch (name) {
			case 'list_projects':
				return await listProjects(userId, binding);
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

async function listProjects(userId: string, binding: ProjectBinding): Promise<ToolResult> {
	if (binding && 'invalid' in binding) return invalidBindingResult(binding);

	let projects = await getProjectsService(userId);

	// When the repo is bound (committed .mcp.json X-Specboard-Project header), surface only that
	// project. A binding that resolves to no accessible project is a misconfiguration (wrong
	// address, or access lost) — surface it explicitly instead of a silent empty list.
	if (binding) {
		const bound = await expandProjectRef(binding.ref, userId);
		projects = bound
			? projects.filter((p) => p.ownerSlug === bound.owner && p.slug === bound.project)
			: [];
		if (projects.length === 0) {
			return bindingUnavailableResult(binding.ref.owner === null);
		}
	}

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(
					{
						projects: projects.map((p) => ({
							ref: formatProjectRef(p.ownerSlug, p.slug),
							owner: p.ownerSlug,
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
