/**
 * Table's Project column: there only when the table is given the projects its rows
 * come from (the multi-project view), never on a single project's table.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, within } from '@testing-library/preact';
import { ItemsCollection } from '@specboard/models';
import { memoryStorage } from '../test-support/memory-storage';
import { Table } from './Table';

const getResponse = vi.fn();

vi.mock('@specboard/fetch', () => ({
	fetchClient: {
		getResponse: (...args: unknown[]) => getResponse(...args),
		get: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
		delete: vi.fn(),
	},
}));

beforeEach(() => {
	vi.stubGlobal('localStorage', memoryStorage());
	getResponse.mockImplementation(async (url: string) => {
		const status = new URL(url, 'http://x').searchParams.get('status');
		const data = status === 'ready'
			? [{ id: 'id-1', key: 'SB-1', number: 1, status: 'ready', type: 'task', rank: 1, title: 'First', updatedAt: 't1' }]
			: [];
		return { data, headers: new Headers({ 'X-Total-Count': String(data.length) }) };
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

async function loaded(): Promise<ItemsCollection> {
	const items = new ItemsCollection({ projectRef: 'acme/demo', limit: 200 });
	await items.fetch();
	return items;
}

describe('Table Project column', () => {
	it('is not there on a single project\'s table', async () => {
		const { getAllByRole, queryByRole, getByText } = render(<Table items={await loaded()} onOpenItem={vi.fn()} />);

		expect(queryByRole('columnheader', { name: 'Project' })).toBeNull();
		const row = getByText('First').closest('[role="row"]') as HTMLElement;
		expect(within(row).getAllByRole('cell')).toHaveLength(5);
		expect(getAllByRole('columnheader').slice(0, 5).map((header) => header.textContent)).toEqual(['Type', 'Title', 'Status', 'Tasks', 'Assignee']);
	});

	it('names each row\'s project after its title when the table mixes projects', async () => {
		const projects = new Map([['acme/demo', { ref: 'acme/demo', name: 'Demo', key: 'SB' }]]);
		const { getAllByRole, getByText } = render(<Table items={await loaded()} projects={projects} onOpenItem={vi.fn()} />);

		expect(getAllByRole('columnheader').slice(0, 6).map((header) => header.textContent)).toEqual(['Type', 'Title', 'Project', 'Status', 'Tasks', 'Assignee']);
		const row = getByText('First').closest('[role="row"]') as HTMLElement;
		const cells = within(row).getAllByRole('cell');
		expect(cells).toHaveLength(6);
		expect(cells[2]!.textContent).toBe('Demo');
		expect(within(cells[2]!).getByText('Demo').getAttribute('title')).toBe('acme/demo');
	});
});
