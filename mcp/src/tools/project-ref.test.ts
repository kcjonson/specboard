/**
 * MCP project addressing: parsing the X-Specboard-Project binding, expanding a bare slug to
 * the caller's own, and resolving through the single resolveProject check.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@specboard/db', () => ({
	getUserSlug: vi.fn(),
	resolveProject: vi.fn(),
}));

import { getUserSlug, resolveProject, type ResolvedProject } from '@specboard/db';
import { parseProjectBinding, resolveToolProject, type ToolResult } from './project-ref.ts';

const USER = 'user-1';
const ROADMAP: ResolvedProject = { id: 'proj-1', slug: 'roadmap', key: 'RM', ownerSlug: 'acme' };

function errorText(result: ResolvedProject | ToolResult): string {
	expect('content' in result && result.isError).toBe(true);
	return (result as ToolResult).content[0]!.text;
}

beforeEach(() => {
	vi.mocked(getUserSlug).mockReset().mockResolvedValue('acme');
	// Only acme/roadmap exists for this caller.
	vi.mocked(resolveProject).mockReset().mockImplementation(async (owner, project) =>
		owner === 'acme' && project === 'roadmap' ? ROADMAP : null
	);
});

describe('parseProjectBinding', () => {
	it('treats an absent or blank header as unscoped', () => {
		expect(parseProjectBinding(undefined)).toBeUndefined();
		expect(parseProjectBinding('   ')).toBeUndefined();
	});

	it('parses owner/project, trimmed and lowercased', () => {
		expect(parseProjectBinding(' Acme/Roadmap ')).toEqual({ ref: { owner: 'acme', project: 'roadmap' } });
	});

	it('parses a bare slug with no owner', () => {
		expect(parseProjectBinding('roadmap')).toEqual({ ref: { owner: null, project: 'roadmap' } });
	});

	it('keeps an unparseable header as invalid rather than dropping it', () => {
		expect(parseProjectBinding('acme/road/map')).toEqual({ invalid: 'acme/road/map' });
		expect(parseProjectBinding('acme/')).toEqual({ invalid: 'acme/' });
	});
});

describe('resolveToolProject', () => {
	it('resolves a full owner/project argument', async () => {
		expect(await resolveToolProject('acme/roadmap', USER, undefined)).toEqual(ROADMAP);
		expect(resolveProject).toHaveBeenCalledWith('acme', 'roadmap', USER);
		expect(getUserSlug).not.toHaveBeenCalled();
	});

	it("expands a bare slug to the caller's own slug before resolving", async () => {
		expect(await resolveToolProject('roadmap', USER, undefined)).toEqual(ROADMAP);
		expect(getUserSlug).toHaveBeenCalledWith(USER);
		expect(resolveProject).toHaveBeenCalledWith('acme', 'roadmap', USER);
	});

	it('gives not-found for the right slug under the wrong owner', async () => {
		const text = errorText(await resolveToolProject('globex/roadmap', USER, undefined));
		expect(text).toMatch(/doesn't exist, or your account doesn't have access/);
		expect(text).not.toContain('globex');
		expect(text).not.toMatch(/bare project slug/);
	});

	it('suggests the full form when a bare slug is not found', async () => {
		vi.mocked(getUserSlug).mockResolvedValue('initech');
		const text = errorText(await resolveToolProject('roadmap', USER, undefined));
		expect(resolveProject).toHaveBeenCalledWith('initech', 'roadmap', USER);
		expect(text).toMatch(/full owner\/project form/);
	});

	it('gives not-found for a bare slug when the caller has no slug yet', async () => {
		vi.mocked(getUserSlug).mockResolvedValue(null);
		const text = errorText(await resolveToolProject('roadmap', USER, undefined));
		expect(resolveProject).not.toHaveBeenCalled();
		expect(text).toMatch(/full owner\/project form/);
	});

	it('rejects a malformed project argument', async () => {
		const text = errorText(await resolveToolProject('SB-12/x/y', USER, undefined));
		expect(text).toMatch(/must be owner\/project/);
		expect(resolveProject).not.toHaveBeenCalled();
	});

	it('requires a project when the repo is unbound', async () => {
		expect(errorText(await resolveToolProject(undefined, USER, undefined))).toMatch(/project is required/);
	});

	it('falls back to the binding when no argument is given', async () => {
		const binding = parseProjectBinding('acme/roadmap');
		expect(await resolveToolProject(undefined, USER, binding)).toEqual(ROADMAP);
	});

	it('accepts an argument naming the bound project in the other form', async () => {
		expect(await resolveToolProject('acme/roadmap', USER, parseProjectBinding('roadmap'))).toEqual(ROADMAP);
		expect(await resolveToolProject('roadmap', USER, parseProjectBinding('acme/roadmap'))).toEqual(ROADMAP);
	});

	it('refuses an argument naming a different project than the binding', async () => {
		const text = errorText(await resolveToolProject('globex/roadmap', USER, parseProjectBinding('acme/roadmap')));
		expect(text).toMatch(/bound to project acme\/roadmap/);
		expect(resolveProject).not.toHaveBeenCalled();
	});

	it('points at .mcp.json when the binding does not resolve', async () => {
		const text = errorText(await resolveToolProject(undefined, USER, parseProjectBinding('globex/roadmap')));
		expect(text).toMatch(/\.mcp\.json binding/);
		expect(text).not.toMatch(/bare project slug/);
	});

	it('adds the full-form hint when a bare binding does not resolve', async () => {
		vi.mocked(getUserSlug).mockResolvedValue('initech');
		const text = errorText(await resolveToolProject(undefined, USER, parseProjectBinding('roadmap')));
		expect(text).toMatch(/\.mcp\.json binding/);
		expect(text).toMatch(/full owner\/project form/);
	});

	it('reports an invalid binding on every call', async () => {
		const text = errorText(await resolveToolProject('acme/roadmap', USER, parseProjectBinding('a/b/c')));
		expect(text).toMatch(/X-Specboard-Project: a\/b\/c/);
		expect(resolveProject).not.toHaveBeenCalled();
	});
});
