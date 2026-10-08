/**
 * MCP project addressing: parsing the X-Specboard-Project binding, expanding a bare slug to
 * the caller's own, resolving through the single resolveProjectAccess check, and holding
 * the result to the tool's minimum role. Which tool needs which role, run against seeded
 * memberships, is the role-matrix suite (src/role-matrix.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@specboard/db', async (importOriginal) => ({
	...(await importOriginal<typeof import('@specboard/db')>()),
	getUserSlug: vi.fn(),
	resolveProjectAccess: vi.fn(),
}));

import { getUserSlug, resolveProjectAccess, type ProjectAccess } from '@specboard/db';
import { parseProjectBinding, resolveToolProject, toolFailure, type ToolResult } from './project-ref.ts';

const USER = 'user-1';
const ROADMAP: ProjectAccess = {
	project: { id: 'proj-1', slug: 'roadmap', key: 'RM', ownerSlug: 'acme' },
	grantedRole: 'owner',
	effectiveRole: 'owner',
};

function errorText(result: ProjectAccess | ToolResult): string {
	expect('content' in result && result.isError).toBe(true);
	return (result as ToolResult).content[0]!.text;
}

beforeEach(() => {
	vi.mocked(getUserSlug).mockReset().mockResolvedValue('acme');
	// Only acme/roadmap exists for this caller.
	vi.mocked(resolveProjectAccess).mockReset().mockImplementation(async (owner, project) =>
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
		expect(await resolveToolProject('acme/roadmap', USER, undefined, 'viewer')).toEqual(ROADMAP);
		expect(resolveProjectAccess).toHaveBeenCalledWith('acme', 'roadmap', USER);
		expect(getUserSlug).not.toHaveBeenCalled();
	});

	it("expands a bare slug to the caller's own slug before resolving", async () => {
		expect(await resolveToolProject('roadmap', USER, undefined, 'viewer')).toEqual(ROADMAP);
		expect(getUserSlug).toHaveBeenCalledWith(USER);
		expect(resolveProjectAccess).toHaveBeenCalledWith('acme', 'roadmap', USER);
	});

	it('gives not-found for the right slug under the wrong owner', async () => {
		const text = errorText(await resolveToolProject('globex/roadmap', USER, undefined, 'viewer'));
		expect(text).toMatch(/doesn't exist, or your account doesn't have access/);
		expect(text).not.toContain('globex');
		expect(text).not.toMatch(/bare project slug/);
	});

	it('suggests the full form when a bare slug is not found', async () => {
		vi.mocked(getUserSlug).mockResolvedValue('initech');
		const text = errorText(await resolveToolProject('roadmap', USER, undefined, 'viewer'));
		expect(resolveProjectAccess).toHaveBeenCalledWith('initech', 'roadmap', USER);
		expect(text).toMatch(/full owner\/project form/);
	});

	it('gives not-found for a bare slug when the caller has no slug yet', async () => {
		vi.mocked(getUserSlug).mockResolvedValue(null);
		const text = errorText(await resolveToolProject('roadmap', USER, undefined, 'viewer'));
		expect(resolveProjectAccess).not.toHaveBeenCalled();
		expect(text).toMatch(/full owner\/project form/);
	});

	it('rejects a malformed project argument', async () => {
		const text = errorText(await resolveToolProject('SB-12/x/y', USER, undefined, 'viewer'));
		expect(text).toMatch(/must be owner\/project/);
		expect(resolveProjectAccess).not.toHaveBeenCalled();
	});

	it('requires a project when the repo is unbound', async () => {
		expect(errorText(await resolveToolProject(undefined, USER, undefined, 'viewer'))).toMatch(/project is required/);
	});

	it('falls back to the binding when no argument is given', async () => {
		const binding = parseProjectBinding('acme/roadmap');
		expect(await resolveToolProject(undefined, USER, binding, 'viewer')).toEqual(ROADMAP);
	});

	it('accepts an argument naming the bound project in the other form', async () => {
		expect(await resolveToolProject('acme/roadmap', USER, parseProjectBinding('roadmap'), 'viewer')).toEqual(ROADMAP);
		expect(await resolveToolProject('roadmap', USER, parseProjectBinding('acme/roadmap'), 'viewer')).toEqual(ROADMAP);
	});

	it('refuses an argument naming a different project than the binding', async () => {
		const text = errorText(await resolveToolProject('globex/roadmap', USER, parseProjectBinding('acme/roadmap'), 'viewer'));
		expect(text).toMatch(/bound to project acme\/roadmap/);
		expect(resolveProjectAccess).not.toHaveBeenCalled();
	});

	it('points at .mcp.json when the binding does not resolve', async () => {
		const text = errorText(await resolveToolProject(undefined, USER, parseProjectBinding('globex/roadmap'), 'viewer'));
		expect(text).toMatch(/\.mcp\.json binding/);
		expect(text).not.toMatch(/bare project slug/);
	});

	it('adds the full-form hint when a bare binding does not resolve', async () => {
		vi.mocked(getUserSlug).mockResolvedValue('initech');
		const text = errorText(await resolveToolProject(undefined, USER, parseProjectBinding('roadmap'), 'viewer'));
		expect(text).toMatch(/\.mcp\.json binding/);
		expect(text).toMatch(/full owner\/project form/);
	});

	it('tells a member below the tool\'s role why, naming the project', async () => {
		vi.mocked(resolveProjectAccess).mockResolvedValue({ ...ROADMAP, grantedRole: 'editor', effectiveRole: 'viewer' });
		const text = errorText(await resolveToolProject('acme/roadmap', USER, undefined, 'editor'));
		expect(text).toMatch(/Connect GitHub/);
		expect(text).toContain('acme/roadmap');

		vi.mocked(resolveProjectAccess).mockResolvedValue({ ...ROADMAP, grantedRole: 'viewer', effectiveRole: 'viewer' });
		expect(errorText(await resolveToolProject('acme/roadmap', USER, undefined, 'editor'))).toMatch(/view access/);
		expect(await resolveToolProject('acme/roadmap', USER, undefined, 'viewer')).toMatchObject({ grantedRole: 'viewer' });
	});

	it('reports an invalid binding on every call', async () => {
		const text = errorText(await resolveToolProject('acme/roadmap', USER, parseProjectBinding('a/b/c'), 'viewer'));
		expect(text).toMatch(/X-Specboard-Project: a\/b\/c/);
		expect(resolveProjectAccess).not.toHaveBeenCalled();
	});
});

describe('toolFailure', () => {
	it('logs what threw and tells the agent nothing of it', () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const cause = new Error('new row for relation "items" violates check constraint "items_status_check"');

		const result = toolFailure('update_item', cause);

		expect(result.isError).toBe(true);
		expect(result.content[0]!.text).not.toContain('items_status_check');
		expect(result.content[0]!.text).toContain('update_item failed');
		expect(log).toHaveBeenCalledWith('Tool update_item failed:', cause);
		log.mockRestore();
	});
});
