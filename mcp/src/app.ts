/**
 * The MCP HTTP app: OAuth-gated Streamable HTTP in stateless mode. Every POST is
 * self-contained, so a deploy (or a second task) never strands a connected client.
 * A session id is still minted at initialize, but only as a correlation token the
 * client echoes back so provenance can trace work to one agent session; the server
 * holds no transport state for it and never rejects a request over it. All tools
 * are request/response, so the standalone SSE stream that real sessions would
 * enable is not needed.
 */

import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';
import type { HttpBindings } from '@hono/node-server';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';

import { logRequest } from '@specboard/core';
import { mcpAuthMiddleware, recordMcpClientInfo, sanitizeMcpClientInfo, type McpAuthVariables, type McpClientInfo } from '@specboard/auth';
import type { AgentActor } from '@specboard/db';

import { epicTools, handleEpicTool } from './tools/items/index.ts';
import { projectTools, handleProjectTool } from './tools/projects.ts';
import { parseProjectBinding, type ProjectBinding } from './tools/project-ref.ts';

const epicToolNames = new Set([
	'get_items',
	'create_item',
	'create_items',
	'update_item',
	'delete_item',
]);
const projectToolNames = new Set(['list_projects']);

// Server-level instructions returned at MCP initialize. Reaches every connected client (no plugin
// required). Claude Code truncates server instructions past 2,048 characters by default
// (code.claude.com/docs/en/mcp, "For MCP server authors"), silently dropping the tail, so critical
// content goes first and app.test.ts holds the length under that limit. The Specboard plugin carries
// the full guided workflow; this is the always-on summary that points users to it.
const SERVER_INSTRUCTIONS = `You are connected to Specboard, the user's planning board of epics, tasks, and bugs. Use it whenever the user plans, picks up, or tracks work.

Tools: list_projects finds the project ref (omit project when .mcp.json binds the repo via X-Specboard-Project). Projects are addressed as owner/project ("acme/roadmap"; a bare "roadmap" means your own), items by key ("SB-345"); never pass an item key or prefix as project. get_items lists by status, type, or search, or reads one item_key (with include_children/include_notes). create_item makes an epic, task, or bug (optionally under parent_key); create_items bulk-creates children. update_item edits an item, including branch_name/pr_url; its note appends to the activity log (never overwrites), so write one when you complete, block, or make a call worth remembering. sub_status drives the board: scoping/in_development/pr_open -> in_progress, complete -> done.

A checklist is scratch todos on one item; child items are tracked work. update_item's checklist sets it up, checklist_status ticks entries off by id.

Blockers: an item is blocked while any is open. Set them explicitly ({item_key} auto-clears when that item completes, {text} only when removed); never infer them. status=ready excludes blocked items unless include_blocked. Blocking needs a reason: a note, or blockers. When filing work found mid-task, pass discovered_from with the item you were on.

You can run the full loop (specs, epics, tasks, build, verify, merge, close); the human decides when to write specs or review PRs. One hard rule: verify the work (tests green, behavior confirmed) before marking anything done. Keep status accurate: your session is recorded as each item's creator, and as the worker of an in_progress one, so never leave one stale.

For the full workflow, install the Specboard plugin: /plugin marketplace add https://specboard.io/claude then /plugin install specboard@specboard`;

