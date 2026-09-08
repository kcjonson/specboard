/**
 * NewItemForm — the payload it hands its caller, and the statuses it offers.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { NewItemForm } from './NewItemForm';

// The parent picker is a modal that queries the server and has its own tests;
// these are about the emitted payload, so stand in its two outcomes.
vi.mock('@specboard/pages', () => ({
	ItemPicker: ({ clearOption, onSelect }: {
		clearOption?: { label: string; onSelect: () => void };
		onSelect: (itemKey: string) => void;
	}) => (
		<div>
			<button type="button" onClick={() => onSelect('SB-9')}>Auth System</button>
			{clearOption && <button type="button" onClick={clearOption.onSelect}>{clearOption.label}</button>}
		</div>
	),
}));

// Slate needs a real editing surface; these tests are about the emitted payload,
// so stand in a serializer with a known result.
vi.mock('../RichTextEditor', () => ({
	RichTextEditor: () => null,
	serializeToText: () => 'Body text',
	deserializeFromText: () => [],
}));

function titleField(container: Element): HTMLInputElement {
	const field = container.querySelector('input[type="text"]');
	if (!(field instanceof HTMLInputElement)) {
		throw new Error('No text input in the rendered NewItemForm');
	}
	return field;
}

function statusField(container: Element): HTMLSelectElement {
	const field = container.querySelector('select');
	if (!(field instanceof HTMLSelectElement)) {
		throw new Error('No status select in the rendered NewItemForm');
	}
	return field;
}

/** By label, not by position: the parent field puts a button ahead of the footer. */
function buttonLabelled(container: Element, label: string): HTMLButtonElement {
	const button = Array.from(container.querySelectorAll('button'))
		.find((el) => el.textContent?.trim().startsWith(label));
	if (!(button instanceof HTMLButtonElement)) {
		throw new Error(`No button labelled "${label}" in the rendered NewItemForm`);
	}
	return button;
}

function createButton(container: Element): HTMLButtonElement {
	return buttonLabelled(container, 'Create');
}

describe('NewItemForm', () => {
	it('emits the drafted title, description, status and type', () => {
		const onCreate = vi.fn();
		const { container } = render(<NewItemForm projectSlug="specboard" createType="bug" onCreate={onCreate} />);

		fireEvent.input(titleField(container), { target: { value: '  Crash on save  ' } });
		fireEvent.change(statusField(container), { target: { value: 'in_progress' } });
		fireEvent.click(createButton(container));

		expect(onCreate).toHaveBeenCalledWith({
			title: 'Crash on save',
			description: 'Body text',
			status: 'in_progress',
			type: 'bug',
		});
	});

	it('passes a parentKey through when one was supplied', () => {
		const onCreate = vi.fn();
		const { container } = render(<NewItemForm projectSlug="specboard" createType="task" parentKey="SB-7" onCreate={onCreate} />);

		fireEvent.input(titleField(container), { target: { value: 'Child task' } });
		fireEvent.click(createButton(container));

		expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ parentKey: 'SB-7' }));
	});

	it('omits parentKey entirely when there is no parent', () => {
		const onCreate = vi.fn();
		const { container } = render(<NewItemForm projectSlug="specboard" onCreate={onCreate} />);

		fireEvent.input(titleField(container), { target: { value: 'Standalone epic' } });
		fireEvent.click(createButton(container));

		expect(onCreate.mock.calls.at(0)?.[0]).not.toHaveProperty('parentKey');
	});

	it('shows the parent it opened with, and creates under the one the picker chose', () => {
		const onCreate = vi.fn();
		const { container } = render(
			<NewItemForm projectSlug="specboard" createType="task" parentKey="SB-7" onCreate={onCreate} />
		);

		expect(container.textContent).toContain('SB-7');

		fireEvent.click(buttonLabelled(container, 'Change'));
		fireEvent.click(buttonLabelled(container, 'Auth System'));
		fireEvent.input(titleField(container), { target: { value: 'Child task' } });
		fireEvent.click(createButton(container));

		expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ parentKey: 'SB-9' }));
	});

	it('drops the parent entirely when the picker\'s clear row is chosen', () => {
		const onCreate = vi.fn();
		const { container } = render(
			<NewItemForm projectSlug="specboard" createType="task" parentKey="SB-7" onCreate={onCreate} />
		);

		fireEvent.click(buttonLabelled(container, 'Change'));
		fireEvent.click(buttonLabelled(container, 'No parent'));
		fireEvent.input(titleField(container), { target: { value: 'Standalone task' } });
		fireEvent.click(createButton(container));

		expect(onCreate.mock.calls.at(0)?.[0]).not.toHaveProperty('parentKey');
	});

	it('offers only the statuses a brand new item can be in', () => {
		const { container } = render(<NewItemForm projectSlug="specboard" onCreate={vi.fn()} />);

		const values = Array.from(statusField(container).options).map((o) => o.value);

		expect(values).toEqual(['ready', 'in_progress', 'done']);
	});

	it('does not create anything from a blank title', () => {
		const onCreate = vi.fn();
		const { container } = render(<NewItemForm projectSlug="specboard" onCreate={onCreate} />);

		fireEvent.input(titleField(container), { target: { value: '   ' } });
		const button = createButton(container);

		expect(button.disabled).toBe(true);
		fireEvent.click(button);
		expect(onCreate).not.toHaveBeenCalled();
	});

	// Text and Select render <label htmlFor={id}>, so a field with no id gets a
	// label pointing at nothing. The ids are also distinct from ItemView's, which
	// can be mounted in the drawer while this dialog is open.
	it('associates every label with its field, under ids of its own', () => {
		const { container } = render(<NewItemForm projectSlug="specboard" onCreate={vi.fn()} />);

		for (const label of Array.from(container.querySelectorAll('label'))) {
			const target = label.getAttribute('for');
			expect(target).toBeTruthy();
			expect(container.querySelector(`#${target}`)).not.toBeNull();
			expect(target?.startsWith('new-item-')).toBe(true);
		}
	});
});
