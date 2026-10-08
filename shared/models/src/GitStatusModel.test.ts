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

		expect(gitStatus.commitError).toEqual(reason);
		expect(gitStatus.committing).toBe(false);
	});

	it('shows a plain error message, and re-reads the project on a 403', async () => {
		vi.mocked(fetchClient.post).mockRejectedValue(new FetchError('HTTP 403: Forbidden', 403, undefined, { error: 'You have view access to this project' }));

		const gitStatus = model();
		await gitStatus.commit();

		expect(gitStatus.commitError).toEqual({ stage: 'commit', message: 'You have view access to this project' });
		expect(refreshProject).toHaveBeenCalledWith('acme/docs');
	});
});
