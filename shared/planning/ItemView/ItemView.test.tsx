/**
 * ItemView title field — a textarea so long titles wrap, but the value stays
 * one line.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { ItemModel } from '@specboard/models';
import { ItemView } from './ItemView';

// SyncModel.fetch ingests an object payload; nothing here should reach it, but a
// stray call should fail loudly rather than on a shape mismatch.
vi.mock('@specboard/fetch', () => ({
	fetchClient: { get: vi.fn().mockResolvedValue({}), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

// The sections below the title each fetch and render their own trees; none of
// them are what these tests are about.
vi.mock('../SpecsSection/SpecsSection', () => ({ SpecsSection: () => null }));
vi.mock('../BlockersSection/BlockersSection', () => ({ BlockersSection: () => null }));
vi.mock('../NotesSection/NotesSection', () => ({ NotesSection: () => null }));
vi.mock('../RichTextEditor', () => ({
	RichTextEditor: () => null,
	serializeToText: () => '',
	deserializeFromText: () => [],
}));

function makeItem(title: string): ItemModel {
	const item = new ItemModel({
		key: 'SB-1',
		projectSlug: 'specboard',
		title,
		type: 'task',
		status: 'ready',
	});
	// ItemView fetches full detail on mount while lastFetched is null. These tests
	// are about the title field, so hand it an item that looks already loaded.
	item.$meta.lastFetched = Date.now();
	vi.spyOn(item, 'save').mockResolvedValue(undefined);
	return item;
}

function titleField(container: Element): HTMLTextAreaElement {
	return container.querySelector('textarea[aria-label="Task title"]') as HTMLTextAreaElement;
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
