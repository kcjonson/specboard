/**
 * ItemView's header: the title field (a textarea so long titles wrap, but the
 * value stays one line), the Parent field, the assignee and its picker, who created
 * and is working on the item, and the dates.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { render, fireEvent, act, waitFor, within } from '@testing-library/preact';
import { FetchError, fetchClient } from '@specboard/fetch';
import { ItemModel } from '@specboard/models';
import { ItemView } from './ItemView';

// Nothing in these tests should reach the network. Throwing beats a silent
// resolve: a stray call names itself instead of surfacing later as a confusing
// downstream error.
vi.mock('@specboard/fetch', async (importOriginal) => {
	const unexpected = (method: string): ReturnType<typeof vi.fn> => vi.fn((url: unknown) => {
		throw new Error(`Unexpected ${method} ${String(url)} in an ItemView test`);
	});
	return {
		...(await importOriginal<typeof import('@specboard/fetch')>()),
		fetchClient: {
			get: unexpected('GET'),
			post: unexpected('POST'),
			put: unexpected('PUT'),
			delete: unexpected('DELETE'),
		},
	};
});


// The sections below the header each fetch and render their own trees; none of
// them are what these tests are about. The parent picker fetches on open, and
// nothing here opens it; it is stubbed through its package barrel, which also
// keeps Editor's slate-react (and with it preact/compat) out of this file. compat
// rebinds onBlur to a focusout listener, so loading it would make fireEvent.blur
// below reach nothing.
vi.mock('../ChildrenSection/ChildrenSection', () => ({ ChildrenSection: () => null }));
vi.mock('../ChecklistSection/ChecklistSection', () => ({ ChecklistSection: () => null }));
vi.mock('../SpecsSection/SpecsSection', () => ({ SpecsSection: () => null }));
vi.mock('../BlockersSection/BlockersSection', () => ({ BlockersSection: () => null }));
vi.mock('../NotesSection/NotesSection', () => ({ NotesSection: () => null }));
// Captured so a test can drive the picker's onSelect without rendering a modal.
const picker: { props?: { onSelect: (key: string) => void } } = {};
vi.mock('@specboard/pages', () => ({
	ItemPicker: (props: { onSelect: (key: string) => void }) => {
		picker.props = props;
		return null;
	},
}));
// Captured so a test can see which value ItemView hands the editor, and drive
// its onChange without a real Slate tree.
let editorProps: { value: unknown; onChange: (value: unknown) => void } | null = null;
vi.mock('../RichTextEditor', () => ({
	RichTextEditor: (props: { value: unknown; onChange: (value: unknown) => void }) => {
		editorProps = props;
		return null;
	},
	serializeToText: () => '',
	deserializeFromText: () => [],
}));

function makeItem(title: string, extra: Record<string, unknown> = {}): ItemModel {
	const item = new ItemModel({
		key: 'SB-1',
		projectRef: 'acme/specboard',
		title,
		type: 'task',
		status: 'ready',
		...extra,
	});
	// ItemView fetches full detail on mount while lastFetched is null. These tests
	// are about the title field, so hand it an item that looks already loaded.
	item.$meta.lastFetched = Date.now();
	vi.spyOn(item, 'save').mockResolvedValue(undefined);
	return item;
}

function makeItemWith(key: string, description: string): ItemModel {
	const item = new ItemModel({
		key,
		projectRef: 'acme/specboard',
		title: 'T',
		type: 'task',
		status: 'ready',
		description,
	});
	item.$meta.lastFetched = Date.now();
	vi.spyOn(item, 'save').mockResolvedValue(undefined);
	return item;
}

function titleField(container: Element): HTMLTextAreaElement {
	const field = container.querySelector('textarea[aria-label="Task title"]');
	// An accessibility or markup change should say so here, not throw on a null
	// property access three lines later.
	if (!(field instanceof HTMLTextAreaElement)) {
		throw new Error('No textarea labelled "Task title" in the rendered ItemView');
	}
	return field;
}

describe('ItemView title', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('collapses newlines pasted into the field', () => {
		const item = makeItem('Original');
		const { container } = render(<ItemView canEdit item={item} />);
		const field = titleField(container);

		fireEvent.input(field, { target: { value: 'Apply planning search\nand type filter' } });

		expect(field.value).toBe('Apply planning search and type filter');
	});

	it('saves the collapsed value on blur', () => {
		const item = makeItem('Original');
		const { container } = render(<ItemView canEdit item={item} />);
		const field = titleField(container);

		fireEvent.input(field, { target: { value: 'One\nTwo' } });
		fireEvent.blur(field);

		expect(item.title).toBe('One Two');
		expect(item.save).toHaveBeenCalled();
	});

	it('renders a title that already contains newlines as one line', () => {
		const item = makeItem('Stored\nwith a break');
		const { container } = render(<ItemView canEdit item={item} />);

		expect(titleField(container).value).toBe('Stored with a break');
	});

	it('does not write just because a newline-containing title was focused', () => {
		const item = makeItem('Stored\nwith a break');
		const { container } = render(<ItemView canEdit item={item} />);

		fireEvent.blur(titleField(container));

		expect(item.save).not.toHaveBeenCalled();
	});

	it('commits on Enter instead of inserting a line break', () => {
		const item = makeItem('Original');
		const { container } = render(<ItemView canEdit item={item} />);
		const field = titleField(container);
		const blur = vi.spyOn(field, 'blur');

		const prevented = !fireEvent.keyDown(field, { key: 'Enter' });

		expect(prevented).toBe(true);
		expect(blur).toHaveBeenCalled();
	});
});

describe('ItemView description', () => {
	// Two items with the same description text memoized to one identity, so the
	// reset effect never fired: the next item opened showing the previous one's
	// unsaved draft, with the dirty flag still set, and blurring saved that text
	// onto the wrong item. Empty descriptions make this the ordinary case.
	it('drops an unsaved draft when switching to an item whose description matches', () => {
		const first = makeItemWith('SB-1', '');
		const { rerender } = render(<ItemView canEdit item={first} />);

		const pristine = editorProps?.value;
		// Driving onChange directly is not an event, so it needs its own flush.
		act(() => editorProps?.onChange([{ type: 'paragraph', children: [{ text: 'unsaved draft' }] }]));
		expect(editorProps?.value).not.toBe(pristine);

		rerender(<ItemView canEdit item={makeItemWith('SB-2', '')} />);

		expect(editorProps?.value).not.toBe(pristine);
		expect(editorProps?.value).toEqual([]);
	});
});

describe('ItemView parent', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('reads as key and title, and opens the parent when clicked', () => {
		const item = makeItem('Child', { parentKey: 'SB-4', parentTitle: 'UI Library & Design System' });
		const onOpenItem = vi.fn();
		const { getByText } = render(<ItemView canEdit item={item} onOpenItem={onOpenItem} />);

		fireEvent.click(getByText('SB-4 · UI Library & Design System'));

		expect(onOpenItem).toHaveBeenCalledWith('SB-4');
	});

	it('shows a parentless task as None, so it can still be given one', () => {
		const item = makeItem('Orphan');
		const { container } = render(<ItemView canEdit item={item} />);

		expect(container.textContent).toContain('None');
	});

	// move() applies the response it receives, so two in flight can settle out of
	// order and leave the field showing the parent from the earlier request.
	it('issues one move at a time', async () => {
		const item = makeItem('Child', { parentKey: 'SB-4' });
		let settleMove: () => void = () => {};
		const move = vi.spyOn(item, 'move').mockReturnValue(new Promise<void>((resolve) => {
			settleMove = resolve;
		}));
		const { getByText } = render(<ItemView canEdit item={item} onOpenItem={vi.fn()} />);

		fireEvent.click(getByText('Change'));
		picker.props?.onSelect('SB-7');
		picker.props?.onSelect('SB-8');

		expect(move).toHaveBeenCalledTimes(1);
		expect(move).toHaveBeenCalledWith('SB-7');
		settleMove();
	});

	it('leaves the field off a top-level epic', () => {
		const item = makeItem('Epic', { type: 'epic' });
		const { container } = render(<ItemView canEdit item={item} />);

		expect(container.textContent).not.toContain('Parent');
	});
});

describe('ItemView dates', () => {
	const at = (container: Element, label: string): string | null => {
		const field = [...container.querySelectorAll('time')].find((t) => t.previousElementSibling?.textContent === label);
		return field?.getAttribute('datetime') ?? null;
	};

	it('shows when the item was created, started, and completed', () => {
		const item = makeItem('Done', {
			status: 'done',
			createdAt: '2026-09-28T09:00:00.000Z',
			startedAt: '2026-09-29T14:30:00.000Z',
			completedAt: '2026-10-01T17:05:00.000Z',
		});
		const { container } = render(<ItemView canEdit item={item} />);

		expect(at(container, 'Created')).toBe('2026-09-28T09:00:00.000Z');
		expect(at(container, 'Started')).toBe('2026-09-29T14:30:00.000Z');
		expect(at(container, 'Completed')).toBe('2026-10-01T17:05:00.000Z');
	});

	it('leaves out a date that was never set, rather than claiming it never happened', () => {
		const item = makeItem('Fresh', { createdAt: '2026-09-28T09:00:00.000Z', startedAt: null, completedAt: null });
		const { container } = render(<ItemView canEdit item={item} />);

		expect(at(container, 'Created')).toBe('2026-09-28T09:00:00.000Z');
		expect(container.querySelectorAll('time')).toHaveLength(1);
		expect(at(container, 'Started')).toBeNull();
		expect(at(container, 'Completed')).toBeNull();
	});
});

describe('ItemView for someone who can\'t edit', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders the fields as text and offers no changes', () => {
		const item = makeItem('Ship it', { parentKey: 'SB-4', status: 'in_progress', subStatus: 'pr_open' });
		const { container, getByRole, queryByText } = render(<ItemView canEdit={false} item={item} onDelete={vi.fn()} onOpenItem={vi.fn()} />);

		expect(container.querySelector('textarea')).toBeNull();
		expect(container.querySelector('select')).toBeNull();
		expect(getByRole('heading', { level: 2 }).textContent).toBe('Ship it');
		expect(container.textContent).toContain('StatusIn Progress');
		expect(container.textContent).toContain('Sub-StatusPR Open');
		expect(queryByText('Change')).toBeNull();
		expect(queryByText('Assign')).toBeNull();
		expect(queryByText('Delete Task')).toBeNull();
	});

	it('mounts the description read-only', () => {
		render(<ItemView canEdit={false} item={makeItem('Ship it')} />);

		expect(editorProps).toMatchObject({ readOnly: true });
	});

	it('still opens the parent', () => {
		const onOpenItem = vi.fn();
		const { getByText } = render(<ItemView canEdit={false} item={makeItem('Child', { parentKey: 'SB-4' })} onOpenItem={onOpenItem} />);

		fireEvent.click(getByText('SB-4'));

		expect(onOpenItem).toHaveBeenCalledWith('SB-4');
	});
});

describe('ItemView refused writes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('reverts the field and shows the server\'s reason', async () => {
		const item = makeItem('Original');
		vi.mocked(item.save).mockRejectedValue(
			new FetchError('HTTP 403: Forbidden', 403, undefined, { error: 'You have view access to this project', reason: 'viewer' })
		);
		const { container, findByRole } = render(<ItemView canEdit item={item} />);
		const field = titleField(container);

		fireEvent.input(field, { target: { value: 'Renamed' } });
		fireEvent.blur(field);

		expect((await findByRole('alert')).textContent).toBe('You have view access to this project');
		expect(item.title).toBe('Original');
		await waitFor(() => expect(titleField(container).value).toBe('Original'));
	});

	it('re-reads the project after a 403, so the page can turn read-only', async () => {
		const item = makeItem('Original');
		vi.mocked(item.save).mockRejectedValue(new FetchError('HTTP 403: Forbidden', 403, undefined, { error: 'Connect GitHub to edit this project' }));
		const { container, findByRole } = render(<ItemView canEdit item={item} />);

		fireEvent.change(container.querySelector('select#item-status')!, { target: { value: 'done' } });

		await findByRole('alert');
		expect(fetchClient.get).toHaveBeenCalledWith('/api/projects/acme/specboard');
		expect(item.status).toBe('ready');
	});

	it('falls back to its own words for a failure without a message', async () => {
		const item = makeItem('Original');
		vi.mocked(item.save).mockRejectedValue(new TypeError('Failed to fetch'));
		const { container, findByRole } = render(<ItemView canEdit item={item} />);

		fireEvent.change(container.querySelector('select#item-status')!, { target: { value: 'done' } });

		expect((await findByRole('alert')).textContent).toBe('Could not change the status.');
		expect(fetchClient.get).not.toHaveBeenCalled();
	});
});

describe('ItemView delete', () => {
	const realShowModal = HTMLDialogElement.prototype.showModal;
	const realClose = HTMLDialogElement.prototype.close;

	beforeEach(() => {
		vi.clearAllMocks();
		HTMLDialogElement.prototype.showModal = function showModal(): void { this.open = true; };
		HTMLDialogElement.prototype.close = function close(): void { this.open = false; };
	});

	// After cleanup unmounts, which closes the dialog; restoring per test would race it.
	afterAll(() => {
		HTMLDialogElement.prototype.showModal = realShowModal;
		HTMLDialogElement.prototype.close = realClose;
	});

	it('asks first, and deletes only on confirm', async () => {
		const onDelete = vi.fn(async () => {});
		const item = makeItem('Ship it');
		const { getByRole, queryByRole } = render(<ItemView canEdit item={item} onDelete={onDelete} />);

		fireEvent.click(getByRole('button', { name: 'Delete Task' }));
		expect(onDelete).not.toHaveBeenCalled();
		const dialog = getByRole('dialog');
		expect(dialog.textContent).toContain('Ship it');

		fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Task' }));

		await waitFor(() => expect(onDelete).toHaveBeenCalledWith(item));
		await waitFor(() => expect(queryByRole('dialog')).toBeNull());
	});

	it('shows a failed delete in the dialog and keeps it open', async () => {
		const onDelete = vi.fn(async () => {
			throw new Error('You have view access to this project');
		});
		const { getByRole, findByRole } = render(<ItemView canEdit item={makeItem('Ship it')} onDelete={onDelete} />);

		fireEvent.click(getByRole('button', { name: 'Delete Task' }));
		fireEvent.click(within(getByRole('dialog')).getByRole('button', { name: 'Delete Task' }));

		expect((await findByRole('alert')).textContent).toBe('You have view access to this project');
		expect(getByRole('dialog')).toBeTruthy();
	});
});

const ERIN = { slug: 'erin', name: 'Erin Editor', avatarUrl: null };
const MEMBERS = [
	{ slug: 'acme', name: 'Alice Ames', email: 'alice@example.com', avatarUrl: null, role: 'owner', effectiveRole: 'owner' },
	{ slug: 'erin', name: 'Erin Editor', email: 'erin@example.com', avatarUrl: null, role: 'editor', effectiveRole: 'editor' },
	{ slug: 'vera', name: 'Vera Viewer', email: 'vera@example.com', avatarUrl: null, role: 'viewer', effectiveRole: 'viewer' },
];

function assigneeField(container: Element): Element {
	const label = [...container.querySelectorAll('span')].find((span) => span.textContent === 'Assignee');
	if (!label?.parentElement) throw new Error('No Assignee field in the rendered ItemView');
	return label.parentElement;
}

// jsdom parses <dialog> but implements none of its methods, and the assignee picker is
// a modal. Restored once, at the end, since Dialog closes itself on unmount, which
// testing-library's own afterEach runs after any per-test restore would.
const nativeShowModal = HTMLDialogElement.prototype.showModal;
const nativeClose = HTMLDialogElement.prototype.close;

afterAll(() => {
	HTMLDialogElement.prototype.showModal = nativeShowModal;
	HTMLDialogElement.prototype.close = nativeClose;
});

describe('ItemView assignee', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		HTMLDialogElement.prototype.showModal = function showModal(): void { this.open = true; };
		HTMLDialogElement.prototype.close = function close(): void { this.open = false; };
		vi.mocked(fetchClient.get).mockImplementation(async (url: string) => {
			if (url === '/api/projects/acme/specboard/members?pushAccess=false') return MEMBERS;
			throw new Error(`Unexpected GET ${url} in an ItemView test`);
		});
	});

	it('shows the assignee by avatar and name, or Unassigned', () => {
		const assigned = render(<ItemView canEdit item={makeItem('Mine', { assignee: ERIN })} />);
		expect(assigneeField(assigned.container).textContent).toBe('AssigneeEEErin EditorChange');
		assigned.unmount();

		const open = render(<ItemView canEdit item={makeItem('Nobody\'s')} />);
		expect(assigneeField(open.container).textContent).toBe('AssigneeUnassignedAssign');
	});

	it('picks from the owner and members, by slug', async () => {
		const item = makeItem('Pick');
		const assign = vi.spyOn(item, 'assign').mockResolvedValue(undefined);
		const { getByText, findByText, queryByText } = render(<ItemView canEdit item={item} />);

		fireEvent.click(getByText('Assign'));
		const row = (await findByText('Erin Editor')).closest('button')!;

		expect(row.textContent).toBe('EEErin EditorEditor');
		expect(getByText('Alice Ames').closest('button')!.textContent).toContain('Owner');
		expect(getByText('Vera Viewer')).toBeTruthy();
		expect(queryByText('Unassign')).toBeNull();
		fireEvent.click(row);

		expect(assign).toHaveBeenCalledWith('erin');
		await waitFor(() => expect(queryByText('Vera Viewer')).toBeNull());
	});

	it('unassigns explicitly, offered only when someone is assigned', async () => {
		const item = makeItem('Mine', { assignee: ERIN });
		const assign = vi.spyOn(item, 'assign').mockResolvedValue(undefined);
		const { getByLabelText, findByText } = render(<ItemView canEdit item={item} />);

		fireEvent.click(getByLabelText('Change assignee'));
		fireEvent.click(await findByText('Unassign'));

		expect(assign).toHaveBeenCalledWith(null);
	});

	it('shows the server\'s refusal', async () => {
		const item = makeItem('Pick');
		vi.spyOn(item, 'assign').mockRejectedValue(
			new FetchError('HTTP 400: Bad Request', 400, undefined, { error: 'vera is not the owner or a member of this project' })
		);
		const { getByText, findByText, findByRole } = render(<ItemView canEdit item={item} />);

		fireEvent.click(getByText('Assign'));
		fireEvent.click(await findByText('Vera Viewer'));

		expect((await findByRole('alert')).textContent).toBe('vera is not the owner or a member of this project');
	});

	it('is read-only for someone who can\'t edit', () => {
		const { container } = render(<ItemView canEdit={false} item={makeItem('Theirs', { assignee: ERIN })} />);

		expect(assigneeField(container).textContent).toBe('AssigneeEEErin Editor');
	});
});

describe('ItemView people', () => {
	it('names who created it and who is working on it', () => {
		const kevin = { slug: 'kev', name: 'Kevin Jonson', avatarUrl: null };
		const item = makeItem('Worked', {
			origin: { actor: { type: 'user', person: kevin } },
			workers: [{ id: 'w1', branch: 'feat', startedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), actor: { type: 'agent', person: kevin, client: { name: 'claude-code' }, deviceName: 'laptop' } }],
		});
		const { container } = render(<ItemView canEdit item={item} />);

		expect(container.textContent).toContain('Created byKJKevin Jonson');
		expect(container.textContent).toContain('Working nowKJKevin Jonson via claude-code on laptop · ');
	});
});
