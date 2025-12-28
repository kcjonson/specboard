#!/usr/bin/env node
/**
 * @doc-platform/mcp
 * MCP server for Claude Code integration with the planning system.
 *
 * This server provides tools for Claude to:
 * - Read epics and specs (human-defined work)
 * - Create and manage tasks (Claude's breakdown)
 * - Track progress and signal completion
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { epicTools, handleEpicTool } from './tools/epics.js';
import { taskTools, handleTaskTool } from './tools/tasks.js';
import { progressTools, handleProgressTool } from './tools/progress.js';

const server = new Server(
	{
		name: 'doc-platform',
		version: '0.1.0',
	},
	{
		capabilities: {
			tools: {},
		},
	}
);

// List all available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
	return {
		tools: [...epicTools, ...taskTools, ...progressTools],
	};
});

// Tool routing configuration
const epicToolNames = new Set(['get_ready_epics', 'get_epic', 'get_current_work']);
const taskToolNames = new Set([
	'create_task',
	'create_tasks',
	'update_task',
	'start_task',
	'complete_task',
	'block_task',
	'unblock_task',
]);
const progressToolNames = new Set(['add_progress_note', 'signal_ready_for_review']);

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name, arguments: args } = request.params;

	try {
		// Route to appropriate handler using exact matching
		if (epicToolNames.has(name)) {
			return await handleEpicTool(name, args);
		}

		if (taskToolNames.has(name)) {
			return await handleTaskTool(name, args);
		}

		if (progressToolNames.has(name)) {
			return await handleProgressTool(name, args);
		}

		return {
			content: [
				{
					type: 'text',
					text: `Unknown tool: ${name}`,
				},
			],
			isError: true,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		console.error(`Tool ${name} failed:`, error);
		return {
			content: [
				{
					type: 'text',
					text: `Error: ${message}`,
				},
			],
			isError: true,
		};
	}
});

// Start the server
async function main(): Promise<void> {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error('doc-platform MCP server running on stdio');
}

main().catch((error) => {
	console.error('Server failed to start:', error);
	process.exit(1);
});
