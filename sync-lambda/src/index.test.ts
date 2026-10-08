/**
 * A sync that fails before it takes its lock (configuration, secrets, the token, the
 * event) records the failure against the pending lock the API took, so that lock
 * doesn't block every member's commits until it goes stale.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./shared/db-utils.ts', () => ({
	markPendingFailed: vi.fn(async () => {}),
	markSyncing: vi.fn(),
	markSyncFailed: vi.fn(),
	completeSync: vi.fn(),
}));

import { handler, type SyncEvent } from './index.ts';
import { markPendingFailed } from './shared/db-utils.ts';

const PENDING = '2026-10-08T12:00:00.000Z';

const EVENT: SyncEvent = {
	projectId: 'p1',
	userId: 'u1',
	owner: 'acme',
	repo: 'docs',
	branch: 'main',
	encryptedToken: '{}',
	mode: 'incremental',
	lastCommitSha: 'fedcba9876543210fedcba9876543210fedcba98',
	lockToken: PENDING,
};

beforeEach(() => {
	vi.clearAllMocks();
	// Local dev mode with its storage key missing: fails before any sync starts.
	vi.stubEnv('NODE_ENV', 'development');
	vi.stubEnv('STORAGE_SERVICE_API_KEY', '');
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('handler', () => {
	it('fails the pending lock it was given when it can\'t start', async () => {
		const result = await handler(EVENT);

		expect(result).toMatchObject({ success: false });
		expect(markPendingFailed).toHaveBeenCalledWith('p1', new Date(PENDING), 'Sync failed. Check Lambda logs for details.');
	});

	it('leaves the lock alone when the event has no usable token', async () => {
		const result = await handler({ ...EVENT, lockToken: 'not a time' });

		expect(result).toMatchObject({ success: false });
		expect(markPendingFailed).not.toHaveBeenCalled();
	});
});
