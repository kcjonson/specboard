#!/usr/bin/env node
/**
 * @doc-platform/mcp
 * MCP server for Claude Code integration with the planning system.
 *
 * This server provides tools for Claude to:
 * - Read epics and specs (human-defined work)
 * - Create and manage tasks (Claude's breakdown)
 * - Track progress and signal completion
 *
 * Runs as an HTTP server using MCP Streamable HTTP transport.
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { installErrorHandlers, logRequest } from '@doc-platform/core';

import { epicTools, handleEpicTool } from './tools/epics.ts';
import { taskTools, handleTaskTool } from './tools/tasks.ts';
import { progressTools, handleProgressTool } from './tools/progress.ts';

// Install global error handlers for uncaught exceptions
installErrorHandlers('mcp');

// Configuration
const port = parseInt(process.env.PORT || '3002', 10);

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

// Create MCP server factory - each session gets its own server instance
function createMcpServer(): Server {
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

	return server;
}

// Map to store transports by session ID
const transports = new Map<string, StreamableHTTPServerTransport>();

// Start the HTTP server
async function main(): Promise<void> {
	const httpServer = createServer(async (req, res) => {
		const start = Date.now();
		const url = new URL(req.url || '/', `http://localhost:${port}`);

		// Log request on response finish
		res.on('finish', () => {
			logRequest({
				method: req.method || 'GET',
				path: url.pathname,
				status: res.statusCode,
				duration: Date.now() - start,
				ip: (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress,
				userAgent: req.headers['user-agent'] as string,
			});
		});

		// Health check endpoint
		if (url.pathname === '/health' && req.method === 'GET') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ status: 'ok' }));
			return;
		}

		// MCP endpoint - handles both GET (SSE) and POST (JSON-RPC)
		if (url.pathname === '/mcp') {
			// Get or create session
			const sessionId = req.headers['mcp-session-id'] as string | undefined;

			if (sessionId && transports.has(sessionId)) {
				// Existing session - route to existing transport
				const transport = transports.get(sessionId)!;
				await transport.handleRequest(req, res);
			} else if (req.method === 'POST') {
				// New session - create transport and server
				const transport = new StreamableHTTPServerTransport({
					sessionIdGenerator: () => randomUUID(),
					onsessioninitialized: (newSessionId) => {
						transports.set(newSessionId, transport);
						console.log(`Session initialized: ${newSessionId}`);
					},
				});

				transport.onclose = () => {
					if (transport.sessionId) {
						transports.delete(transport.sessionId);
						console.log(`Session closed: ${transport.sessionId}`);
					}
				};

				// Create and connect MCP server
				const server = createMcpServer();
				await server.connect(transport);

				// Handle the request
				await transport.handleRequest(req, res);
			} else {
				// GET without session ID - not allowed
				res.writeHead(400, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'Session ID required for GET requests' }));
			}
			return;
		}

		// 404 for unknown paths
		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'Not found' }));
	});

	httpServer.listen(port, () => {
		console.log(`doc-platform MCP server running on http://localhost:${port}`);
		console.log(`MCP endpoint: http://localhost:${port}/mcp`);
	});
}

main().catch((error) => {
	console.error('Server failed to start:', error);
	process.exit(1);
});
