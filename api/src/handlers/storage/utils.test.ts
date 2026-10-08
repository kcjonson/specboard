/**
 * Which storage a caller reaches. The role matrix stubs handlers, so it can't see this:
 * a local project's files are on its owner's machine, and members get none of them.
 */

import { describe, it, expect } from 'vitest';
import type { ProjectResponse, ProjectRole } from '@specboard/db';
import { LocalStorageProvider } from '../../services/storage/local-provider.ts';
import { CloudStorageProvider } from '../../services/storage/cloud-provider.ts';
import { getStorageProvider } from './utils.ts';

function project(overrides: Partial<ProjectResponse>): ProjectResponse {
	return {
		id: 'proj-1',
		slug: 'roadmap',
		ownerSlug: 'acme',
		ownerName: 'Alice Ames',
		key: 'RM',
		name: 'Roadmap',
		description: null,
		storageMode: 'none',
		repository: {},
		rootPaths: [],
		systemPrompt: null,
		syncStatus: null,
		syncError: null,
		createdAt: new Date('2026-01-01T00:00:00Z'),
		updatedAt: new Date('2026-01-01T00:00:00Z'),
		...overrides,
	};
}

const LOCAL = project({ storageMode: 'local', repository: { type: 'local', localPath: '/home/owner/app', branch: 'main' }, rootPaths: ['/docs'] });
const CLOUD = project({
	storageMode: 'cloud',
	repository: { type: 'cloud', remote: { provider: 'github', owner: 'acme', repo: 'docs', url: 'https://github.com/acme/docs' }, branch: 'main' },
	rootPaths: ['/'],
});

describe('getStorageProvider', () => {
	it('gives the owner a local project\'s files', () => {
		expect(getStorageProvider(LOCAL, 'owner-1', { grantedRole: 'owner' })).toBeInstanceOf(LocalStorageProvider);
	});

	it.each<ProjectRole>(['editor', 'viewer'])('gives a member granted %s no storage on a local project', (grantedRole) => {
		expect(getStorageProvider(LOCAL, 'member-1', { grantedRole })).toBeNull();
	});

	it.each<ProjectRole>(['owner', 'editor', 'viewer'])('gives %s a cloud project\'s storage', (grantedRole) => {
		expect(getStorageProvider(CLOUD, 'user-1', { grantedRole })).toBeInstanceOf(CloudStorageProvider);
	});

	it('gives nobody storage on a project without a repository', () => {
		expect(getStorageProvider(project({}), 'owner-1', { grantedRole: 'owner' })).toBeNull();
	});
});
