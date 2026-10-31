/**
 * Tool annotations are how a client decides whether a call needs a prompt: Claude Code's
 * plan mode lets through only tools that say they are read-only. They are hints, never
 * enforcement (toolMinRole is that), but a wrong one either nags on every read or lets a
 * write through unasked.
 */

import { describe, it, expect } from 'vitest';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

import { toolMinRole, tools } from './index.ts';

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

/** Written out per tool, so a tool added without a line here fails. */
const EXPECTED: Record<string, ToolAnnotations> = {
	list_projects: { readOnlyHint: true, openWorldHint: false },
	get_items: { readOnlyHint: true, openWorldHint: false },
	create_item: WRITE,
	create_items: WRITE,
	// Its note appends to the activity log, so a repeat isn't a no-op.
	update_item: WRITE,
	delete_item: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
};

describe('tool annotations', () => {
	it('covers exactly the advertised tools', () => {
		expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(EXPECTED).sort());
	});

	it.each(tools.map((t) => [t.name, t] as const))('%s carries its expected hints', (name, tool) => {
		expect(tool.annotations).toEqual(EXPECTED[name]);
	});

	it.each(tools.map((t) => [t.name, t] as const))('%s is read-only exactly when a viewer can call it', (name, tool) => {
		expect(tool.annotations?.readOnlyHint).toBe(toolMinRole(name) === 'viewer');
	});
});
