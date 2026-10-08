/**
 * What the commit banner shows when the server refuses a commit: its own CommitError
 * from the body (a 409 when the branch moved since the last pull), else its message.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@specboard/fetch', async (importOriginal) => ({
	...(await importOriginal<typeof import('@specboard/fetch')>()),
	fetchClient: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('./project', () => ({ refreshProject: vi.fn() }));

import { fetchClient, FetchError } from '@specboard/fetch';
import { GitStatusModel } from './GitStatusModel';
import { refreshProject } from './project';

function model(): GitStatusModel {
	const gitStatus = new GitStatusModel();
	gitStatus.projectRef = 'acme/docs';
	return gitStatus;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('GitStatusModel.commit', () => {
	it('shows the reason a refused commit came back with', async () => {
		const reason = { stage: 'commit', message: 'The branch has commits you haven\'t pulled yet. Pull, then commit again.' };
		vi.mocked(fetchClient.post).mockRejectedValue(new FetchError('HTTP 409: Conflict', 409, undefined, { success: false, error: reason, conflictDetected: true }));

		const gitStatus = model();
		expect(await gitStatus.commit()).toBeNull();

		expect(gitStatus.commitError).toEqual({ ...reason, conflictDetected: true });
		expect(gitStatus.committing).toBe(false);
	});

	it('shows a plain error message, and re-reads the project on a 403', async () => {
		vi.mocked(fetchClient.post).mockRejectedValue(new FetchError('HTTP 403: Forbidden', 403, undefined, { error: 'You have view access to this project' }));

		const gitStatus = model();
		await gitStatus.commit();

		expect(gitStatus.commitError).toEqual({ stage: 'commit', message: 'You have view access to this project' });
		expect(refreshProject).toHaveBeenCalledWith('acme/docs');
	});

	it('keeps the warning a commit that landed partway came back with', async () => {
		vi.mocked(fetchClient.post).mockResolvedValue({ success: true, sha: 'c0ffee', warning: 'Committed to GitHub, but the editor\'s copy didn\'t update. Pull to bring the commit in.' });
		vi.mocked(fetchClient.get).mockResolvedValue({ branch: 'main', ahead: 0, behind: 0, changedFiles: [] });

		const gitStatus = model();
		await gitStatus.commit();

		expect(gitStatus.commitError).toBeNull();
		expect(gitStatus.commitWarning).toContain('Pull');
	});
});

describe('GitStatusModel.pull', () => {
	it('waits for a cloud pull\'s sync to finish before refreshing', async () => {
		vi.useFakeTimers();
		try {
			const calls: string[] = [];
			vi.mocked(fetchClient.post).mockResolvedValue({ success: true, commits: 0, status: 'pending' });
			const statuses = ['pending', 'syncing', 'completed'];
			vi.mocked(fetchClient.get).mockImplementation(async (url: string) => {
				calls.push(url);
				if (url.endsWith('/sync/status')) return { status: statuses.shift(), error: null };
				return { branch: 'main', ahead: 0, behind: 0, changedFiles: [] };
			});

			const pulled = model().pull();
			await vi.runAllTimersAsync();

			expect(await pulled).toEqual({ success: true, commits: 0 });
			expect(calls).toEqual([
				'/api/projects/acme/docs/sync/status',
				'/api/projects/acme/docs/sync/status',
				'/api/projects/acme/docs/sync/status',
				'/api/projects/acme/docs/git/status',
			]);
		} finally {
			vi.useRealTimers();
		}
	});

	it('shows the server\'s reason when the lock is taken', async () => {
		vi.mocked(fetchClient.post).mockRejectedValue(new FetchError('HTTP 409: Conflict', 409, undefined, { success: false, error: 'A sync or a commit is running. Try again when it finishes.' }));

		const gitStatus = model();
		expect(await gitStatus.pull()).toEqual({ success: false });
		expect(gitStatus.pullError).toBe('A sync or a commit is running. Try again when it finishes.');
	});

	it('reports a sync that failed', async () => {
		vi.mocked(fetchClient.post).mockResolvedValue({ success: true, commits: 0, status: 'pending' });
		vi.mocked(fetchClient.get).mockResolvedValue({ status: 'failed', error: 'GitHub rate limit exceeded. Resets at 12:00' });

		const gitStatus = model();
		expect(await gitStatus.pull()).toEqual({ success: false });
		expect(gitStatus.pullError).toBe('GitHub rate limit exceeded. Resets at 12:00');
	});
});
