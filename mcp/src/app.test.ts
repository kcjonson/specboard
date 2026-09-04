/**
 * MCP app tests — the stateless request path: session id minting and echo,
 * clientInfo capture, provenance actor construction, and the non-POST answers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { McpTokenPayload } from '@specboard/auth';

const state = vi.hoisted(() => ({
	token: {} as McpTokenPayload,
	servers: [] as Array<{ handlers: Map<unknown, (request: unknown) => Promise<unknown>>; close: () => Promise<void> }>,
	transports: [] as Array<{ handleRequest: ReturnType<typeof vi.fn> }>,
}));

vi.mock('@specboard/core', () => ({ logRequest: vi.fn() }));
vi.mock('@specboard/auth', () => ({
	mcpAuthMiddleware: () => async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
		c.set('mcpToken', state.token);
		await next();
	},
	recordMcpClientInfo: vi.fn(async () => {}),
}));
vi.mock('./tools/items/index.ts', () => ({ epicTools: [], handleEpicTool: vi.fn(async () => ({ content: [] })) }));
vi.mock('./tools/projects.ts', () => ({ projectTools: [], handleProjectTool: vi.fn(async () => ({ content: [] })) }));
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
	Server: class {
		handlers = new Map<unknown, (request: unknown) => Promise<unknown>>();
		constructor() {
			state.servers.push(this);
		}
		setRequestHandler(schema: unknown, handler: (request: unknown) => Promise<unknown>): void {
			this.handlers.set(schema, handler);
		}
		async connect(): Promise<void> {}
		async close(): Promise<void> {}
	},
}));
vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
	StreamableHTTPServerTransport: class {
		handleRequest = vi.fn(async (_req: unknown, res: FakeOutgoing) => {
			res.headersSent = true;
			res.statusCode = 200;
		});
		constructor() {
			state.transports.push(this);
		}
	},
}));

import { recordMcpClientInfo } from '@specboard/auth';
import { handleEpicTool } from './tools/items/index.ts';
import { createApp } from './app.ts';

interface FakeOutgoing {
	headers: Record<string, string>;
	headersSent: boolean;
	statusCode: number;
	setHeader: (name: string, value: string) => void;
	on: () => void;
}

function env(): { incoming: unknown; outgoing: FakeOutgoing } {
	const outgoing: FakeOutgoing = {
		headers: {},
		headersSent: false,
		statusCode: 200,
		setHeader(name, value) {
			this.headers[name] = value;
		},
		on() {},
	};
	return { incoming: { socket: { remoteAddress: '127.0.0.1' } }, outgoing };
}

const INITIALIZE = {
	jsonrpc: '2.0',
	id: 1,
	method: 'initialize',
	params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '2.0.0' } },
};
const TOOL_CALL = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_items', arguments: {} } };

async function post(body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; outgoing: FakeOutgoing }> {
	const e = env();
	const res = await createApp().request(
		'http://localhost/mcp',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
			body: typeof body === 'string' ? body : JSON.stringify(body),
		},
		e
	);
	return { status: res.status, outgoing: e.outgoing };
}

/** The provenance actor the last request would stamp on a tool call. */
async function lastActor(): Promise<Record<string, unknown>> {
	const server = state.servers.at(-1)!;
	await server.handlers.get(CallToolRequestSchema)!({ params: { name: 'get_items', arguments: {} } });
	const call = vi.mocked(handleEpicTool).mock.calls.at(-1)!;
	return call[2] as unknown as Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

beforeEach(() => {
	vi.clearAllMocks();
	state.servers.length = 0;
	state.transports.length = 0;
	state.token = {
		tokenId: 'token-1',
		userId: 'user-1',
		clientId: 'client-1',
		deviceName: 'kevin-mbp',
		scopes: [],
	};
});

describe('POST /mcp', () => {
	it('mints a session id on initialize, returns it in the header, and hands the transport the parsed body', async () => {
		const { outgoing } = await post(INITIALIZE);

		expect(outgoing.headers['mcp-session-id']).toMatch(UUID);
		const [, , parsedBody] = state.transports[0]!.handleRequest.mock.calls[0]!;
		expect(parsedBody).toEqual(INITIALIZE);
		expect(await lastActor()).toMatchObject({
			type: 'agent',
			userId: 'user-1',
			clientId: 'client-1',
			deviceName: 'kevin-mbp',
			sessionId: outgoing.headers['mcp-session-id'],
			client: { name: 'claude-code', version: '2.0.0' },
		});
	});

	it('records clientInfo on the token at initialize, but only when it changed', async () => {
		await post(INITIALIZE);
		expect(recordMcpClientInfo).toHaveBeenCalledWith('token-1', { name: 'claude-code', version: '2.0.0' });

		vi.mocked(recordMcpClientInfo).mockClear();
		state.token.client = { name: 'claude-code', version: '2.0.0' };
		await post(INITIALIZE);
		expect(recordMcpClientInfo).not.toHaveBeenCalled();
	});

	it('ignores initialize inside a batch (the transport rejects it) and mints nothing for it', async () => {
		const { outgoing } = await post([INITIALIZE, TOOL_CALL]);

		expect(outgoing.headers['mcp-session-id']).toBeUndefined();
		expect(recordMcpClientInfo).not.toHaveBeenCalled();
	});

	it('echoes a well-formed session id into the actor, lowercased, and never rejects one', async () => {
		state.token.client = { name: 'claude-code' };
		const { status } = await post(TOOL_CALL, { 'mcp-session-id': '6D229DA7-5266-4027-A5D1-C5E229C104C9' });

		expect(status).toBe(200);
		expect(await lastActor()).toMatchObject({
			sessionId: '6d229da7-5266-4027-a5d1-c5e229c104c9',
			client: { name: 'claude-code' },
		});
	});

	it('treats a malformed session id as absent rather than failing the request', async () => {
		const { status } = await post(TOOL_CALL, { 'mcp-session-id': 'stale-junk' });

		expect(status).toBe(200);
		expect(await lastActor()).not.toHaveProperty('sessionId');
	});

	it('returns the JSON-RPC parse error for a malformed body', async () => {
		const e = env();
		const res = await createApp().request(
			'http://localhost/mcp',
			{ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' },
			e
		);

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: { code: -32700 } });
		expect(state.transports).toHaveLength(0);
	});
});

describe('GET and DELETE /mcp', () => {
	it.each(['GET', 'DELETE'])('%s answers 405 with Allow: POST', async (method) => {
		const res = await createApp().request('http://localhost/mcp', { method, headers: { 'mcp-session-id': 'x' } }, env());

		expect(res.status).toBe(405);
		expect(res.headers.get('allow')).toBe('POST');
	});
});
