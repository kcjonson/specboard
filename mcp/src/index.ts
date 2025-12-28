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

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name, arguments: args } = request.params;

	try {
		// Route to appropriate handler
		if (name.startsWith('get_ready_epics') || name.startsWith('get_epic') || name.startsWith('get_current_work')) {
			return await handleEpicTool(name, args);
		}

		if (
			name.startsWith('create_task') ||
			name.startsWith('update_task') ||
			name.startsWith('start_task') ||
			name.startsWith('complete_task') ||
			name.startsWith('block_task') ||
			name.startsWith('unblock_task')
		) {
			return await handleTaskTool(name, args);
		}

		if (name.startsWith('add_progress_note') || name.startsWith('signal_ready_for_review')) {
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
