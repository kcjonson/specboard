/**
 * BlockersSection - an item's open blockers
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/preact';
import { BlockersSection } from './BlockersSection';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();

vi.mock('@specboard/fetch', () => ({
	fetchClient: {
		get: (...args: unknown[]) => get(...args),
		post: (...args: unknown[]) => post(...args),
		put: (...args: unknown[]) => put(...args),
		delete: (...args: unknown[]) => del(...args),
	},
}));

interface BlockerPayload {
	id: string;
	type: 'item' | 'text';
	text?: string;
	blockerKey?: string;
	blockerTitle?: string;
	createdAt: string;
}

function textBlocker(overrides: Partial<BlockerPayload> = {}): BlockerPayload {
	return {
		id: 'b1',
		type: 'text',
		text: 'Waiting on the design review',
		createdAt: '2026-09-01T00:00:00.000Z',
		...overrides,
	};
}

function renderSection(): ReturnType<typeof render> {
	return render(<BlockersSection projectSlug="specboard" itemKey="SB-12" />);
}

describe('BlockersSection', () => {
	beforeEach(() => {
		get.mockReset();
		post.mockReset();
		put.mockReset();
		del.mockReset();
	});

	it('lists the open blockers once they load', async () => {
		get.mockResolvedValue([
			textBlocker(),
			textBlocker({ id: 'b2', type: 'item', text: undefined, blockerKey: 'SB-40', blockerTitle: 'Ship the API' }),
		]);
		const { container, findByText } = renderSection();

		expect(await findByText('Waiting on the design review')).toBeTruthy();
		expect(await findByText('SB-40 · Ship the API')).toBeTruthy();
		expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(2);
	});

	it('says nothing is blocking only once an empty result has actually arrived', async () => {
		get.mockResolvedValue([]);
		const { findByText } = renderSection();

		expect(await findByText('Nothing blocking this item')).toBeTruthy();
	});

	// A blockers section that failed to load is not an unblocked item. This is the
	// section a person reads to answer "why is this stuck", so the broken state must
	// not assert the opposite of the truth.
	it('shows an error instead of the placeholder when the fetch fails', async () => {
		get.mockRejectedValue(new Error('nope'));
		const { container, findByText } = renderSection();

		expect(await findByText('Could not load the blockers.')).toBeTruthy();
		expect(container.textContent).not.toContain('Nothing blocking this item');
	});

	// The gap before the first response lands is the same wrongness in a shorter
	// window, so it gets the same treatment.
	it('does not claim the item is unblocked while the first fetch is in flight', async () => {
		let settle: (value: BlockerPayload[]) => void = () => {};
		get.mockReturnValue(new Promise<BlockerPayload[]>((resolve) => { settle = resolve; }));
		const { container, findByText } = renderSection();

		expect(container.textContent).not.toContain('Nothing blocking this item');
		expect(container.textContent).toContain('Loading...');

		settle([]);
		expect(await findByText('Nothing blocking this item')).toBeTruthy();
		await waitFor(() => expect(container.textContent).not.toContain('Loading...'));
	});
});
