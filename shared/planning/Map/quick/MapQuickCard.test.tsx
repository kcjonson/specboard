/**
 * The quick card: what it says, and when it asks for the activity log.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MapItemRow } from '@specboard/core/map-read';
import { act, cleanup, render, waitFor } from '@testing-library/preact';
import { BoardBuilder } from '../layout/board-fixture';
import { EMPTY_OVERLAY, OverlayStore, type OverlayFrame } from '../overlay';
import { ActivityCache } from './activity-cache';
import { quickContent, quickHeight, type QuickMarks } from './quick-content';
import { MapQuickCard } from './MapQuickCard';

afterEach(cleanup);

const NO_MARKS: QuickMarks = { reasons: [], upNext: null, changes: [] };

function scene(): { rows: ReadonlyMap<string, MapItemRow>; item: MapItemRow; blocker: MapItemRow } {
	const b = new BoardBuilder();
	const blocker = b.add({ status: 'in_progress', title: 'Build the index' });
	const item = b.add({ status: 'ready', subStatus: 'needs_input', title: 'Hover card', textBlockerCount: 1 });
	b.block(item, blocker);
	b.work(item, 's1', 'laptop');
	const rows = new Map(b.rows.map((row) => [row.key, row]));
	return { rows, item, blocker };
}

const frame = (over: Partial<OverlayFrame>): OverlayFrame => ({ ...EMPTY_OVERLAY, ...over });

describe('MapQuickCard', () => {
	it('draws nothing until a card is open, and asks for nothing', () => {
		const source = vi.fn().mockResolvedValue([]);
		const store = new OverlayStore();
		const { container } = render(<MapQuickCard store={store} activity={new ActivityCache(source)} bottom={32} />);
		expect(container.querySelector('article')).toBeNull();
		expect(source).not.toHaveBeenCalled();
	});

	it('says title, status, sub-status, sessions, blockers, holds, and progress, at the size placement counted on', () => {
		const { rows, item, blocker } = scene();
		const progress = { done: 3, in_flight: 1, next: 2, later: 0 };
		const store = new OverlayStore();
		const { container } = render(<MapQuickCard store={store} activity={new ActivityCache(() => new Promise(() => {}))} bottom={32} />);
		act(() => store.publish(frame({ rows, quick: { key: item.key, x: 40.4, y: 80, side: 'right', progress, marks: NO_MARKS } })));
		const card = container.querySelector('article') as HTMLElement;
		const text = card.textContent!;
		expect(text).toContain(item.key);
		expect(text).toContain('Hover card');
		expect(text).toContain('Blocked');
		expect(text).toContain('Needs input');
		expect(text).toContain('1 agent session');
		expect(text).toContain(`Waiting on ${blocker.key} Build the index`);
		expect(text).toContain('Held by 1 text blocker');
		expect(text).toContain('3 of 6 done');
		expect(card.style.transform).toBe('translate(40px, 80px)');
		expect(card.style.height).toBe(`${quickHeight(quickContent(item, rows, progress, NO_MARKS))}px`);
	});

	it('fetches the latest activity entry when it opens, shows a quiet loading state, and fills it in without blocking the card', async () => {
		const { rows, item } = scene();
		let resolve: (entries: unknown[]) => void = () => {};
		const source = vi.fn().mockImplementation(() => new Promise((r) => (resolve = r)));
		const store = new OverlayStore();
		const { container, findByText } = render(<MapQuickCard store={store} activity={new ActivityCache(source)} bottom={32} />);
		act(() => store.publish(frame({ rows, quick: { key: item.key, x: 0, y: 0, side: 'right', progress: null, marks: NO_MARKS } })));
		expect(container.textContent).toContain('Hover card');
		expect(container.textContent).toContain('Loading...');
		expect(source).toHaveBeenCalledWith(item.key);

		await act(async () => resolve([{ id: '2', note: 'Wired the hit index into the surface.', actor: { type: 'agent', client: { name: 'Claude Code' }, deviceName: 'laptop' }, createdAt: new Date().toISOString() }]));
		await findByText('Wired the hit index into the surface.');
		expect(container.textContent).toContain('Claude Code on laptop');
	});

	it('says so when the log is empty or could not be read', async () => {
		const { rows, item } = scene();
		const store = new OverlayStore();
		const { container } = render(<MapQuickCard store={store} activity={new ActivityCache(() => Promise.reject(new Error('offline')))} bottom={32} />);
		act(() => store.publish(frame({ rows, quick: { key: item.key, x: 0, y: 0, side: 'right', progress: null, marks: NO_MARKS } })));
		await waitFor(() => expect(container.textContent).toContain('Could not load the latest entry.'));
	});

	it('goes away when the surface closes it', () => {
		const { rows, item } = scene();
		const store = new OverlayStore();
		const { container } = render(<MapQuickCard store={store} activity={new ActivityCache(() => new Promise(() => {}))} bottom={32} />);
		act(() => store.publish(frame({ rows, quick: { key: item.key, x: 0, y: 0, side: 'left', progress: null, marks: NO_MARKS } })));
		expect(container.querySelector('article')).not.toBeNull();
		act(() => store.publish(frame({ rows, quick: null })));
		expect(container.querySelector('article')).toBeNull();
	});

	it('says what changed and when, ahead of the latest activity entry', () => {
		const { rows, item } = scene();
		const store = new OverlayStore();
		const marks: QuickMarks = { reasons: [], upNext: null, changes: ['Finished Oct 3, 3:12 PM', 'PR opened Oct 2, 1:00 PM'] };
		const { container } = render(<MapQuickCard store={store} activity={new ActivityCache(() => new Promise(() => {}))} bottom={32} />);
		act(() => store.publish(frame({ rows, quick: { key: item.key, x: 0, y: 0, side: 'right', progress: null, marks } })));

		const text = container.textContent ?? '';
		expect(text).toContain('Finished Oct 3, 3:12 PM');
		expect(text).toContain('PR opened Oct 2, 1:00 PM');
		expect(text.indexOf('Finished Oct 3')).toBeLessThan(text.indexOf('Latest activity'));
	});
});
