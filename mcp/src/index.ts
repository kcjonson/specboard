#!/usr/bin/env node
/**
 * @specboard/mcp
 * MCP server for Claude Code integration with the planning system.
 *
 * This server provides tools for Claude to:
 * - Discover projects (list_projects)
 * - Read epics and specs (human-defined work)
 * - Create and manage items and tasks (unified CRUD)
 * - Track progress via sub-status and the item activity log
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

import { installErrorHandlers, logRequest } from '@specboard/core';
import { mcpAuthMiddleware, type McpAuthVariables } from '@specboard/auth';
import type { AgentActor } from '@specboard/db';

/**
 * Signal to @hono/node-server that the response was already written
 * directly to the Node.js ServerResponse by the MCP transport.
 * Without this, Hono's adapter tries to write headers again → ERR_HTTP_HEADERS_SENT.
 */
function transportHandledResponse(): Response {
	return new Response(null, {
		headers: { 'x-hono-already-sent': '1' },
	});
}

import { epicTools, handleEpicTool } from './tools/items/index.ts';
import { projectTools, handleProjectTool } from './tools/projects.ts';

// Install global error handlers for uncaught exceptions
installErrorHandlers('mcp');

// Configuration
const port = parseInt(process.env.PORT || '3002', 10);

// Tool routing configuration
const epicToolNames = new Set([
	'get_items',
	'create_item',
	'create_items',
	'update_item',
	'delete_item',
]);
const projectToolNames = new Set(['list_projects']);

// Server-level instructions returned at MCP initialize. Reaches every connected client (no plugin
// required). Kept under the ~2000-char client cap; critical content first. The Specboard plugin
// carries the full guided workflow; this is the always-on summary that points users to it.
const SERVER_INSTRUCTIONS = `You are connected to Specboard, the user's planning board: epics, tasks, and bugs (an epic is an optional container; tasks and bugs can nest under one or stand alone). Use these tools whenever the user is planning, picking up work, or tracking development status.

Tools: list_projects finds the project and its slug (a repo bound via .mcp.json X-Specboard-Project auto-selects one, and then project_slug can be omitted). A project is addressed by its slug ("specboard"); its items are addressed by key ("SB-345"). Never pass an item key or a prefix as project_slug. get_items reads work by status (ready/in_progress/blocked/in_review/done), by type, by search, or one item by item_key with include_children/include_notes (the item's activity log). create_item makes an epic, task, or bug (optionally under a parent_key); create_items bulk-creates children. update_item changes title/description/status/sub_status/branch_name/pr_url, and note appends an entry to the activity log (never overwrites); write one whenever you complete, block, or make a call worth remembering. Setting sub_status drives the board: scoping/in_development/pr_open -> in_progress, complete -> done.

Blockers and provenance: an item is blocked while any blocker is open; set them explicitly via the blockers array ({item_key} auto-clears when that item completes, {text} clears only when removed) — never infer them. status=ready excludes blocked items (include_blocked to override). Blocking an item needs a reason: pass note, or blockers saying what it waits on. When you file work discovered mid-task, pass discovered_from with the item you were working. Your session is recorded as each item's creator and, while an item is in_progress, as an active worker.

Role model: you can run the full loop (specs, epics, tasks, build, verify, merge, close); the human decides when to write specs themselves and when to review PRs. One hard rule: verify the work (tests green, behavior confirmed) before marking anything done. Keep status accurate; never leave a stale in_progress item.

For the full guided workflow, install the Specboard plugin: /plugin marketplace add https://specboard.io/claude then /plugin install specboard@specboard`;

// Session-to-user binding for security
// Prevents session hijacking by ensuring a session can only be used by the user who created it
interface SessionBinding {
	userId: string;
	transport: StreamableHTTPServerTransport;
}

/**
 * The authenticated agent session behind an MCP connection. userId/clientId/
 * deviceName come from the OAuth token; sessionId is filled in by the transport
 * once the session initializes (the object is captured by the tool-handler
 * closure, so later calls see it). This is the server-side source for the
 * AgentActor recorded as provenance — never client-supplied.
 */
interface McpAgentIdentity {
	userId: string;
	clientId: string;
	deviceName?: string;
	sessionId?: string;
}

