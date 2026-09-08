/**
 * get_items handler tests — the search term reaches the service verbatim, and the
 * tool schema tells an agent that a search spans every depth.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@specboard/db', () => ({
	getItems: vi.fn(async () => ({ items: [], total: 0 })),
}));

import { getItems as getItemsService } from '@specboard/db';
import { getItems } from './reads.ts';
import { epicTools } from './definitions.ts';

const PROJECT = { id: 'proj-1', slug: 'specboard', key: 'SB' };

const mockGetItems = vi.mocked(getItemsService);

beforeEach(() => {
	vi.clearAllMocks();
});

describe('get_items search', () => {
	it('passes the term and status through untouched, letting the service span depths', async () => {
		await getItems(PROJECT, { search: 'SB-12', status: 'ready' });

		expect(mockGetItems).toHaveBeenCalledWith(expect.objectContaining({
			projectId: 'proj-1',
			search: 'SB-12',
			status: 'ready',
			itemNumber: undefined,
		}));
	});

	it('reports the deep total alongside the page count', async () => {
		mockGetItems.mockResolvedValueOnce({ items: [{ key: 'SB-42', parentKey: 'SB-7' } as never], total: 31 });

		const result = await getItems(PROJECT, { search: 'login' });

		const payload = JSON.parse(result.content[0]!.text as string) as { count: number; total: number; items: Array<{ parentKey: string }> };
		expect(payload).toMatchObject({ count: 1, total: 31 });
		expect(payload.items[0]!.parentKey).toBe('SB-7');
	});

	it('documents that search reaches children and matches keys', () => {
		const tool = epicTools.find((t) => t.name === 'get_items')!;
		const search = (tool.inputSchema.properties as Record<string, { description: string }>).search!;
		expect(search.description).toContain('any depth');
		expect(search.description).toContain('parentKey');
		expect(search.description).toContain('item key');
	});
});

describe('get_items checklist', () => {
	it('always includes the checklist for a single-item read', async () => {
		await getItems(PROJECT, { item_key: 'SB-12' });

		expect(mockGetItems).toHaveBeenCalledWith(expect.objectContaining({ itemNumber: 12, includeChecklist: true }));
	});

	it('leaves the checklist off a list unless include_checklist asks for it', async () => {
		await getItems(PROJECT, { status: 'ready' });
		expect(mockGetItems).toHaveBeenCalledWith(expect.objectContaining({ includeChecklist: false }));

		await getItems(PROJECT, { status: 'ready', include_checklist: true });
		expect(mockGetItems).toHaveBeenLastCalledWith(expect.objectContaining({ includeChecklist: true }));
	});
});
