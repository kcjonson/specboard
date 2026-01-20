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
 * Runs as an HTTP server using Hono with MCP Streamable HTTP transport.
 * Requires OAuth 2.1 Bearer token for /mcp endpoints.
 */

import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';
import { serve, type HttpBindings } from '@hono/node-server';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { installErrorHandlers, logRequest } from '@doc-platform/core';
import { mcpAuthMiddleware, type McpAuthVariables } from '@doc-platform/auth';

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

// Define bindings type for Hono with Node.js server
type Bindings = HttpBindings;
type Variables = McpAuthVariables;

// Create Hono app
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Request logging middleware
app.use('*', async (c, next) => {
	const start = Date.now();
	await next();
	// For MCP routes, the transport writes directly to c.env.outgoing,
	// so we need to get the status from there instead of c.res.status
	const status = c.env.outgoing.statusCode || c.res.status;
	logRequest({
		method: c.req.method,
		path: c.req.path,
		status,
		duration: Date.now() - start,
		ip: c.req.header('x-forwarded-for') || c.env.incoming.socket.remoteAddress || 'unknown',
		userAgent: c.req.header('user-agent'),
	});
});

// Health check endpoint - no auth required (ALB needs this)
app.get('/health', (c) => c.json({ status: 'ok' }));

// MCP endpoints - require OAuth Bearer token
app.use('/mcp', mcpAuthMiddleware());

// MCP POST - new session or existing session request
app.post('/mcp', async (c) => {
	const sessionId = c.req.header('mcp-session-id');

	// Access raw Node.js request/response for MCP transport
	const req = c.env.incoming;
	const res = c.env.outgoing;

	if (sessionId && transports.has(sessionId)) {
		// Existing session - route to existing transport
		const transport = transports.get(sessionId)!;
		await transport.handleRequest(req, res);
		// Response handled by transport, return empty response to Hono
		return new Response(null);
	}

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

	// Response handled by transport
	return new Response(null);
});

// MCP GET - existing session (SSE streaming)
app.get('/mcp', async (c) => {
	const sessionId = c.req.header('mcp-session-id');

	if (!sessionId || !transports.has(sessionId)) {
		return c.json({ error: 'Session ID required for GET requests' }, 400);
	}

	// Access raw Node.js request/response for MCP transport
	const req = c.env.incoming;
	const res = c.env.outgoing;

	const transport = transports.get(sessionId)!;
	await transport.handleRequest(req, res);

	// Response handled by transport
	return new Response(null);
});

// MCP DELETE - close session
app.delete('/mcp', async (c) => {
	const sessionId = c.req.header('mcp-session-id');

	if (!sessionId || !transports.has(sessionId)) {
		return c.json({ error: 'Session not found' }, 404);
	}

	const transport = transports.get(sessionId)!;
	await transport.close();
	transports.delete(sessionId);

	return c.json({ status: 'closed' });
});

// 404 for unknown paths
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Start the server
serve({ fetch: app.fetch, port }, () => {
	console.log(`doc-platform MCP server running on http://localhost:${port}`);
	console.log(`MCP endpoint: http://localhost:${port}/mcp`);
	console.log(`Health check: http://localhost:${port}/health`);
});
