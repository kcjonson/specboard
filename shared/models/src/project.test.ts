/**
 * The project role signal: what the client makes of the roles the server sends, and
 * that the page shares one project read between everything that asks.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/preact';

const get = vi.fn();

vi.mock('@specboard/fetch', () => ({
	fetchClient: {
		get: (...args: unknown[]) => get(...args),
	},
}));

import { projectModel, projectRoleState, refreshProject, useProjectRole, type ProjectRole } from './project';

beforeEach(() => {
	get.mockReset();
});

describe('projectRoleState', () => {
	it.each<[string, { grantedRole: ProjectRole; effectiveRole: ProjectRole; pushAccess: boolean | null }, object]>([
		['the owner', { grantedRole: 'owner', effectiveRole: 'owner', pushAccess: true }, { canEdit: true, isOwner: true, reason: null }],
		['an editor with GitHub', { grantedRole: 'editor', effectiveRole: 'editor', pushAccess: true }, { canEdit: true, isOwner: false, reason: null }],
		['an editor whose push access is unknown', { grantedRole: 'editor', effectiveRole: 'editor', pushAccess: null }, { canEdit: true, reason: null }],
		['an editor without GitHub', { grantedRole: 'editor', effectiveRole: 'viewer', pushAccess: null }, { canEdit: false, reason: 'github_not_connected' }],
		['a granted viewer', { grantedRole: 'viewer', effectiveRole: 'viewer', pushAccess: null }, { canEdit: false, reason: 'viewer' }],
		['a granted viewer whose GitHub can\'t push', { grantedRole: 'viewer', effectiveRole: 'viewer', pushAccess: false }, { canEdit: false, reason: 'viewer' }],
		['an editor whose GitHub can\'t push', { grantedRole: 'editor', effectiveRole: 'editor', pushAccess: false }, { canEdit: true, reason: 'no_push_access' }],
		['an owner whose GitHub can\'t push', { grantedRole: 'owner', effectiveRole: 'owner', pushAccess: false }, { canEdit: true, reason: 'no_push_access' }],
	])('reads %s', (_who, fields, expected) => {
		expect(projectRoleState(fields)).toMatchObject(expected);
	});

	it('offers nothing until the project has loaded', () => {
		expect(projectRoleState({} as never)).toEqual({
			role: null,
			effectiveRole: null,
			reason: null,
			canEdit: false,
			isOwner: false,
		});
	});
});

describe('useProjectRole', () => {
	it('reads the role from the project, and can edit once it has loaded', async () => {
		get.mockResolvedValue({ id: 'p1', grantedRole: 'editor', effectiveRole: 'editor', pushAccess: true });

		const { result } = renderHook(() => useProjectRole('acme/loads'));

		expect(result.current.canEdit).toBe(false);
		await waitFor(() => expect(result.current.canEdit).toBe(true));
		expect(result.current).toMatchObject({ role: 'editor', effectiveRole: 'editor', reason: null });
		expect(get).toHaveBeenCalledWith('/api/projects/acme/loads');
	});

	it('shares one read between everything on the page that asks for the same project', async () => {
		get.mockResolvedValue({ id: 'p1', grantedRole: 'viewer', effectiveRole: 'viewer', pushAccess: null });

		const header = renderHook(() => useProjectRole('acme/shared'));
		const board = renderHook(() => useProjectRole('acme/shared'));

		await waitFor(() => expect(board.result.current.reason).toBe('viewer'));
		expect(header.result.current.reason).toBe('viewer');
		expect(get).toHaveBeenCalledTimes(1);
	});

	it('stays read-only when the project can\'t be read', async () => {
		get.mockRejectedValue(new Error('HTTP 500'));

		const { result } = renderHook(() => useProjectRole('acme/broken'));

		await waitFor(() => expect(projectModel('acme/broken').$meta.error).not.toBeNull());
		expect(result.current.canEdit).toBe(false);
	});

	it('picks up a role that changed when the project is refreshed', async () => {
		get.mockResolvedValue({ id: 'p1', grantedRole: 'editor', effectiveRole: 'editor', pushAccess: null });
		const { result } = renderHook(() => useProjectRole('acme/demoted'));
		await waitFor(() => expect(result.current.canEdit).toBe(true));

		get.mockResolvedValue({ id: 'p1', grantedRole: 'viewer', effectiveRole: 'viewer', pushAccess: null });
		act(() => refreshProject('acme/demoted'));

		await waitFor(() => expect(result.current.reason).toBe('viewer'));
		expect(result.current.canEdit).toBe(false);
	});
});