// Same code and shape as the SDK transport's own parse error; the body has to be
// parsed here, ahead of the transport, so initialize can be inspected.
const PARSE_ERROR = { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: invalid JSON body' }, id: null };

// Only ids of our own minting shape are echoed into provenance; anything else is
// treated as absent rather than stored.
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Create the MCP server for one request. The transport is stateless, so every
 * request gets a fresh Server; the actor stamped on provenance comes entirely from
 * the OAuth token (user, client id, device name, the protocol clientInfo the token
 * holder sent at initialize) plus the echoed session id, never from tool arguments.
 * binding, when present, is the project from the X-Specboard-Project request header
 * (set by a repo's committed .mcp.json) and scopes tools to it.
 */
function createMcpServer(actor: AgentActor, binding: ProjectBinding): Server {
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
				return await handleProjectTool(name, actor.userId, binding);
			}

			if (epicToolNames.has(name)) {
				return await handleEpicTool(name, args, actor, binding);
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

// Whether the body is exactly one initialize request. A batch is left to the
// transport, which rejects initialize inside one, so nothing is minted or recorded
// for a request that will fail.
function isLoneInitialize(body: unknown): body is { params: { clientInfo: McpClientInfo } } {
	return !Array.isArray(body) && isInitializeRequest(body);
}

function sameClient(a: McpClientInfo | undefined, b: McpClientInfo): boolean {
	return a?.name === b.name && a.version === b.version;
}

export function createApp(): Hono<{ Bindings: HttpBindings; Variables: McpAuthVariables }> {
	const app = new Hono<{ Bindings: HttpBindings; Variables: McpAuthVariables }>();

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

	app.use('/mcp', mcpAuthMiddleware({
		excludePaths: ['/mcp/health'],
	}));

	// Every POST is self-contained. The mcp-session-id header is a correlation token:
	// minted here on initialize, echoed by the client afterwards, never a reason to
	// reject, so one issued before a deploy keeps working.
	app.post('/mcp', async (c) => {
		const mcpToken = c.get('mcpToken');
		const req = c.env.incoming;
		const res = c.env.outgoing;

		// Parsed here (once) so the initialize handshake can be inspected before the
		// transport consumes it; the transport is handed the parsed body.
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json(PARSE_ERROR, 400);
		}

		let client = mcpToken.client;
		let sessionId: string | undefined;
		if (isLoneInitialize(body)) {
			// initialize is the only message that carries clientInfo, and with no session
			// the server answering later tool calls never sees it. Persist it on the token
			// so provenance actors keep naming the agent software. Sanitized here, once, so
			// the value compared, stamped, and stored is the same one the token row will
			// hand back. Tracking data, so like last_used_at it never fails the request.
			const clientInfo = sanitizeMcpClientInfo(body.params.clientInfo);
			if (clientInfo && !sameClient(client, clientInfo)) {
				recordMcpClientInfo(mcpToken.tokenId, clientInfo).catch((err: unknown) => {
					console.error('[mcp] Failed to record client info for token', mcpToken.tokenId, err);
				});
			}
			client = clientInfo ?? client;
			sessionId = randomUUID();
			// Node merges headers set here into the writeHead(status, headers) call the
			// transport makes later, and in stateless mode the SDK never sets this header
			// itself, so nothing overwrites it.
			res.setHeader('mcp-session-id', sessionId);
		} else {
			const echoed = c.req.header('mcp-session-id');
			sessionId = echoed && SESSION_ID_PATTERN.test(echoed) ? echoed.toLowerCase() : undefined;
		}

		const actor: AgentActor = {
			type: 'agent',
			userId: mcpToken.userId,
			clientId: mcpToken.clientId,
			deviceName: mcpToken.deviceName,
			...(sessionId ? { sessionId } : {}),
			...(client ? { client } : {}),
		};

		// A repo's committed .mcp.json carries owner/project (or a bare slug for the caller's own)
		// in this header; the server scopes tools to that project (access is still gated per user
		// when it is resolved). Absent/blank means "unscoped".
		const binding = parseProjectBinding(c.req.header('x-specboard-project'));

		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
		const server = createMcpServer(actor, binding);
		// Closing the server closes its transport too.
		res.on('close', () => {
			void server.close();
		});
		await server.connect(transport);
		await transport.handleRequest(req, res, body);
		return RESPONSE_ALREADY_SENT;
	});

	// No sessions means no standalone SSE stream to open and nothing to terminate; the
	// Streamable HTTP spec's answer for both is 405.
	app.on(['GET', 'DELETE'], '/mcp', (c) => c.json({ error: 'Method not allowed' }, 405, { Allow: 'POST' }));

	app.notFound((c) => c.json({ error: 'Not found' }, 404));

	return app;
}
