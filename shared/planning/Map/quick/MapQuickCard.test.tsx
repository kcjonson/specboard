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
import type { Rollup } from '../draw-list';
import type { QuickSession } from './agent-content';
import { quickContent, quickHeight } from './quick-content';
import { MapQuickCard } from './MapQuickCard';

afterEach(cleanup);

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

/** A card for an item: where it opens, its family's progress, and the sessions on it, with no agent card. */
const quickOf = (key: string, x: number, y: number, side: 'right' | 'left', progress: Rollup | null, sessions: QuickSession[] = []): NonNullable<OverlayFrame['quick']> => ({
	key,
	x,
	y,
	side,
	progress,
	marks: { reasons: [], upNext: null, sessions, changes: [] },
	agent: null,
});

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
		const sessions = [{ title: 'Session 1, claude-code on laptop', meta: { lead: 'feat/MAP-2', tail: '1 h 30 min on item, last write 5 min ago' }, quiet: false }];
		act(() => store.publish(frame({ rows, quick: quickOf(item.key, 40.4, 80, 'right', progress, sessions) })));
		const card = container.querySelector('article') as HTMLElement;
		const text = card.textContent!;
		expect(text).toContain(item.key);
		expect(text).toContain('Hover card');
		expect(text).toContain('Blocked');
		expect(text).toContain('Needs input');
		expect(text).toContain('Session 1, claude-code on laptop');
		expect(text).toContain('feat/MAP-2 · 1 h 30 min on item, last write 5 min ago');
		expect(text).toContain(`Waiting on ${blocker.key} Build the index`);
		expect(text).toContain('Held by 1 text blocker');
		expect(text).toContain('3 of 6 done');
		expect(card.style.transform).toBe('translate(40px, 80px)');
		expect(card.style.height).toBe(`${quickHeight(quickContent(item, rows, progress, { reasons: [], upNext: null, sessions, changes: [] }))}px`);
	});

	it('fetches the latest activity entry when it opens, shows a quiet loading state, and fills it in without blocking the card', async () => {
		const { rows, item } = scene();
		let resolve: (entries: unknown[]) => void = () => {};
		const source = vi.fn().mockImplementation(() => new Promise((r) => (resolve = r)));
		const store = new OverlayStore();
		const { container, findByText } = render(<MapQuickCard store={store} activity={new ActivityCache(source)} bottom={32} />);
		act(() => store.publish(frame({ rows, quick: quickOf(item.key, 0, 0, 'right', null) })));
		expect(container.textContent).toContain('Hover card');
		expect(container.textContent).toContain('Loading...');
		expect(source).toHaveBeenCalledWith(item.key);

		await act(async () => resolve([{ id: '2', note: 'Wired the hit index into the surface.', actor: { type: 'agent', person: { slug: 'kev', name: 'Kevin', avatarUrl: null }, client: { name: 'Claude Code' }, deviceName: 'laptop' }, createdAt: new Date().toISOString() }]));
		await findByText('Wired the hit index into the surface.');
		expect(container.textContent).toContain('Kevin via Claude Code on laptop');
	});

	it('says so when the log is empty or could not be read', async () => {
		const { rows, item } = scene();
		const store = new OverlayStore();
		const { container } = render(<MapQuickCard store={store} activity={new ActivityCache(() => Promise.reject(new Error('offline')))} bottom={32} />);
		act(() => store.publish(frame({ rows, quick: quickOf(item.key, 0, 0, 'right', null) })));
		await waitFor(() => expect(container.textContent).toContain('Could not load the latest entry.'));
	});

	it('goes away when the surface closes it', () => {
		const { rows, item } = scene();
		const store = new OverlayStore();
		const { container } = render(<MapQuickCard store={store} activity={new ActivityCache(() => new Promise(() => {}))} bottom={32} />);
		act(() => store.publish(frame({ rows, quick: quickOf(item.key, 0, 0, 'left', null) })));
		expect(container.querySelector('article')).not.toBeNull();
		act(() => store.publish(frame({ rows, quick: null })));
		expect(container.querySelector('article')).toBeNull();
	});

	it('says what changed and when, ahead of the latest activity entry', () => {
		const { rows, item } = scene();
		const store = new OverlayStore();
		const open = quickOf(item.key, 0, 0, 'right', null);
		const quick = { ...open, marks: { ...open.marks, changes: ['Finished Oct 3, 3:12 PM', 'PR opened Oct 2, 1:00 PM'] } };
		const { container } = render(<MapQuickCard store={store} activity={new ActivityCache(() => new Promise(() => {}))} bottom={32} />);
		act(() => store.publish(frame({ rows, quick })));

		const text = container.textContent ?? '';
		expect(text).toContain('Finished Oct 3, 3:12 PM');
		expect(text).toContain('PR opened Oct 2, 1:00 PM');
		expect(text.indexOf('Finished Oct 3')).toBeLessThan(text.indexOf('Latest activity'));
	});
});
