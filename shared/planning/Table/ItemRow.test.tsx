/**
 * The table row's Assignee column, and the board card's corner: the assignee's avatar,
 * and in the table their name, or a dash when nobody is assigned.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/preact';
import { ChildModel, ItemModel } from '@specboard/models';
import { ChildRow } from './ChildRow';
import { ItemRow } from './ItemRow';
import { ItemCard } from '../ItemCard/ItemCard';

const ERIN = { slug: 'erin', name: 'Erin Editor', avatarUrl: 'https://example.com/erin.png' };

function item(extra: Record<string, unknown> = {}): ItemModel {
	return new ItemModel({ key: 'SB-1', projectRef: 'acme/specboard', title: 'Row', type: 'task', status: 'ready', ...extra });
}

function row(model: ItemModel): Element {
	const { container } = render(
		<ItemRow item={model} expandable={false} expanded={false} selected={false} flashing={false} onToggle={vi.fn()} onOpen={vi.fn()} onSelect={vi.fn()} />
	);
	return container;
}

describe('the Assignee column', () => {
	it('shows the assignee\'s avatar and name', () => {
		const cell = row(item({ assignee: ERIN })).querySelectorAll('[role="cell"]')[4]!;

		expect(cell.textContent).toBe('Erin Editor');
		expect(cell.querySelector('img')?.getAttribute('src')).toBe(ERIN.avatarUrl);
	});

	it('shows a dash when nobody is assigned', () => {
		expect(row(item({ assignee: null })).querySelectorAll('[role="cell"]')[4]!.textContent).toBe('—');
	});
});

describe('a child row', () => {
	it('shows its own assignee, as its parent\'s row does', () => {
		const child = new ChildModel({ id: 'c1', key: 'SB-2', number: 2, type: 'task', title: 'Child', status: 'ready', assignee: ERIN });
		const { container } = render(<ChildRow child={child} />);

		const cells = container.querySelectorAll('[role="cell"]');
		expect(cells[cells.length - 1]!.textContent).toBe('Erin Editor');
	});
});

describe('the board card', () => {
	it('carries the assignee\'s avatar, labelled with their name', () => {
		const { getByRole } = render(<ItemCard item={item({ assignee: ERIN })} />);

		expect(getByRole('img', { name: 'Erin Editor' })).toBeTruthy();
	});
});
