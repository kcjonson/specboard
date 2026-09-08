/**
 * ChildrenSection — an item's real child items, rendered as items rather than
 * as a checklist.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { ItemModel } from '@specboard/models';
import { ChildrenSection } from './ChildrenSection';

const get = vi.fn();
const post = vi.fn();

vi.mock('@specboard/fetch', () => ({
	fetchClient: {
		get: (...args: unknown[]) => get(...args),
		post: (...args: unknown[]) => post(...args),
		put: vi.fn(),
		delete: vi.fn(),
	},
}));

// The create dialog is a native modal wrapping a rich-text form; what matters here
// is what the section hands it and what it does with the result.
const dialog = vi.hoisted(() => ({
	props: null as { createType?: string; parentKey?: string; onCreate: (data: unknown) => void } | null,
}));

vi.mock('../NewItemDialog/NewItemDialog', () => ({
	NewItemDialog: (props: { createType?: string; parentKey?: string; onCreate: (data: unknown) => void }) => {
		dialog.props = props;
		return <div data-testid="new-item-dialog" />;
	},
}));

interface ChildPayload {
	id: string;
	key: string;
	number: number;
	type: string;
	title: string;
	status: string;
	blocked?: boolean;
}

function child(overrides: Partial<ChildPayload> = {}): ChildPayload {
	return {
		id: overrides.id ?? 'c1',
		key: 'SB-2',
		number: 2,
		type: 'task',
		title: 'A child',
		status: 'ready',
		...overrides,
	};
}

function makeItem(type: string, children: ChildPayload[]): ItemModel {
	const item = new ItemModel({
		id: 'i1',
		key: 'SB-1',
		projectSlug: 'specboard',
		title: 'Parent',
		type,
		status: 'in_progress',
		children,
	});
	item.$meta.lastFetched = Date.now();
	return item;
}

function manyChildren(count: number): ChildPayload[] {
	return Array.from({ length: count }, (_, i) =>
		child({ id: `c${i}`, key: `SB-${i + 2}`, number: i + 2, title: `Child ${i + 1}` })
	);
}

describe('ChildrenSection', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dialog.props = null;
	});

	it('renders no checkbox — a child is an item, not a todo', () => {
		const item = makeItem('epic', [child(), child({ id: 'c2', key: 'SB-3', status: 'done' })]);
		const { container, queryAllByRole } = render(<ChildrenSection item={item} />);

		expect(container.querySelectorAll('input[type=checkbox]')).toHaveLength(0);
		expect(queryAllByRole('checkbox')).toHaveLength(0);
	});

	it('renders the key, type badge, status label, and blocked chip', () => {
		const item = makeItem('epic', [
			child({ key: 'SB-7', type: 'bug', title: 'Login 500s', status: 'in_progress', blocked: true }),
		]);
		const { getByText, getByLabelText } = render(<ChildrenSection item={item} />);

		expect(getByText('SB-7')).toBeTruthy();
		expect(getByText('Login 500s')).toBeTruthy();
		expect(getByLabelText('Bug')).toBeTruthy();
		expect(getByText('In Progress')).toBeTruthy();
		expect(getByText('Blocked')).toBeTruthy();
	});

	it('counts done children in the header', () => {
		const item = makeItem('epic', [
			child({ id: 'c1', key: 'SB-2', status: 'done' }),
			child({ id: 'c2', key: 'SB-3', status: 'ready' }),
			child({ id: 'c3', key: 'SB-4', status: 'done' }),
		]);
		const { getByText } = render(<ChildrenSection item={item} />);

		expect(getByText('Children (2/3)')).toBeTruthy();
	});

	it('opens a child by key when its row is clicked', () => {
		const onOpenChild = vi.fn();
		const item = makeItem('epic', [child({ key: 'SB-9' })]);
		const { getByText } = render(<ChildrenSection item={item} onOpenChild={onOpenChild} />);

		fireEvent.click(getByText('A child'));

		expect(onOpenChild).toHaveBeenCalledWith('SB-9');
	});

	it('caps the list at ten rows and reveals the rest on Show all', () => {
		const item = makeItem('epic', manyChildren(12));
		const { getAllByRole, getByText, queryByText } = render(<ChildrenSection item={item} />);

		expect(getAllByRole('listitem')).toHaveLength(10);
		expect(queryByText('Child 12')).toBeNull();

		fireEvent.click(getByText('Show all 12'));

		expect(getAllByRole('listitem')).toHaveLength(12);
		expect(getByText('Child 12')).toBeTruthy();
	});

	it('collapses to the header alone for a childless task', () => {
		const item = makeItem('task', []);
		const { getByText, queryAllByRole, queryByText } = render(<ChildrenSection item={item} />);

		expect(getByText('Children (0/0)')).toBeTruthy();
		expect(queryAllByRole('listitem')).toHaveLength(0);
		expect(queryByText('No children yet')).toBeNull();
	});

	it('opens the create dialog under this item, defaulting to a task', () => {
		const item = makeItem('epic', []);
		const { getByText, getByTestId } = render(<ChildrenSection item={item} />);

		fireEvent.click(getByText('Task'));

		expect(getByTestId('new-item-dialog')).toBeTruthy();
		expect(dialog.props?.createType).toBe('task');
		expect(dialog.props?.parentKey).toBe('SB-1');
	});

	it('creates the type chosen from the dropdown', () => {
		const item = makeItem('epic', []);
		const { getByLabelText, getByText } = render(<ChildrenSection item={item} />);

		fireEvent.click(getByLabelText('More options'));
		fireEvent.click(getByText('Bug'));

		expect(dialog.props?.createType).toBe('bug');
		expect(dialog.props?.parentKey).toBe('SB-1');
	});

	it('surfaces a failed create instead of swallowing it', async () => {
		post.mockRejectedValue(new Error('nope'));
		const item = makeItem('epic', []);
		const { getByText, findByText } = render(<ChildrenSection item={item} />);

		fireEvent.click(getByText('Task'));
		dialog.props?.onCreate({ title: 'New work', status: 'ready', type: 'task' });

		expect(await findByText('Could not create that task.')).toBeTruthy();
		expect(get).not.toHaveBeenCalled();
	});

	// onOpenChild is optional. A row that cannot open anything should not be a
	// tab stop that does nothing when you land on it.
	it('leaves rows inert when there is nothing to open them with', () => {
		const item = makeItem('epic', [child()]);
		const { container } = render(<ChildrenSection item={item} />);

		const row = container.querySelector('[role="listitem"]');
		expect(row).not.toBeNull();
		expect(row?.getAttribute('tabindex')).toBeNull();
	});

	it('makes rows focusable when they can open a child', () => {
		const item = makeItem('epic', [child()]);
		const { container } = render(<ChildrenSection item={item} onOpenChild={vi.fn()} />);

		expect(container.querySelector('[role="listitem"]')?.getAttribute('tabindex')).toBe('0');
	});
});
