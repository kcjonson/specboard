/**
 * Worker service tests — observed-presence upsert and episode end.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentActor } from '../types.ts';

vi.mock('../index.ts', () => ({
	query: vi.fn(),
}));

import { query } from '../index.ts';
import { recordWorkerActivity, endWorkers } from './workers.ts';

const mockQuery = vi.mocked(query);

const ACTOR: AgentActor = {
	type: 'agent',
	userId: 'user-1',
	clientId: 'client-1',
	deviceName: 'kevin-mbp',
	sessionId: 'session-1',
};

beforeEach(() => {
	mockQuery.mockReset();
	mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

describe('recordWorkerActivity', () => {
	it('upserts on the active-episode partial unique index, bumping last_seen_at', async () => {
		await recordWorkerActivity('proj-1', 1, ACTOR, 'feature-branch');

		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('INSERT INTO item_workers');
		expect(sql).toContain(`ON CONFLICT (item_id, (actor->>'sessionId')) WHERE ended_at IS NULL`);
		expect(sql).toContain('last_seen_at = now()');
		expect(sql).toContain('COALESCE(EXCLUDED.branch, item_workers.branch)');
		expect(params).toEqual(['proj-1', 1, JSON.stringify(ACTOR), 'feature-branch']);
	});

	it('is a no-op without a sessionId (NULLs would stack duplicate active rows)', async () => {
		await recordWorkerActivity('proj-1', 1, { ...ACTOR, sessionId: undefined });

		expect(mockQuery).not.toHaveBeenCalled();
	});
});

describe('endWorkers', () => {
	it('ends only the given session when one is passed', async () => {
		await endWorkers('proj-1', 1, 'session-1');

		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('SET ended_at = now()');
		expect(sql).toContain(`($3::text IS NULL OR w.actor->>'sessionId' = $3)`);
		expect(params).toEqual(['proj-1', 1, 'session-1']);
	});

	it('ends every active episode when no session is passed (item completed)', async () => {
		await endWorkers('proj-1', 1);

		const [, params] = mockQuery.mock.calls[0]!;
		expect(params).toEqual(['proj-1', 1, null]);
	});
});
