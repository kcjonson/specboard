/**
 * RichTextEditor - value synchronisation
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/preact';
import { RichTextEditor, deserializeFromText } from './RichTextEditor';

/** Text as the editor actually renders it. */
function rendered(container: Element): string {
	return (container.querySelector('[data-slate-editor]')?.textContent || '').trim();
}

describe('RichTextEditor', () => {
	it('renders the value it is given', () => {
		const { container } = render(
			<RichTextEditor value={deserializeFromText('First description')} onChange={() => {}} />
		);

		expect(rendered(container)).toBe('First description');
	});

	// The planning drawer keeps one editor mounted and swaps the item under it, so a
	// new value has to replace what is on screen. Slate reads `initialValue` only on
	// mount, which left the previously selected item's description showing.
	it('replaces its content when a different value arrives', async () => {
		const { container, rerender } = render(
			<RichTextEditor value={deserializeFromText('First description')} onChange={() => {}} />
		);

		rerender(
			<RichTextEditor value={deserializeFromText('Second description')} onChange={() => {}} />
		);

		await waitFor(() => expect(rendered(container)).toBe('Second description'));
	});

	it('clears its content for an item with no description', async () => {
		const { container, rerender } = render(
			<RichTextEditor value={deserializeFromText('First description')} onChange={() => {}} />
		);

		rerender(<RichTextEditor value={deserializeFromText('')} onChange={() => {}} />);

		await waitFor(() => expect(rendered(container)).toBe(''));
	});

	// Replacing the document produces Slate operations like any edit. Reporting them
	// would mark the newly opened item dirty and save back a description nobody typed.
	it('does not report a programmatic replacement as an edit', async () => {
		const onChange = vi.fn();
		const { container, rerender } = render(
			<RichTextEditor value={deserializeFromText('First description')} onChange={onChange} />
		);

		rerender(
			<RichTextEditor value={deserializeFromText('Second description')} onChange={onChange} />
		);

		await waitFor(() => expect(rendered(container)).toBe('Second description'));
		expect(onChange).not.toHaveBeenCalled();
	});
	// A replacement must not leave the editor in a state where the next one is
	// ignored: switching between three items in a row has to land on all three.
	it('keeps applying replacements across repeated switches', async () => {
		const onChange = vi.fn();
		const { container, rerender } = render(
			<RichTextEditor value={deserializeFromText('First description')} onChange={onChange} />
		);

		for (const text of ['Second description', '', 'Third description']) {
			rerender(<RichTextEditor value={deserializeFromText(text)} onChange={onChange} />);
			await waitFor(() => expect(rendered(container)).toBe(text));
		}

		expect(onChange).not.toHaveBeenCalled();
	});
});
