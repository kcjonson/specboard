/**
 * Project service tests — attaching a repository through updateProject: the SQL it
 * builds, the storage_mode guard, and how a missed guard is told apart from not-found.
 * Also the mirror guard on the local-mode folder service, which must leave cloud projects alone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../index.ts', () => ({
	query: vi.fn(),
	transaction: vi.fn(),
}));

import { query, transaction } from '../index.ts';
import {
	addFolder,
	removeFolder,
	updateProject,
	ProjectHasRepositoryError,
	type RepositoryConfigInput,
} from './projects.ts';

const mockQuery = vi.mocked(query);
const clientQuery = vi.fn();
vi.mocked(transaction).mockImplementation((fn) => fn({ query: clientQuery } as never));

const REPOSITORY: RepositoryConfigInput = {
	provider: 'github',
	owner: 'acme-corp',
	repo: 'documentation',
	branch: 'main',
	url: 'https://github.com/acme-corp/documentation',
};

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 'proj-1',
		slug: 'docs',
		key: 'DOCS',
		name: 'Docs',
		description: null,
		owner_id: 'user-1',
		storage_mode: 'none',
		repository: {},
		root_paths: [],
		system_prompt: null,
		sync_status: null,
		sync_error: null,
		created_at: new Date('2026-01-01'),
		updated_at: new Date('2026-01-01'),
		...overrides,
	};
}

/** Collapse whitespace so assertions can read like the SQL. */
function sqlOf(call: number): string {
	return String(mockQuery.mock.calls[call]![0]).replace(/\s+/g, ' ').trim();
}

const CLOUD_ROW = row({
	storage_mode: 'cloud',
	repository: {
		type: 'cloud',
		remote: { provider: 'github', owner: 'acme-corp', repo: 'documentation', url: REPOSITORY.url },
		branch: 'main',
	},
	root_paths: ['/'],
	sync_status: 'completed',
});

beforeEach(() => {
	mockQuery.mockReset();
	clientQuery.mockReset();
});

describe('updateProject with a repository', () => {
	it('switches to cloud mode, resets sync state, and guards on storage_mode in the same statement', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [row({ storage_mode: 'cloud' })], rowCount: 1 } as never);

		await updateProject('proj-1', 'user-1', { name: 'Docs', repository: REPOSITORY });

		expect(mockQuery).toHaveBeenCalledTimes(1);
		const sql = sqlOf(0);
		expect(sql).toContain("SET name = $1, storage_mode = 'cloud', repository = $2, root_paths = $3, last_synced_commit_sha = NULL, sync_status = NULL, sync_started_at = NULL, sync_completed_at = NULL, sync_error = NULL, updated_at = NOW()");
		expect(sql).toContain("WHERE id = $4 AND owner_id = $5 AND storage_mode = 'none'");
		expect(mockQuery.mock.calls[0]![1]).toEqual([
			'Docs',
			JSON.stringify({
				type: 'cloud',
				remote: { provider: 'github', owner: 'acme-corp', repo: 'documentation', url: REPOSITORY.url },
				branch: 'main',
			}),
			'["/"]',
			'proj-1',
			'user-1',
		]);
	});

	it('numbers the placeholders from $1 when the repository is the only change', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [row({ storage_mode: 'cloud' })], rowCount: 1 } as never);

		await updateProject('proj-1', 'user-1', { repository: REPOSITORY });

		const sql = sqlOf(0);
		expect(sql).toContain('repository = $1, root_paths = $2');
		expect(sql).toContain("WHERE id = $3 AND owner_id = $4 AND storage_mode = 'none'");
		expect(mockQuery.mock.calls[0]![1]).toHaveLength(4);
	});

	it('throws ProjectHasRepositoryError when the guard drops an owned project', async () => {
		mockQuery
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
			.mockResolvedValueOnce({ rows: [row({ storage_mode: 'cloud' })], rowCount: 1 } as never);

		await expect(updateProject('proj-1', 'user-1', { repository: REPOSITORY })).rejects.toBeInstanceOf(ProjectHasRepositoryError);

		expect(mockQuery).toHaveBeenCalledTimes(2);
		expect(sqlOf(1)).toBe('SELECT p.*, u.slug AS owner_slug FROM projects p JOIN users u ON u.id = p.owner_id WHERE p.id = $1 AND p.owner_id = $2');
	});

	it('returns null when the project is not the caller\'s', async () => {
		mockQuery
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

		await expect(updateProject('proj-1', 'user-2', { repository: REPOSITORY })).resolves.toBeNull();
	});
});

describe('updateProject without a repository', () => {
	it('builds the same statement as before and never looks up the project on a miss', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

		await expect(updateProject('proj-1', 'user-1', { slug: 'new-docs' })).resolves.toBeNull();

		expect(mockQuery).toHaveBeenCalledTimes(1);
		const sql = sqlOf(0);
		expect(sql).toContain('SET slug = $1, updated_at = NOW() WHERE id = $2 AND owner_id = $3');
		expect(sql).not.toContain('storage_mode');
	});
});

describe('addFolder', () => {
	const FOLDER = { repoPath: '/home/me/app', rootPath: '/docs', branch: 'main' };

	it('refuses a cloud project and never writes', async () => {
		clientQuery.mockResolvedValueOnce({ rows: [CLOUD_ROW], rowCount: 1 });

		await expect(addFolder('proj-1', 'user-1', FOLDER)).rejects.toThrow('CLOUD_PROJECT');

		expect(clientQuery).toHaveBeenCalledTimes(1);
		expect(String(clientQuery.mock.calls[0]![0])).toContain('FOR UPDATE');
	});

	it('switches a project with no storage to local mode', async () => {
		clientQuery
			.mockResolvedValueOnce({ rows: [row()], rowCount: 1 })
			.mockResolvedValueOnce({ rows: [row({ storage_mode: 'local', root_paths: ['/docs'] })], rowCount: 1 });

		const project = await addFolder('proj-1', 'user-1', FOLDER);

		expect(project?.storageMode).toBe('local');
		expect(String(clientQuery.mock.calls[1]![0])).toContain("SET storage_mode = 'local'");
	});
});

describe('removeFolder', () => {
	it('refuses a cloud project and never writes', async () => {
		clientQuery.mockResolvedValueOnce({ rows: [CLOUD_ROW], rowCount: 1 });

		await expect(removeFolder('proj-1', 'user-1', '/')).rejects.toThrow('CLOUD_PROJECT');

		expect(clientQuery).toHaveBeenCalledTimes(1);
	});

	it('still removes a local project\'s last folder', async () => {
		const local = row({
			storage_mode: 'local',
			repository: { type: 'local', localPath: '/home/me/app', branch: 'main' },
			root_paths: ['/docs'],
		});
		clientQuery
			.mockResolvedValueOnce({ rows: [local], rowCount: 1 })
			.mockResolvedValueOnce({ rows: [row()], rowCount: 1 });

		const project = await removeFolder('proj-1', 'user-1', '/docs');

		expect(project?.storageMode).toBe('none');
		expect(clientQuery.mock.calls[1]![1]).toEqual(['[]', 'proj-1', 'user-1']);
	});

	it('returns null when the project is not the caller\'s', async () => {
		clientQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

		await expect(removeFolder('proj-1', 'user-2', '/docs')).resolves.toBeNull();
		expect(clientQuery).toHaveBeenCalledTimes(1);
	});
});
