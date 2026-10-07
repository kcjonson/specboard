/**
 * The member handlers' own rules, which the role matrix (handlers stubbed) can't see:
 * the owner isn't a membership, so naming them or having them leave is a 409; a role
 * must be editor or viewer; a slug that names no member is a 404. Who may call each
 * route is the gate's job and covered there. Here a stand-in authorizes the caller.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { ProjectAccess, ProjectRole } from '@specboard/db';

vi.mock('@specboard/db', () => ({
	listProjectMembers: vi.fn(async () => []),
	setProjectMemberRole: vi.fn(),
	removeProjectMember: vi.fn(),
	leaveProject: vi.fn(async () => {}),
}));

import { leaveProject, removeProjectMember, setProjectMemberRole } from '@specboard/db';
import { handleLeaveProject, handleRemoveMember, handleUpdateMember } from './members.ts';
import type { AppVariables } from '../project-access.ts';

const PROJECT = { id: 'proj-1', slug: 'roadmap', key: 'RM', ownerSlug: 'acme' };

function createApp(grantedRole: ProjectRole): Hono<{ Variables: AppVariables }> {
	const access: ProjectAccess = { project: PROJECT, grantedRole, effectiveRole: grantedRole };
	const app = new Hono<{ Variables: AppVariables }>();
	app.use('*', async (context, next) => {
		context.set('access', access);
		context.set('project', PROJECT);
		context.set('userId', 'user-1');
		await next();
	});
	app.put('/api/projects/:owner/:project/members/:member', handleUpdateMember);
	app.delete('/api/projects/:owner/:project/members/:member', handleRemoveMember);
	app.delete('/api/projects/:owner/:project/membership', handleLeaveProject);
	return app;
}

function call(grantedRole: ProjectRole, method: 'PUT' | 'DELETE', path: string, body?: unknown): Promise<Response> {
	return Promise.resolve(
		createApp(grantedRole).request(`http://localhost/api/projects/acme/roadmap/${path}`, {
			method,
			headers: { 'Content-Type': 'application/json' },
			...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
		})
	);
}

const MEMBER = { slug: 'vera', name: 'Vera', email: 'vera@example.com', avatarUrl: null, role: 'editor', effectiveRole: 'editor', githubConnected: true } as const;

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(setProjectMemberRole).mockResolvedValue(MEMBER);
	vi.mocked(removeProjectMember).mockResolvedValue(true);
});

describe('the owner is not a membership', () => {
	it.each([
		['changing the owner\'s role', 'PUT', { role: 'viewer' }],
		['removing the owner', 'DELETE', undefined],
	] as const)('refuses %s with 409 PROJECT_OWNER', async (_what, method, body) => {
		const response = await call('owner', method, 'members/acme', body);

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ code: 'PROJECT_OWNER' });
		expect(setProjectMemberRole).not.toHaveBeenCalled();
		expect(removeProjectMember).not.toHaveBeenCalled();
	});

	it('refuses the owner leaving with 409 PROJECT_OWNER', async () => {
		const response = await call('owner', 'DELETE', 'membership');

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ code: 'PROJECT_OWNER' });
		expect(leaveProject).not.toHaveBeenCalled();
	});
});

describe('changing a role', () => {
	it('sets editor or viewer and answers with the member view', async () => {
		const response = await call('owner', 'PUT', 'members/vera', { role: 'editor' });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(MEMBER);
		expect(setProjectMemberRole).toHaveBeenCalledWith('proj-1', 'vera', 'editor');
	});

	it.each([
		['owner', { role: 'owner' }],
		['an unknown role', { role: 'admin' }],
		['no role', {}],
		['a null body', null],
		['not JSON', 'role=editor'],
	])('refuses %s with 400', async (_what, body) => {
		const response = await call('owner', 'PUT', 'members/vera', body);

		expect(response.status).toBe(400);
		expect(setProjectMemberRole).not.toHaveBeenCalled();
	});

	it('answers 404 for a slug that names no member', async () => {
		vi.mocked(setProjectMemberRole).mockResolvedValue(null);

		expect((await call('owner', 'PUT', 'members/sam', { role: 'viewer' })).status).toBe(404);
	});

	it('answers 404 for a path segment that isn\'t a slug at all, without looking it up', async () => {
		expect((await call('owner', 'PUT', 'members/Not_A_Slug', { role: 'viewer' })).status).toBe(404);
		expect(setProjectMemberRole).not.toHaveBeenCalled();
	});
});

describe('removing a member', () => {
	it('removes by slug', async () => {
		const response = await call('owner', 'DELETE', 'members/vera');

		expect(response.status).toBe(200);
		expect(removeProjectMember).toHaveBeenCalledWith('proj-1', 'vera');
	});

	it('answers 404 for a slug that names no member', async () => {
		vi.mocked(removeProjectMember).mockResolvedValue(false);

		expect((await call('owner', 'DELETE', 'members/sam')).status).toBe(404);
	});
});

describe('leaving', () => {
	it.each<ProjectRole>(['editor', 'viewer'])('lets a member granted %s leave', async (grantedRole) => {
		const response = await call(grantedRole, 'DELETE', 'membership');

		expect(response.status).toBe(200);
		expect(leaveProject).toHaveBeenCalledWith('proj-1', 'user-1');
	});
});
