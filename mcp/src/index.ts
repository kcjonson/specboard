#!/usr/bin/env node
/**
 * @specboard/mcp
 * MCP server for Claude Code integration with the planning system.
 *
 * This server provides tools for Claude to:
 * - Discover projects (list_projects)
 * - Read epics and specs (human-defined work)
 * - Create and manage items and tasks (unified CRUD)
 * - Track progress via sub-status and notes
 *
 * Runs as an HTTP server using Hono with the MCP Streamable HTTP transport in
 * stateless mode: every POST is self-contained, and a deploy (or a second task)
 * never strands a connected client. A session id is still minted at initialize,
 * but only as a correlation token the client echoes back so provenance can trace
 * work to one agent session; the server stores nothing for it and never rejects
 * one. All tools are request/response, so the standalone SSE stream that real
 * sessions would enable is not needed. Requires an OAuth 2.1 Bearer token for
 * /mcp endpoints.
 */

import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';
import { serve, type HttpBindings } from '@hono/node-server';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';

import { installErrorHandlers, logRequest } from '@specboard/core';
import { mcpAuthMiddleware, recordMcpClientInfo, type McpAuthVariables, type McpClientInfo } from '@specboard/auth';
import type { AgentActor } from '@specboard/db';

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

Tools: list_projects finds the project and its slug (a repo bound via .mcp.json X-Specboard-Project auto-selects one, and then project_slug can be omitted). A project is addressed by its slug ("specboard"); its items are addressed by key ("SB-345"). Never pass an item key or a prefix as project_slug. get_items reads work by status (ready/in_progress/blocked/in_review/done), by type, by search, or one item by item_key with include_children/include_notes. create_item makes an epic, task, or bug (optionally under a parent_key); create_items bulk-creates children. update_item changes title/description/status/sub_status/notes/branch_name/pr_url. Setting sub_status drives the board: scoping/in_development/pr_open -> in_progress, complete -> done.

Blockers and provenance: an item is blocked while any blocker is open; set them explicitly via the blockers array ({item_key} auto-clears when that item completes, {text} clears only when removed) — never infer them. status=ready excludes blocked items (include_blocked to override). When you file work discovered mid-task, pass discovered_from with the item you were working. Your session is recorded as each item's creator and, while an item is in_progress, as an active worker.

Role model: you can run the full loop (specs, epics, tasks, build, verify, merge, close); the human decides when to write specs themselves and when to review PRs. One hard rule: verify the work (tests green, behavior confirmed) before marking anything done. Keep status accurate; never leave a stale in_progress item.

For the full guided workflow, install the Specboard plugin: /plugin marketplace add https://specboard.io/claude then /plugin install specboard@specboard`;

// Same body the SDK transport emits for a malformed POST.
const PARSE_ERROR = { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: invalid JSON body' }, id: null };

// Only ids of our own minting shape are echoed into provenance; anything else is
// treated as absent rather than stored.
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Create the MCP server for one request. The transport is stateless, so every
 * request gets a fresh Server; the actor stamped on provenance comes entirely from
 * the OAuth token (user, client id, device name, and the protocol clientInfo the
 * token holder sent at initialize), never from client-supplied payload fields.
 * boundProjectSlug, when present, is the project slug from the X-Specboard-Project
 * request header (set by a repo's committed .mcp.json) and scopes tools to it.
 */
function createMcpServer(actor: AgentActor, boundProjectSlug?: string): Server {
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

	server.setRequestHandler(ListToolsRequestSchema, async () => {
		return {
			tools: [...projectTools, ...epicTools],
		};
	});

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args } = request.params;

		try {
			if (projectToolNames.has(name)) {
				return await handleProjectTool(name, args, actor.userId, boundProjectSlug);
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

/** The protocol clientInfo carried by an initialize request, if the body holds one. */
function initializeClientInfo(body: unknown): McpClientInfo | undefined {
	const messages = Array.isArray(body) ? body : [body];
	for (const message of messages) {
		if (isInitializeRequest(message)) {
			const { name, version } = message.params.clientInfo;
			return { name, ...(version ? { version } : {}) };
		}
	}
	return undefined;
}

// Define bindings type for Hono with Node.js server
type Bindings = HttpBindings;
type Variables = McpAuthVariables;

// Create Hono app
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Request logging middleware
app.use('*', async (c, next) => {
	const start = Date.now();
	await next();
	// The MCP transport writes directly to c.env.outgoing; Node defaults statusCode to 200,
	// so only trust it once headers have actually been sent.
	const status = c.env.outgoing.headersSent ? c.env.outgoing.statusCode : c.res.status;
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

// MCP POST - every request is self-contained. The mcp-session-id header is a
// correlation token: minted here on initialize, echoed by the client afterwards,
// never validated, so one issued before a deploy keeps working.
app.post('/mcp', async (c) => {
	const mcpToken = c.get('mcpToken');

	// Parsed here (once) so the initialize handshake can be inspected before the
	// transport consumes it; the transport is handed the parsed body.
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json(PARSE_ERROR, 400);
	}

	// initialize is the only message that carries clientInfo, and with no session the
	// server answering later tool calls never sees it. Persist it on the token so
	// provenance actors keep naming the agent software.
	const clientInfo = initializeClientInfo(body);
	if (clientInfo) {
		await recordMcpClientInfo(mcpToken.tokenId, clientInfo);
		mcpToken.client = clientInfo;
	}

	const req = c.env.incoming;
	const res = c.env.outgoing;

	let sessionId: string | undefined;
	if (clientInfo) {
		sessionId = randomUUID();
		res.setHeader('mcp-session-id', sessionId);
	} else {
		const echoed = c.req.header('mcp-session-id');
		sessionId = echoed && SESSION_ID_PATTERN.test(echoed) ? echoed.toLowerCase() : undefined;
	}

	const actor: AgentActor = {
		type: 'agent',
		userId: mcpToken.userId,
		clientId: mcpToken.clientId,
		...(mcpToken.deviceName ? { deviceName: mcpToken.deviceName } : {}),
		...(sessionId ? { sessionId } : {}),
		...(mcpToken.client ? { client: mcpToken.client } : {}),
	};

	// A repo's committed .mcp.json carries the project slug in this header; the server scopes
	// tools to that project (access is still gated per user when the slug is resolved). Trim +
	// lowercase to tolerate stray whitespace/casing; absent/blank means "unscoped".
	const boundProjectSlug = c.req.header('x-specboard-project')?.trim().toLowerCase() || undefined;

	const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
	const server = createMcpServer(actor, boundProjectSlug);
	res.on('close', () => {
		void transport.close();
		void server.close();
	});
	await server.connect(transport);
	await transport.handleRequest(req, res, body);
	return RESPONSE_ALREADY_SENT;
});

// No sessions means no standalone SSE stream to open and nothing to terminate; the
// Streamable HTTP spec's answer for both is 405.
app.on(['GET', 'DELETE'], '/mcp', (c) => c.json({ error: 'Method not allowed' }, 405, { Allow: 'POST' }));

// 404 for unknown paths
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Start the server
serve({ fetch: app.fetch, port }, () => {
	console.log(`Specboard MCP server running on http://localhost:${port}`);
	console.log(`MCP endpoint: http://localhost:${port}/mcp`);
	console.log(`Health check: http://localhost:${port}/mcp/health`);
});
