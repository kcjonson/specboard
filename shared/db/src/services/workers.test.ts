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
	client: { name: 'claude-code', version: '2.0.0' },
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
		expect(sql).toContain(`ON CONFLICT (item_id, (actor->>'userId'), (actor->>'clientId'), (COALESCE(actor->>'sessionId', ''))) WHERE ended_at IS NULL`);
		expect(sql).toContain('last_seen_at = now()');
		expect(sql).toContain('COALESCE(EXCLUDED.branch, item_workers.branch)');
		expect(params).toEqual(['proj-1', 1, JSON.stringify(ACTOR), 'feature-branch']);
	});

	it('still records a session-less actor (COALESCE in the index folds those into one episode)', async () => {
		const sessionless: AgentActor = { type: 'agent', userId: 'user-1', clientId: 'client-1', deviceName: 'kevin-mbp' };
		await recordWorkerActivity('proj-1', 1, sessionless);

		const [, params] = mockQuery.mock.calls[0]!;
		expect(params![2]).toBe(JSON.stringify(sessionless));
	});
});

describe('endWorkers', () => {
	it('ends every active episode on the item', async () => {
		await endWorkers('proj-1', 1);

		const [sql, params] = mockQuery.mock.calls[0]!;
		expect(sql).toContain('SET ended_at = now()');
		expect(sql).toContain('w.ended_at IS NULL');
		expect(params).toEqual(['proj-1', 1]);
	});
});
