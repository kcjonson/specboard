/**
 * A blocker key that names no item here is "not found", the same answer whether its
 * prefix is another project's or its number doesn't exist in this one, as with every
 * other item lookup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { ResolvedProject } from '@specboard/db';

vi.mock('@specboard/db', async (importOriginal) => ({
	...(await importOriginal<typeof import('@specboard/db')>()),
	addBlocker: vi.fn(),
}));

import { addBlocker, BlockerItemNotFoundError } from '@specboard/db';
import { handleAddBlocker } from './blockers.ts';
import type { AppVariables } from '../project-access.ts';

const PROJECT: ResolvedProject = { id: 'proj-1', slug: 'roadmap', ownerSlug: 'acme', key: 'RM' };

function post(body: unknown): Promise<Response> {
	const app = new Hono<{ Variables: AppVariables }>();
	app.use('*', async (context, next) => {
		context.set('project', PROJECT);
		context.set('userId', 'user-1');
		await next();
	});
	app.post('/api/projects/:owner/:project/items/:itemKey/blockers', handleAddBlocker);
	return Promise.resolve(
		app.request('http://localhost/api/projects/acme/roadmap/items/RM-1/blockers', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})
	);
}

beforeEach(() => {
	vi.mocked(addBlocker).mockReset();
});

describe('POST blockers with a key that names no item here', () => {
	it('answers 404 for another project\'s prefix, without writing', async () => {
		const response = await post({ blockerKey: 'SAM-40' });

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: 'Blocker item not found' });
		expect(addBlocker).not.toHaveBeenCalled();
	});

	it('answers the same 404 for this project\'s prefix and a number that doesn\'t exist', async () => {
		vi.mocked(addBlocker).mockRejectedValue(new BlockerItemNotFoundError(40));

		const response = await post({ blockerKey: 'RM-40' });

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: 'Blocker item not found' });
	});
});
