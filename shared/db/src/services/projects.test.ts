/**
 * Project service tests — attaching a repository through updateProject: the SQL it
 * builds, the storage_mode guard, and how a missed guard is told apart from not-found.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../index.ts', () => ({
	query: vi.fn(),
	transaction: vi.fn(),
}));

import { query } from '../index.ts';
import { updateProject, ProjectHasRepositoryError, type RepositoryConfigInput } from './projects.ts';

const mockQuery = vi.mocked(query);

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

beforeEach(() => {
	mockQuery.mockReset();
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
		expect(sqlOf(1)).toBe('SELECT * FROM projects WHERE id = $1 AND owner_id = $2');
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
