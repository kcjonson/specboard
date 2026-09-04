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
 * Runs as an HTTP server using Hono with the MCP Streamable HTTP transport (see
 * app.ts). Requires an OAuth 2.1 Bearer token for /mcp endpoints.
 */

import { serve } from '@hono/node-server';

import { installErrorHandlers } from '@specboard/core';

import { createApp } from './app.ts';

installErrorHandlers('mcp');

const port = parseInt(process.env.PORT || '3002', 10);

serve({ fetch: createApp().fetch, port }, () => {
	console.log(`Specboard MCP server running on http://localhost:${port}`);
	console.log(`MCP endpoint: http://localhost:${port}/mcp`);
	console.log(`Health check: http://localhost:${port}/mcp/health`);
});
