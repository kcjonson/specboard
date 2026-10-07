/**
 * The project view. A local project's repository is a path on its owner's disk, which
 * no member should be sent.
 */

import { describe, it, expect } from 'vitest';
import type { ProjectResponse } from '@specboard/db';
import { projectResponseToApi } from './transform.ts';

const LOCAL: ProjectResponse = {
	id: 'proj-1',
	slug: 'roadmap',
	ownerSlug: 'acme',
	key: 'RM',
	name: 'Roadmap',
	description: null,
	storageMode: 'local',
	repository: { type: 'local', localPath: '/home/owner/app', branch: 'main' },
	rootPaths: ['/docs'],
	systemPrompt: null,
	syncStatus: null,
	syncError: null,
	createdAt: new Date('2026-01-01T00:00:00Z'),
	updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('projectResponseToApi', () => {
	it('sends the owner their local repository', () => {
		expect(projectResponseToApi(LOCAL, { grantedRole: 'owner', effectiveRole: 'owner' }).repository).toEqual(LOCAL.repository);
	});

	it.each([
		['editor', 'editor'],
		['editor', 'viewer'],
		['viewer', 'viewer'],
	] as const)('sends a member granted %s (effective %s) no local path', (grantedRole, effectiveRole) => {
		const view = projectResponseToApi(LOCAL, { grantedRole, effectiveRole });
		expect(view.repository).toEqual({});
		expect(view.storageMode).toBe('local');
		expect(JSON.stringify(view)).not.toContain('/home/owner');
	});
});
