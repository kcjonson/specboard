/**
 * ItemView's header: the title field (a textarea so long titles wrap, but the
 * value stays one line) and the Parent field.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/preact';
import { ItemModel } from '@specboard/models';
import { ItemView } from './ItemView';

// Nothing in these tests should reach the network. Throwing beats a silent
// resolve: a stray call names itself instead of surfacing later as a confusing
// downstream error.
vi.mock('@specboard/fetch', () => {
	const unexpected = (method: string): ReturnType<typeof vi.fn> => vi.fn((url: unknown) => {
		throw new Error(`Unexpected ${method} ${String(url)} in a title-field test`);
	});
	return {
		fetchClient: {
			get: unexpected('GET'),
			post: unexpected('POST'),
			put: unexpected('PUT'),
			delete: unexpected('DELETE'),
		},
		FetchError: class extends Error {},
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
		projectSlug: 'specboard',
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
		projectSlug: 'specboard',
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
		const { container } = render(<ItemView item={item} />);
		const field = titleField(container);

		fireEvent.input(field, { target: { value: 'Apply planning search\nand type filter' } });

		expect(field.value).toBe('Apply planning search and type filter');
	});

	it('saves the collapsed value on blur', () => {
		const item = makeItem('Original');
		const { container } = render(<ItemView item={item} />);
		const field = titleField(container);

		fireEvent.input(field, { target: { value: 'One\nTwo' } });
		fireEvent.blur(field);

		expect(item.title).toBe('One Two');
		expect(item.save).toHaveBeenCalled();
	});

	it('renders a title that already contains newlines as one line', () => {
		const item = makeItem('Stored\nwith a break');
		const { container } = render(<ItemView item={item} />);

		expect(titleField(container).value).toBe('Stored with a break');
	});

	it('does not write just because a newline-containing title was focused', () => {
		const item = makeItem('Stored\nwith a break');
		const { container } = render(<ItemView item={item} />);

		fireEvent.blur(titleField(container));

		expect(item.save).not.toHaveBeenCalled();
	});

	it('commits on Enter instead of inserting a line break', () => {
		const item = makeItem('Original');
		const { container } = render(<ItemView item={item} />);
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
		const { rerender } = render(<ItemView item={first} />);

		const pristine = editorProps?.value;
		// Driving onChange directly is not an event, so it needs its own flush.
		act(() => editorProps?.onChange([{ type: 'paragraph', children: [{ text: 'unsaved draft' }] }]));
		expect(editorProps?.value).not.toBe(pristine);

		rerender(<ItemView item={makeItemWith('SB-2', '')} />);

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
		const { getByText } = render(<ItemView item={item} onOpenItem={onOpenItem} />);

		fireEvent.click(getByText('SB-4 · UI Library & Design System'));

		expect(onOpenItem).toHaveBeenCalledWith('SB-4');
	});

	it('shows a parentless task as None, so it can still be given one', () => {
		const item = makeItem('Orphan');
		const { container } = render(<ItemView item={item} />);

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
		const { getByText } = render(<ItemView item={item} onOpenItem={vi.fn()} />);

		fireEvent.click(getByText('Change'));
		picker.props?.onSelect('SB-7');
		picker.props?.onSelect('SB-8');

		expect(move).toHaveBeenCalledTimes(1);
		expect(move).toHaveBeenCalledWith('SB-7');
		settleMove();
	});

	it('leaves the field off a top-level epic', () => {
		const item = makeItem('Epic', { type: 'epic' });
		const { container } = render(<ItemView item={item} />);

		expect(container.textContent).not.toContain('Parent');
	});
});