// Create MCP server factory - each session gets its own server instance
// identity is derived from the auth middleware to ensure all operations are authorized
// and to record provenance. boundProjectSlug, when present, is the project slug from the
// X-Specboard-Project request header (set by a repo's committed .mcp.json) and scopes
// the session to that one project.
function createMcpServer(identity: McpAgentIdentity, boundProjectSlug?: string): Server {
	const userId = identity.userId;
	const server = new Server(
		{
			name: 'specboard',
			version: '0.2.0',
		},
		{
			capabilities: {
				tools: {},
			},
			instructions: SERVER_INSTRUCTIONS,
		}
	);

	// List all available tools
	server.setRequestHandler(ListToolsRequestSchema, async () => {
		return {
			tools: [...projectTools, ...epicTools],
		};
	});

	// Handle tool calls - pass the actor for authorization and provenance
	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args } = request.params;

		// Built per call: sessionId lands on the identity after initialize, and the
		// protocol clientInfo (agent name/version) is only known post-handshake.
		const clientInfo = server.getClientVersion();
		const actor: AgentActor = {
			type: 'agent',
			userId: identity.userId,
			clientId: identity.clientId,
			...(identity.deviceName ? { deviceName: identity.deviceName } : {}),
			...(identity.sessionId ? { sessionId: identity.sessionId } : {}),
			...(clientInfo ? { client: { name: clientInfo.name, version: clientInfo.version } } : {}),
		};

		try {
			// Route to appropriate handler using exact matching
			// Each handler receives the identity to verify project ownership
			if (projectToolNames.has(name)) {
				return await handleProjectTool(name, args, userId, boundProjectSlug);
			}

			if (epicToolNames.has(name)) {
				return await handleEpicTool(name, args, actor, boundProjectSlug);
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

// Map to store session bindings by session ID
// Each session is bound to the user who created it for security
const sessions = new Map<string, SessionBinding>();

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
app.get('/mcp/health', (c) => c.json({ status: 'ok' }));

// MCP endpoints - require OAuth Bearer token
app.use('/mcp', mcpAuthMiddleware({
	excludePaths: ['/mcp/health'],
}));

// MCP POST - new session or existing session request
app.post('/mcp', async (c) => {
	const sessionId = c.req.header('mcp-session-id');
	const mcpToken = c.get('mcpToken');
	const userId = mcpToken.userId;

	// Access raw Node.js request/response for MCP transport
	const req = c.env.incoming;
	const res = c.env.outgoing;

	if (sessionId && sessions.has(sessionId)) {
		const session = sessions.get(sessionId)!;

		// Security: Verify the requesting user matches the session owner
		if (session.userId !== userId) {
			return c.json({ error: 'Cannot access session: This session belongs to a different user' }, 403);
		}

		// Existing session - route to existing transport
		await session.transport.handleRequest(req, res);
		return transportHandledResponse();
	}

	// New session - create transport and server. The identity object is shared with
	// the server's tool-handler closure; sessionId is filled in on initialize so
	// provenance actors can carry it.
	const identity: McpAgentIdentity = {
		userId,
		clientId: mcpToken.clientId,
		deviceName: mcpToken.deviceName ?? undefined,
	};
	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: () => randomUUID(),
		onsessioninitialized: (newSessionId) => {
			// Bind the session to the authenticated user
			identity.sessionId = newSessionId;
			sessions.set(newSessionId, { userId, transport });
			console.log(`Session initialized: ${newSessionId} for user: ${userId}`);
		},
	});

	transport.onclose = () => {
		if (transport.sessionId) {
			sessions.delete(transport.sessionId);
			console.log(`Session closed: ${transport.sessionId}`);
		}
	};

	// Create and connect MCP server with the authenticated userId.
	// A repo's committed .mcp.json carries the project slug in this header; the server scopes
	// tools to that project (access is still gated per user when the slug is resolved). Trim +
	// lowercase to tolerate stray whitespace/casing; absent/blank means "unscoped".
	const boundProjectSlug = c.req.header('x-specboard-project')?.trim().toLowerCase() || undefined;
	const server = createMcpServer(identity, boundProjectSlug);
	await server.connect(transport);

	// Handle the request
	await transport.handleRequest(req, res);
	return transportHandledResponse();
});

// MCP GET - existing session (SSE streaming)
app.get('/mcp', async (c) => {
	const sessionId = c.req.header('mcp-session-id');
	const mcpToken = c.get('mcpToken');
	const userId = mcpToken.userId;

	if (!sessionId || !sessions.has(sessionId)) {
		return c.json({ error: 'Session ID required for GET requests' }, 400);
	}

	const session = sessions.get(sessionId)!;

	// Security: Verify the requesting user matches the session owner
	if (session.userId !== userId) {
		return c.json({ error: 'Cannot access session: This session belongs to a different user' }, 403);
	}

	// Access raw Node.js request/response for MCP transport
	const req = c.env.incoming;
	const res = c.env.outgoing;

	await session.transport.handleRequest(req, res);
	return transportHandledResponse();
});

// MCP DELETE - close session
app.delete('/mcp', async (c) => {
	const sessionId = c.req.header('mcp-session-id');
	const mcpToken = c.get('mcpToken');
	const userId = mcpToken.userId;

	if (!sessionId || !sessions.has(sessionId)) {
		return c.json({ error: 'Session not found' }, 404);
	}

	const session = sessions.get(sessionId)!;

	// Security: Verify the requesting user matches the session owner
	if (session.userId !== userId) {
		return c.json({ error: 'Cannot close session: This session belongs to a different user' }, 403);
	}

	await session.transport.close();
	sessions.delete(sessionId);

	return c.json({ status: 'closed' });
});

// 404 for unknown paths
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Start the server
serve({ fetch: app.fetch, port }, () => {
	console.log(`Specboard MCP server running on http://localhost:${port}`);
	console.log(`MCP endpoint: http://localhost:${port}/mcp`);
	console.log(`Health check: http://localhost:${port}/mcp/health`);
});
