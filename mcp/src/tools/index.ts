/**
 * The MCP tool registry: what tools/list advertises and how tools/call dispatches.
 *
 * Every tool declares the least role it needs on the project it addresses (viewer
 * reads, editor writes), and a call is dispatched only through that declaration, so a
 * tool listed without one can't be called. The role-matrix suite enumerates `tools`
 * and fails any tool toolMinRole has no answer for.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { AgentActor, ProjectRole } from '@specboard/db';

import { epicTools, epicToolMinRoles, handleEpicTool } from './items/index.ts';
import { projectTools, projectToolMinRoles, handleProjectTool } from './projects.ts';
import type { ProjectBinding, ToolResult } from './project-ref.ts';

export const tools: Tool[] = [...projectTools, ...epicTools];

/** The least role a tool needs, or undefined for a tool that declared none. */
export function toolMinRole(name: string): ProjectRole | undefined {
	if (Object.hasOwn(projectToolMinRoles, name)) return projectToolMinRoles[name];
	if (Object.hasOwn(epicToolMinRoles, name)) return epicToolMinRoles[name];
	return undefined;
}

export async function callTool(
	name: string,
	args: Record<string, unknown> | undefined,
	actor: AgentActor,
	binding: ProjectBinding
): Promise<ToolResult> {
	if (Object.hasOwn(projectToolMinRoles, name)) {
		return handleProjectTool(name, actor.userId, binding);
	}
	if (Object.hasOwn(epicToolMinRoles, name)) {
		return handleEpicTool(name, args, actor, binding);
	}
	return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
}
