/**
 * MapView: the states around the canvas (loading, empty, error), the controls, and the
 * history rules for panning and jumping. jsdom has no canvas, so the renderer is a fake.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import type { JSX } from 'preact';
import { BoardBuilder, wholeRead } from './layout/board-fixture';
import { layoutMap } from './layout/layout';
import type { MapLayoutWorker } from './layout/layout-worker-client';
import { MapView } from './MapView';
import type { MapItemType, MapRead } from '@specboard/core/map-read';
import { memoryCollapseStore } from './collapse-store.fixture';
import { MapChangesModel, type ChangesSource } from './changes/changes-model';
import { MapDataModel } from './map-data-model';
import type { MapSearchSource } from './map-search';
import { ActivityCache } from './quick/activity-cache';
import type { MapFrame, MapRenderer } from './renderer';
import type { MapChange } from '@specboard/core/map-changes';
import { formatDateTime } from '../utils/time';
import { baselineDate } from './changes/changes';

const frames: MapFrame[] = [];
const renderer: MapRenderer = {
	resize: vi.fn(),
	refreshTheme: vi.fn(),
	measureLabel: (text) => text.length * 7,
	draw: (frame) => {
		frames.push(frame);
	},
};

vi.mock('./renderer', async (importOriginal) => ({
	...(await importOriginal<typeof import('./renderer')>()),
	createCanvasRenderer: () => renderer,
}));

const layoutCalls = vi.fn();
const worker: MapLayoutWorker = {
	layout: (input) => {
		layoutCalls(input);
		return Promise.resolve({ layout: layoutMap(input), ms: 1 });
	},
	terminate: vi.fn(),
};

function board(count: number): MapRead {
	const b = new BoardBuilder();
	for (let i = 0; i < count; i++) b.add({ status: i % 3 === 0 ? 'done' : i % 3 === 1 ? 'in_progress' : 'ready', created: b.now - i * 86_400_000 });
	return wholeRead(b.rows);
}

const opened: string[] = [];
const closed = vi.fn();

interface MapProps {
	/** What the last-visit read answers; by default a baseline with nothing changed since. */
	changes?: Awaited<ReturnType<ChangesSource['read']>>;
	openItemKey?: string;
	covered?: number;
	search?: string;
	type?: MapItemType | null;
	searchSource?: MapSearchSource;
}

type RenderedMap = Omit<ReturnType<typeof render>, 'rerender'> & { model: MapDataModel; changes: MapChangesModel; advance: ReturnType<typeof vi.fn>; rerender(next: MapProps): void };

const cleared = vi.fn();

function renderMap(source: () => Promise<MapRead>, props: MapProps = {}, clock?: () => number): RenderedMap {
	const model = new MapDataModel(source, () => worker, memoryCollapseStore(), clock);
	const activity = new ActivityCache(() => Promise.resolve([]));
	const advance = vi.fn().mockResolvedValue(undefined);
	const read = props.changes ?? { baseline: Date.now() - 86_400_000, readAt: Date.now(), changes: [] };
	const changes = new MapChangesModel({ read: () => Promise.resolve(read), advance });
	const searchSource = props.searchSource ?? (() => Promise.resolve([]));
	const view = (next: MapProps): JSX.Element => (
		<MapView
			projectRef="acme/specboard"
			model={model}
			activity={activity}
			searchSource={searchSource}
			changes={changes}
			covered={next.covered ?? 0}
			openItemKey={next.openItemKey}
			search={next.search ?? ''}
			type={next.type ?? null}
			onClear={cleared}
			onOpenItem={(key) => opened.push(key)}
			onCloseItem={closed}
		/>
	);
	const rendered = render(view(props));
	return { ...rendered, model, changes, advance, rerender: (next) => rendered.rerender(view(next)) };
}

// jsdom has no pointer events; a mouse event with the pointer fields on it is enough for the handlers.
if (typeof window.PointerEvent === 'undefined') {
	class PointerEventShim extends MouseEvent {
		readonly pointerId: number;
		readonly pointerType: string;
		readonly isPrimary: boolean;
		constructor(type: string, init: NonNullable<ConstructorParameters<typeof MouseEvent>[1]> & { pointerId?: number; pointerType?: string; isPrimary?: boolean } = {}) {
			super(type, init);
			this.pointerId = init.pointerId ?? 1;
			this.pointerType = init.pointerType ?? 'mouse';
			this.isPrimary = init.isPrimary ?? true;
		}
	}
	Object.defineProperty(window, 'PointerEvent', { value: PointerEventShim, configurable: true });
}

beforeEach(() => {
	frames.length = 0;
	opened.length = 0;
	closed.mockReset();
	layoutCalls.mockReset();
	cleared.mockReset();
	window.history.replaceState(null, '', '/projects/acme/specboard/planning?view=map');
	// The whole Map is 1000 by 532; the toolbar over its corner is a small box, so labels and cards still have the rest.
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
		const toolbar = this.getAttribute('role') === 'group';
		// The stepping bar sits at the top, in the middle.
		const bar = this.className.includes('barSlot');
		if (bar) return { x: 380, y: 12, left: 380, top: 12, right: 620, bottom: 48, width: 240, height: 36, toJSON: () => ({}) };
		return toolbar
			? { x: 12, y: 12, left: 12, top: 12, right: 200, bottom: 52, width: 188, height: 40, toJSON: () => ({}) }
			: { x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 532, width: 1000, height: 532, toJSON: () => ({}) };
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

const control = (container: HTMLElement, name: string): HTMLButtonElement =>
	Array.from(container.querySelectorAll('button')).find((b) => b.textContent === name || b.getAttribute('aria-label') === name) as HTMLButtonElement;

describe('MapView states', () => {
	it('draws the ruler frame and says it is loading while the read and layout run', async () => {
		const { container, getByRole } = renderMap(() => new Promise(() => {}));
		expect(getByRole('status').textContent).toBe('Loading the map...');
		expect(container.querySelector('canvas')).not.toBeNull();
		await waitFor(() => expect(frames.length).toBeGreaterThan(0));
		expect(frames.at(-1)).toMatchObject({ dots: [], ruler: null });
		expect(control(container, 'Fit all').disabled).toBe(true);
		expect(control(container, 'Now').disabled).toBe(true);
	});

	it('brings every dot in at once and enables the controls', async () => {
		const { container, queryByRole } = renderMap(() => Promise.resolve(board(9)));
		await waitFor(() => expect(queryByRole('status')).toBeNull());
		await waitFor(() => expect(frames.at(-1)!.dots.length).toBe(9));
		expect(frames.every((frame) => frame.dots.length === 0 || frame.dots.length === 9)).toBe(true);
		expect(frames.at(-1)!.ruler).not.toBeNull();
		expect(container.querySelector('canvas')!.getAttribute('aria-label')).toBe('Map of 9 items');
		for (const name of ['Fit all', 'Now', 'Zoom out', 'Zoom in']) expect(control(container, name).disabled).toBe(false);
	});

	it('says so when the read came back summarized, and does not offer its row count as the item count', async () => {
		const { findByText, container } = renderMap(() => Promise.resolve({ ...board(5), summarized: true }));
		expect((await findByText(/finished families are summarized/)).getAttribute('role')).toBe('status');
		expect(container.querySelector('canvas')!.getAttribute('aria-label')).toBe('Map of 5 items, with finished families summarized');
	});

	it('shows no such notice for a read that was not summarized', async () => {
		const { container, queryByRole } = renderMap(() => Promise.resolve(board(5)));
		await waitFor(() => expect(container.querySelector('canvas')!.getAttribute('aria-label')).toBe('Map of 5 items'));
		expect(queryByRole('status')).toBeNull();
	});

	it('says so on the canvas when the project has no items', async () => {
		const { container, findByText } = renderMap(() => Promise.resolve(wholeRead([])));
		await findByText(/Nothing on the map yet/);
		expect(control(container, 'Fit all').disabled).toBe(true);
		await waitFor(() => expect(frames.at(-1)).toMatchObject({ dots: [], ruler: null }));
	});

	it('shows the error state with a retry that loads the map', async () => {
		const source = vi.fn<() => Promise<MapRead>>().mockRejectedValueOnce(new Error('HTTP 500: Internal Server Error')).mockResolvedValue(board(4));
		const { findByRole, queryByRole } = renderMap(source);
		const alert = await findByRole('alert');
		expect(alert.textContent).toContain('Error: HTTP 500: Internal Server Error');

		fireEvent.click(await findByRole('button', { name: 'Retry' }));
		await waitFor(() => expect(queryByRole('alert')).toBeNull());
		await waitFor(() => expect(frames.at(-1)!.dots.length).toBe(4));
	});

	it('stops the layout worker when it unmounts', async () => {
		const { unmount } = renderMap(() => Promise.resolve(board(3)));
		await waitFor(() => expect(frames.at(-1)?.dots.length).toBe(3));
		unmount();
		expect(worker.terminate).toHaveBeenCalled();
	});
});

describe('MapView zoom keys', () => {
	// Reduced motion turns the camera flight into a cut, so a keypress lands at once.
	beforeEach(() => {
		window.matchMedia = ((query: string) => ({
			matches: query.includes('reduce'),
			media: query,
			addEventListener: () => {},
			removeEventListener: () => {},
		})) as unknown as typeof window.matchMedia;
	});

	afterEach(() => {
		delete (window as { matchMedia?: unknown }).matchMedia;
	});

	const scale = (): number => frames.at(-1)!.transform.k;
	const ready = async (): Promise<number> => {
		renderMap(() => Promise.resolve(board(9)));
		await waitFor(() => expect(frames.at(-1)?.dots.length).toBe(9));
		return scale();
	};
	const press = (init: Partial<KeyboardEvent>, target: Element = document.body): void => {
		fireEvent.keyDown(target, { code: 'KeyZ', ...init });
	};

	it('zooms in on Z and out on Alt+Z, by the buttons\' step', async () => {
		const start = await ready();
		press({});
		await waitFor(() => expect(scale()).toBeCloseTo(start * 1.4));
		press({ altKey: true, key: 'Ω' });
		await waitFor(() => expect(scale()).toBeCloseTo(start));
	});

	it('does nothing on Cmd+Z or Ctrl+Z', async () => {
		const start = await ready();
		const painted = frames.length;
		press({ metaKey: true });
		press({ ctrlKey: true });
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(frames.length).toBe(painted);
		expect(scale()).toBe(start);
	});

	it('does nothing from inside an input', async () => {
		const start = await ready();
		const input = document.createElement('input');
		document.body.appendChild(input);
		const painted = frames.length;
		press({}, input);
		press({ altKey: true }, input);
		await new Promise((resolve) => setTimeout(resolve, 100));
		input.remove();
		expect(frames.length).toBe(painted);
		expect(scale()).toBe(start);
	});

	it('zooms about the pointer when it is over the canvas', async () => {
		const start = await ready();
		const before = frames.at(-1)!.transform;
		const canvas = document.querySelector('canvas')!;
		fireEvent.pointerMove(canvas, { clientX: 200, clientY: 100 });
		press({});
		await waitFor(() => expect(scale()).toBeCloseTo(start * 1.4));
		const after = frames.at(-1)!.transform;
		// The layout point under the pointer stays under it.
		expect((200 - after.x) / after.k).toBeCloseTo((200 - before.x) / before.k);
		expect((100 - after.y) / after.k).toBeCloseTo((100 - before.y) / before.k);
	});
});

describe('MapView collapse', () => {
	it('collapses a region from its label\'s control, in place, and points at the control', async () => {
		const b = new BoardBuilder();
		const epic = b.add({ type: 'epic', status: 'in_progress', title: 'Open family' });
		for (let i = 0; i < 4; i++) b.add({ parentKey: epic.key, status: i ? 'ready' : 'in_progress' });
		for (let i = 0; i < 4; i++) b.add({ status: 'ready' });
		renderMap(() => Promise.resolve(wholeRead(b.rows)));
		await waitFor(() => expect(frames.at(-1)?.labels.length).toBe(1));
		const { labels, transform } = frames.at(-1)!;
		const { toggle } = labels[0]!;
		const canvas = document.querySelector('canvas')!;

		// The camera has only just been placed, so the pointer is looked at once it has been still a moment.
		fireEvent.pointerMove(canvas, { clientX: toggle.x, clientY: toggle.y });
		await waitFor(() => expect(canvas.dataset.target).toBe('control'));
		fireEvent.pointerMove(canvas, { clientX: 1, clientY: 1 });
		expect(canvas.dataset.target).toBeUndefined();

		fireEvent.pointerDown(canvas, { clientX: toggle.x, clientY: toggle.y });
		fireEvent.pointerUp(canvas, { clientX: toggle.x, clientY: toggle.y });
		await waitFor(() => expect(frames.at(-1)!.dots.find((dot) => dot.key === epic.key)?.folded).toBeTruthy());
		expect(frames.at(-1)!.regions).toEqual([]);
		expect(frames.at(-1)!.transform).toEqual(transform);
	});
});

describe('MapView and the URL', () => {
	it('opens centered on the item named by ?focus=', async () => {
		window.history.replaceState(null, '', '/projects/acme/specboard/planning?view=map&focus=map-5');
		const read = board(9);
		renderMap(() => Promise.resolve(read));
		await waitFor(() => expect(frames.at(-1)?.dots.length).toBe(9));
		const dot = frames.at(-1)!.dots.find((d) => d.key === 'MAP-5')!;
		const { transform } = frames.at(-1)!;
		expect(transform.x + transform.k * dot.x).toBeCloseTo(500, 0);
		expect(transform.y + transform.k * dot.y).toBeCloseTo(250, 0);
	});

	it('replaces the history entry as the person pans, anchoring on the item in the middle', async () => {
		renderMap(() => Promise.resolve(board(9)));
		await waitFor(() => expect(frames.at(-1)?.dots.length).toBe(9));
		const entries = window.history.length;
		expect(window.location.search).toBe('?view=map');

		const canvas = document.querySelector('canvas')!;
		fireEvent.wheel(canvas, { deltaX: 40, deltaY: 10 });
		await waitFor(() => expect(new URLSearchParams(window.location.search).get('focus')).toMatch(/^MAP-\d+$/), { timeout: 2000 });
		expect(new URLSearchParams(window.location.search).get('view')).toBe('map');
		expect(window.history.length).toBe(entries);
	});

	it('pushes an entry for a jump, and drops the anchor for fit all', async () => {
		window.history.replaceState(null, '', '/projects/acme/specboard/planning?view=map&focus=MAP-3');
		const { container } = renderMap(() => Promise.resolve(board(9)));
		await waitFor(() => expect(frames.at(-1)?.dots.length).toBe(9));
		const entries = window.history.length;

		fireEvent.click(control(container, 'Fit all'));
		expect(window.location.search).toBe('?view=map');
		expect(window.history.length).toBe(entries + 1);
	});

	it('does not push an entry for a jump that changes nothing in the URL', async () => {
		const { container } = renderMap(() => Promise.resolve(board(9)));
		await waitFor(() => expect(frames.at(-1)?.dots.length).toBe(9));
		const entries = window.history.length;
		fireEvent.click(control(container, 'Now'));
		expect(window.history.length).toBe(entries);
	});
});

describe('MapView interaction', () => {
	const dotPoint = (key: string): { clientX: number; clientY: number } => {
		const { dots, transform } = frames.at(-1)!;
		const dot = dots.find((d) => d.key === key)!;
		return { clientX: transform.x + transform.k * dot.x, clientY: transform.y + transform.k * dot.y };
	};
	const click = (canvas: Element, at: { clientX: number; clientY: number }, pointerType = 'mouse'): void => {
		fireEvent.pointerDown(canvas, { ...at, pointerType });
		fireEvent.pointerUp(canvas, { ...at, pointerType });
	};
	const lit = (): string | undefined => frames.at(-1)!.focus.to?.key;

	it('opens an item in the drawer on a click, and lights it', async () => {
		renderMap(() => Promise.resolve(board(9)));
		await waitFor(() => expect(frames.at(-1)?.dots.length).toBe(9));
		const canvas = document.querySelector('canvas')!;
		click(canvas, dotPoint('MAP-5'));
		expect(opened).toEqual(['MAP-5']);
		await waitFor(() => expect(lit()).toBe('MAP-5'));
	});

	it('does not open anything for a press on empty ground', async () => {
		renderMap(() => Promise.resolve(board(9)));
		await waitFor(() => expect(frames.at(-1)?.dots.length).toBe(9));
		click(document.querySelector('canvas')!, { clientX: 2, clientY: 2 });
		expect(opened).toEqual([]);
	});

	it('Escape closes the drawer first and clears the selection second', async () => {
		const { rerender } = renderMap(() => Promise.resolve(board(9)), { openItemKey: 'MAP-5', covered: 400 });
		await waitFor(() => expect(lit()).toBe('MAP-5'));

		fireEvent.keyDown(document.body, { key: 'Escape' });
		expect(closed).toHaveBeenCalledTimes(1);
		// The page closes the drawer; the selection it leaves lit stays.
		rerender({ covered: 0 });
		await waitFor(() => expect(frames.length).toBeGreaterThan(0));
		expect(lit()).toBe('MAP-5');

		fireEvent.keyDown(document.body, { key: 'Escape' });
		expect(closed).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(lit()).toBeUndefined());
	});

	it('leaves Escape to a dialog or a field that has it', async () => {
		renderMap(() => Promise.resolve(board(9)), { openItemKey: 'MAP-5', covered: 400 });
		await waitFor(() => expect(lit()).toBe('MAP-5'));
		const input = document.createElement('input');
		const dialog = document.createElement('div');
		dialog.setAttribute('role', 'dialog');
		const inner = document.createElement('button');
		dialog.appendChild(inner);
		document.body.append(input, dialog);
		fireEvent.keyDown(input, { key: 'Escape' });
		fireEvent.keyDown(inner, { key: 'Escape' });
		input.remove();
		dialog.remove();
		expect(closed).not.toHaveBeenCalled();
	});

	it('keeps the selection in step with the item URL as related items in the drawer move it', async () => {
		const { rerender } = renderMap(() => Promise.resolve(board(9)), { openItemKey: 'MAP-2', covered: 400 });
		await waitFor(() => expect(lit()).toBe('MAP-2'));
		rerender({ openItemKey: 'MAP-6', covered: 400 });
		await waitFor(() => expect(lit()).toBe('MAP-6'));
	});

	it('pans so the selection clears the drawer that opened over it', async () => {
		const { rerender } = renderMap(() => Promise.resolve(board(9)));
		await waitFor(() => expect(frames.at(-1)?.dots.length).toBe(9));
		// The dot furthest right would sit under a 500 px drawer.
		const right = frames.at(-1)!.dots.reduce((a, b) => (b.x > a.x ? b : a));
		const before = dotPoint(right.key).clientX;
		expect(before).toBeGreaterThan(1000 - 500);
		rerender({ openItemKey: right.key, covered: 500 });
		await waitFor(() => expect(dotPoint(right.key).clientX).toBeLessThanOrEqual(1000 - 500));
	});

	it('toggles All links', async () => {
		const { container } = renderMap(() => Promise.resolve(board(9)));
		await waitFor(() => expect(frames.at(-1)?.dots.length).toBe(9));
		const toggle = control(container, 'All links');
		expect(toggle.getAttribute('aria-pressed')).toBe('false');
		fireEvent.click(toggle);
		expect(toggle.getAttribute('aria-pressed')).toBe('true');
		await waitFor(() => expect(frames.at(-1)!.allLinks).toBe(true));
		fireEvent.click(toggle);
		await waitFor(() => expect(frames.at(-1)!.allLinks).toBe(false));
	});

	it('on a touch, the first tap selects and the second opens', async () => {
		renderMap(() => Promise.resolve(board(9)));
		await waitFor(() => expect(frames.at(-1)?.dots.length).toBe(9));
		const canvas = document.querySelector('canvas')!;
		click(canvas, dotPoint('MAP-5'), 'touch');
		await waitFor(() => expect(lit()).toBe('MAP-5'));
		expect(opened).toEqual([]);
		click(canvas, dotPoint('MAP-5'), 'touch');
		expect(opened).toEqual(['MAP-5']);
	});

	it('pulls a dot with a drag, and a drag on empty ground is not a click', async () => {
		renderMap(() => Promise.resolve(board(9)));
		await waitFor(() => expect(frames.at(-1)?.dots.length).toBe(9));
		const canvas = document.querySelector('canvas')!;
		const at = dotPoint('MAP-5');
		fireEvent.pointerDown(canvas, at);
		fireEvent.pointerMove(canvas, { clientX: at.clientX + 30, clientY: at.clientY });
		await waitFor(() => expect(frames.at(-1)!.drag).toMatchObject({ key: 'MAP-5' }));
		expect(canvas.hasAttribute('data-dragging')).toBe(true);
		fireEvent.pointerUp(canvas, { clientX: at.clientX + 30, clientY: at.clientY });
		expect(opened).toEqual([]);
		expect(canvas.hasAttribute('data-dragging')).toBe(false);
		await waitFor(() => expect(frames.at(-1)!.drag).toBeNull(), { timeout: 2000 });

		fireEvent.pointerDown(canvas, { clientX: 2, clientY: 2 });
		fireEvent.pointerMove(canvas, { clientX: 60, clientY: 2 });
		fireEvent.pointerUp(canvas, { clientX: 60, clientY: 2 });
		expect(opened).toEqual([]);
	});

	it('does not open on a press that moved past the click threshold', async () => {
		renderMap(() => Promise.resolve(board(9)));
		await waitFor(() => expect(frames.at(-1)?.dots.length).toBe(9));
		const canvas = document.querySelector('canvas')!;
		const at = dotPoint('MAP-5');
		fireEvent.pointerDown(canvas, { ...at, pointerType: 'touch' });
		fireEvent.pointerMove(canvas, { clientX: at.clientX + 40, clientY: at.clientY, pointerType: 'touch' });
		fireEvent.pointerUp(canvas, { clientX: at.clientX + 40, clientY: at.clientY, pointerType: 'touch' });
		expect(opened).toEqual([]);
	});
});

/** A board with every kind of mark the strip counts and the Map draws: a question, a review, a hold, a deadlock, up next, and a live session. */
function marked(): { read: MapRead; epic: string; asked: string; review: string; hold: string; cycle: [string, string]; upNext: string; live: string; done: string } {
	// The model reads the clock for what is live, so the board is built around the real now.
	const b = new BoardBuilder(Date.now());
	const epic = b.add({ type: 'epic', status: 'in_progress', title: 'Open family' });
	const asked = b.add({ parentKey: epic.key, status: 'in_progress', subStatus: 'needs_input', title: 'Pick a checklist wording' });
	const upNext = b.add({ parentKey: epic.key, status: 'ready', title: 'Import a checklist' });
	const review = b.add({ status: 'in_review', title: 'Review the drawer' });
	const hold = b.add({ status: 'ready', blocked: true, textBlockerCount: 1, title: 'Wait on legal' });
	const first = b.add({ status: 'ready', title: 'Move sessions' });
	const second = b.add({ status: 'ready', title: 'Drop the table' });
	b.block(first, second);
	b.block(second, first);
	const live = b.add({ status: 'in_progress', title: 'Write webhooks' });
	b.work(live, 'session-a', 'laptop', 3);
	const done = b.add({ status: 'done', title: 'Old chore' });
	return { read: wholeRead(b.rows), epic: epic.key, asked: asked.key, review: review.key, hold: hold.key, cycle: [first.key, second.key], upNext: upNext.key, live: live.key, done: done.key };
}

describe('MapView summary strip', () => {
	it('draws with dashes while the read loads, then counts every phase, blocked, what needs a person, and live sessions', async () => {
		const { read } = marked();
		let resolve: (read: MapRead) => void = () => {};
		const { container } = renderMap(() => new Promise<MapRead>((r) => (resolve = r)));
		const strip = container.querySelector('section[aria-label="Project summary"]') as HTMLElement;
		expect(strip.textContent).toContain('Done-');
		resolve(read);
		await waitFor(() => expect(strip.textContent).toContain('Done1'));
		const text = strip.textContent!;
		expect(text).toContain('In flight4');
		expect(text).toContain('Needs a person5');
		expect(text).toContain('Live sessions1');
		expect(text).toMatch(/Updated just now/);
	});

	it('is outside the canvas: it stays while the Map has nothing to draw', async () => {
		const { container, findByText } = renderMap(() => Promise.resolve(wholeRead([])));
		await findByText(/Nothing on the map yet/);
		expect(container.querySelector('section[aria-label="Project summary"]')).not.toBeNull();
	});
});

describe('MapView search and filters', () => {
	const litKeys = (): ReadonlySet<string> | undefined => frames.at(-1)?.focus.to?.dots;

	it('dims what the search did not match, lights and labels what it did, and names the search in the bar', async () => {
		const m = marked();
		const source = vi.fn().mockResolvedValue([m.asked, m.upNext, 'MAP-404']);
		const { findByText, getByRole, container } = renderMap(() => Promise.resolve(m.read), { search: 'checklist', searchSource: source });
		await findByText('Matches for "checklist"');
		expect(source).toHaveBeenCalledWith('checklist');
		await waitFor(() => expect(getByRole('status').textContent).toBe('2 matches'));
		await waitFor(() => expect(litKeys()).toEqual(new Set([m.asked, m.upNext])));
		// The matches' own labels, at a level where only in-flight work is named.
		const labelled = frames.at(-1)!.dotLabels.map((label) => label.key);
		expect(labelled).toContain(m.upNext);
		expect(frames.at(-1)!.outlined.size).toBe(0);
		// The strip does not change with a search: it counts the project.
		expect(container.querySelector('section[aria-label="Project summary"]')!.textContent).toContain('Done1');
	});

	it('steps through the matches left to right, focusing each, and wraps', async () => {
		const m = marked();
		const { findByLabelText, getByRole } = renderMap(() => Promise.resolve(m.read), { search: 'x', searchSource: () => Promise.resolve([m.review, m.hold, m.live]) });
		const next = await findByLabelText('Next');
		await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
		const focused = (): string | undefined => frames.at(-1)!.focus.to?.key;
		const order: string[] = [];
		for (let i = 0; i < 4; i++) {
			fireEvent.click(next);
			await waitFor(() => expect(getByRole('status').textContent).toBe(`${(i % 3) + 1} of 3`));
			// The camera and the focus follow the step on the next frame.
			await waitFor(() => expect(focused()).toBeDefined());
			if (i > 0) await waitFor(() => expect(focused()).not.toBe(order[i - 1]));
			order.push(focused()!);
			await waitFor(() => expect(new URLSearchParams(window.location.search).get('focus')).toBe(focused()));
		}
		expect(order[3]).toBe(order[0]);
		expect(new Set(order.slice(0, 3)).size).toBe(3);
	});

	it('says so in the bar and dims nothing when nothing matched', async () => {
		const m = marked();
		const { findByText, getByRole } = renderMap(() => Promise.resolve(m.read), { search: 'zzz', searchSource: () => Promise.resolve([]) });
		await findByText('Matches for "zzz"');
		await waitFor(() => expect(getByRole('status').textContent).toBe('No matches'));
		expect(litKeys()).toBeUndefined();
	});

	it('says a search failed and offers to try again', async () => {
		const m = marked();
		const source = vi.fn().mockRejectedValueOnce(new Error('HTTP 500')).mockResolvedValue([m.asked]);
		const { findByText, getByRole } = renderMap(() => Promise.resolve(m.read), { search: 'boom', searchSource: source });
		await waitFor(() => expect(getByRole('status').textContent).toBe('Search failed'));
		fireEvent.click(await findByText('Retry'));
		await waitFor(() => expect(getByRole('status').textContent).toBe('1 match'));
		await waitFor(() => expect(litKeys()).toEqual(new Set([m.asked])));
	});

	it('isolates what needs a person with the strip\'s count, and never re-lays out the Map', async () => {
		const m = marked();
		const { getByRole, findByText } = renderMap(() => Promise.resolve(m.read));
		await waitFor(() => expect(frames.at(-1)!.dots.length).toBeGreaterThan(5));
		const before = frames.at(-1)!.dots.map((dot) => [dot.key, dot.x, dot.y]);
		const layouts = layoutCalls.mock.calls.length;

		fireEvent.click(getByRole('button', { name: /^Needs a person/ }));
		await findByText('Filtered: needs a person');
		await waitFor(() => expect(litKeys()).toEqual(new Set([m.asked, m.review, m.hold, m.cycle[0], m.cycle[1]])));
		// The ring on each lit dot is the reason it needs a person.
		const reasons = new Map(frames.at(-1)!.dots.map((dot) => [dot.key, dot.reason]));
		expect(reasons.get(m.asked)).toBe('question');
		expect(reasons.get(m.review)).toBe('review');
		expect(reasons.get(m.hold)).toBe('hold');
		expect(reasons.get(m.cycle[0])).toBe('cycle');

		fireEvent.click(getByRole('button', { name: /^In flight/ }));
		await waitFor(() => expect(litKeys()).toEqual(new Set([m.asked, m.review])));
		fireEvent.click(getByRole('button', { name: /^Live sessions/ }));
		await waitFor(() => expect(litKeys()).toBeUndefined());
		expect(layoutCalls.mock.calls.length).toBe(layouts);
		expect(frames.at(-1)!.dots.map((dot) => [dot.key, dot.x, dot.y])).toEqual(before);
	});

	it('filters by the toolbar\'s type too, and by live sessions', async () => {
		const m = marked();
		const { rerender, getByRole } = renderMap(() => Promise.resolve(m.read));
		await waitFor(() => expect(frames.at(-1)!.dots.length).toBeGreaterThan(5));
		fireEvent.click(getByRole('button', { name: /^Live sessions/ }));
		await waitFor(() => expect(litKeys()).toEqual(new Set([m.live])));
		rerender({ type: 'epic' });
		await waitFor(() => expect(litKeys()).toBeUndefined());
	});

	it('lights a region\'s outline when its parent matches, and keeps the family\'s own members dim', async () => {
		const m = marked();
		renderMap(() => Promise.resolve(m.read), { search: 'family', searchSource: () => Promise.resolve([m.epic]) });
		await waitFor(() => expect(frames.at(-1)?.outlined).toEqual(new Set([m.epic])));
		expect(litKeys()).toEqual(new Set());
		expect(frames.at(-1)!.focus.to!.regions).toEqual(new Set([m.epic]));
	});

	it('Escape clears the search and the filters once the drawer and the selection are done with it', async () => {
		const m = marked();
		const { getByRole, findByText } = renderMap(() => Promise.resolve(m.read), { search: 'x', searchSource: () => Promise.resolve([m.asked]) });
		await findByText('Matches for "x"');
		fireEvent.keyDown(document.body, { key: 'Escape' });
		expect(cleared).toHaveBeenCalledTimes(1);
		cleared.mockClear();
		fireEvent.click(getByRole('button', { name: /^Done/ }));
		fireEvent.click(getByRole('button', { name: 'Clear' }));
		expect(cleared).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(getByRole('button', { name: /^Done/ }).getAttribute('aria-pressed')).toBe('false'));
	});

	it('does not clear anything for Escape typed in a field', async () => {
		const m = marked();
		const { findByText } = renderMap(() => Promise.resolve(m.read), { search: 'x', searchSource: () => Promise.resolve([m.asked]) });
		await findByText('Matches for "x"');
		const input = document.createElement('input');
		document.body.appendChild(input);
		fireEvent.keyDown(input, { key: 'Escape' });
		input.remove();
		expect(cleared).not.toHaveBeenCalled();
	});

	it('lets go of the focus a step took when the bar closes', async () => {
		const m = marked();
		const { findByLabelText, rerender, container } = renderMap(() => Promise.resolve(m.read), { search: 'x', searchSource: () => Promise.resolve([m.review]) });
		const next = await findByLabelText('Next');
		await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
		fireEvent.click(next);
		await waitFor(() => expect(frames.at(-1)!.focus.to?.key).toBe(m.review));
		rerender({ search: '' });
		await waitFor(() => expect(container.querySelector('[aria-label^="Matches for"]')).toBeNull());
		await waitFor(() => expect(frames.at(-1)!.focus.to).toBeNull());
	});
});

describe('MapView up next', () => {
	it('numbers the up-next items on their dots', async () => {
		const m = marked();
		renderMap(() => Promise.resolve(m.read));
		await waitFor(() => expect(frames.at(-1)!.dots.length).toBeGreaterThan(5));
		const numbered = frames.at(-1)!.dots.filter((dot) => dot.upNext !== null);
		expect(numbered.map((dot) => dot.upNext).sort()).toEqual(numbered.map((_, i) => i + 1));
		expect(numbered.find((dot) => dot.upNext === 1)!.key).toBe(m.upNext);
	});
});

describe('MapView since your last visit', () => {
	const HOUR = 3_600_000;
	const litKeys = (): ReadonlySet<string> | undefined => frames.at(-1)?.focus.to?.dots;

	/** Four items changed in this order: filed, a PR opened, a question raised, finished; plus one the Map doesn't carry. */
	function waiting(m: ReturnType<typeof marked>): { baseline: number; readAt: number; changes: MapChange[]; at: (n: number) => number } {
		const baseline = Date.now() - 3 * 24 * HOUR;
		const at = (n: number): number => baseline + n * HOUR;
		const changes: MapChange[] = [
			{ key: m.done, kind: 'finished', at: at(4) },
			{ key: m.asked, kind: 'question', at: at(3) },
			{ key: m.review, kind: 'worked_on', at: at(1) },
			{ key: m.review, kind: 'pr_opened', at: at(2) },
			{ key: m.upNext, kind: 'filed', at: at(1) },
			{ key: 'MAP-404', kind: 'filed', at: at(5) },
		];
		return { baseline, readAt: Date.now(), changes, at };
	}

	it('opens in the changes view with the changes waiting: they are lit, everything else dims, and the bar names the baseline', async () => {
		const m = marked();
		const w = waiting(m);
		const { findByText, getByRole } = renderMap(() => Promise.resolve(m.read), { changes: w });

		await findByText(`Since your last visit, ${baselineDate(w.baseline)}`);
		expect(getByRole('status').textContent).toBe('4 changes');
		await waitFor(() => expect(litKeys()).toEqual(new Set([m.done, m.asked, m.review, m.upNext])));
	});

	it('does not open when nothing changed, and leaves everything at full strength', async () => {
		const m = marked();
		const { container } = renderMap(() => Promise.resolve(m.read));

		await waitFor(() => expect(frames.at(-1)!.dots.length).toBeGreaterThan(5));
		expect(container.querySelector('[aria-label^="Since your last visit"]')).toBeNull();
		expect(litKeys()).toBeUndefined();
		expect(container.querySelector('section[aria-label="Project summary"]')!.textContent).not.toContain('Since');
	});

	it('does not open on a first visit, and sets the baseline from the read time at once', async () => {
		const m = marked();
		const readAt = Date.now() - 5000;
		const { container, advance } = renderMap(() => Promise.resolve(m.read), { changes: { baseline: null, readAt, changes: [] } });

		await waitFor(() => expect(frames.at(-1)!.dots.length).toBeGreaterThan(5));
		await waitFor(() => expect(advance).toHaveBeenCalledWith(readAt, { keepalive: false }));
		expect(container.querySelector('[aria-label^="Since your last visit"]')).toBeNull();
		expect(litKeys()).toBeUndefined();
	});

	it('ignores changes to items the Map does not carry', async () => {
		const m = marked();
		const { baseline, readAt } = waiting(m);
		const { container } = renderMap(() => Promise.resolve(m.read), { changes: { baseline, readAt, changes: [{ key: 'MAP-404', kind: 'filed', at: baseline + HOUR }] } });

		await waitFor(() => expect(frames.at(-1)!.dots.length).toBeGreaterThan(5));
		expect(container.querySelector('[aria-label^="Since your last visit"]')).toBeNull();
	});

	it('steps through the changes in the order they happened, each step focusing the item, and wraps', async () => {
		const m = marked();
		const { findByLabelText, getByRole } = renderMap(() => Promise.resolve(m.read), { changes: waiting(m) });
		const next = await findByLabelText('Next');
		const focused = (): string | undefined => frames.at(-1)!.focus.to?.key;

		const order: string[] = [];
		for (let i = 0; i < 5; i++) {
			fireEvent.click(next);
			await waitFor(() => expect(getByRole('status').textContent).toBe(`${(i % 4) + 1} of 4`));
			await waitFor(() => expect(focused()).toBe([m.upNext, m.review, m.asked, m.done][i % 4]));
			order.push(focused()!);
		}
		expect(order).toEqual([m.upNext, m.review, m.asked, m.done, m.upNext]);
	});

	it('steps on ] and [ too', async () => {
		const m = marked();
		renderMap(() => Promise.resolve(m.read), { changes: waiting(m) });
		await waitFor(() => expect(litKeys()?.size).toBe(4));
		const focused = (): string | undefined => frames.at(-1)!.focus.to?.key;

		fireEvent.keyDown(document.body, { key: ']' });
		await waitFor(() => expect(focused()).toBe(m.upNext));
		fireEvent.keyDown(document.body, { key: '[' });
		await waitFor(() => expect(focused()).toBe(m.done));
	});

	it('says on the stepped-to item\'s card what changed and when, one line per change, with its latest activity entry', async () => {
		const m = marked();
		const w = waiting(m);
		const { findByLabelText, container } = renderMap(() => Promise.resolve(m.read), { changes: w });
		const next = await findByLabelText('Next');

		fireEvent.click(next);
		fireEvent.click(next);
		await waitFor(() => expect(frames.at(-1)!.focus.to?.key).toBe(m.review));

		await waitFor(() => expect(container.querySelector('article')?.textContent).toContain('PR opened'));
		const card = container.querySelector('article')!.textContent!;
		expect(card).toContain(`Worked on ${formatDateTime(new Date(w.at(1)).toISOString())}`);
		expect(card).toContain(`PR opened ${formatDateTime(new Date(w.at(2)).toISOString())}`);
		expect(card).toContain('Latest activity');
	});

	it('gives the at-rest labels to the most recent changes instead of the families', async () => {
		const m = marked();
		renderMap(() => Promise.resolve(m.read), { changes: waiting(m) });
		await waitFor(() => expect(litKeys()?.size).toBe(4));

		const frame = frames.at(-1)!;
		expect(frame.labels).toEqual([]);
		expect(frame.dotLabels.map((label) => label.key)).toEqual(expect.arrayContaining([m.done, m.asked, m.review, m.upNext]));
	});

	it('Mark all seen closes the view, moves the baseline to the read time, and takes the strip summary with it', async () => {
		const m = marked();
		const w = waiting(m);
		const { findByText, container, advance } = renderMap(() => Promise.resolve(m.read), { changes: w });

		fireEvent.click(await findByText('Mark all seen'));

		await waitFor(() => expect(container.querySelector('[aria-label^="Since your last visit"]')).toBeNull());
		expect(advance).toHaveBeenCalledTimes(1);
		expect(advance).toHaveBeenCalledWith(w.readAt, { keepalive: false });
		await waitFor(() => expect(litKeys()).toBeUndefined());
		expect(container.querySelector('section[aria-label="Project summary"]')!.textContent).not.toContain('Since');
	});

	it('closes without moving the baseline, and the strip\'s summary reopens it', async () => {
		const m = marked();
		const w = waiting(m);
		const { findByText, getByRole, container, advance } = renderMap(() => Promise.resolve(m.read), { changes: w });

		fireEvent.click(await findByText('Close'));
		await waitFor(() => expect(container.querySelector('[aria-label^="Since your last visit"]')).toBeNull());
		await waitFor(() => expect(litKeys()).toBeUndefined());
		expect(advance).not.toHaveBeenCalled();

		const summary = getByRole('button', { name: `Since ${baselineDate(w.baseline)}: 1 finished, 1 worked on, 1 filed, 1 question, 1 PR opened` });
		expect(summary.getAttribute('aria-pressed')).toBe('false');
		fireEvent.click(summary);
		await findByText(`Since your last visit, ${baselineDate(w.baseline)}`);
		await waitFor(() => expect(litKeys()).toEqual(new Set([m.done, m.asked, m.review, m.upNext])));
		expect(getByRole('button', { name: /^Since / }).getAttribute('aria-pressed')).toBe('true');
	});

	it('Escape closes the view once the drawer, the selection, and any search are done with it', async () => {
		const m = marked();
		const { findByText, container, advance } = renderMap(() => Promise.resolve(m.read), { changes: waiting(m) });
		await findByText(/^Since your last visit/);

		fireEvent.keyDown(document.body, { key: 'Escape' });

		await waitFor(() => expect(container.querySelector('[aria-label^="Since your last visit"]')).toBeNull());
		expect(advance).not.toHaveBeenCalled();
		expect(cleared).not.toHaveBeenCalled();
	});

	it('hands the canvas to a search while it is on, and gets it back when the search ends', async () => {
		const m = marked();
		const w = waiting(m);
		const { findByText, rerender, container } = renderMap(() => Promise.resolve(m.read), { changes: w, search: 'x', searchSource: () => Promise.resolve([m.live]) });
		await findByText('Matches for "x"');
		expect(container.querySelector('[aria-label^="Since your last visit"]')).toBeNull();
		await waitFor(() => expect(litKeys()).toEqual(new Set([m.live])));

		fireEvent.keyDown(document.body, { key: 'Escape' });
		expect(cleared).toHaveBeenCalledTimes(1);
		rerender({ changes: w, search: '' });
		await findByText(`Since your last visit, ${baselineDate(w.baseline)}`);
		await waitFor(() => expect(litKeys()).toEqual(new Set([m.done, m.asked, m.review, m.upNext])));
	});

	it('sends the baseline when the person leaves the Map, once, with keepalive, whether the view was open or not', async () => {
		const m = marked();
		const w = waiting(m);
		const { unmount, advance, findByText } = renderMap(() => Promise.resolve(m.read), { changes: w });
		await findByText(/^Since your last visit/);

		unmount();

		expect(advance).toHaveBeenCalledTimes(1);
		expect(advance).toHaveBeenCalledWith(w.readAt, { keepalive: true });
	});

	it('sends it as the page is hidden too, and not again when the Map is then torn down', async () => {
		const m = marked();
		const w = waiting(m);
		const { unmount, advance, findByText } = renderMap(() => Promise.resolve(m.read), { changes: w });
		await findByText(/^Since your last visit/);

		window.dispatchEvent(new Event('pagehide'));
		unmount();

		expect(advance).toHaveBeenCalledTimes(1);
		expect(advance).toHaveBeenCalledWith(w.readAt, { keepalive: true });
	});

	it('does not send anything when it left before the read landed', () => {
		const m = marked();
		const { unmount, advance } = renderMap(() => Promise.resolve(m.read), { changes: waiting(m) });

		unmount();

		expect(advance).not.toHaveBeenCalled();
	});

	it('draws the Map without a changes view when the changes read fails', async () => {
		const m = marked();
		const model = new MapDataModel(() => Promise.resolve(m.read), () => worker, memoryCollapseStore());
		const failing = new MapChangesModel({ read: () => Promise.reject(new Error('HTTP 500')), advance: vi.fn() });
		const { container } = render(
			<MapView projectRef="acme/specboard" model={model} changes={failing} activity={new ActivityCache(() => Promise.resolve([]))} searchSource={() => Promise.resolve([])}
				covered={0} search="" type={null} onClear={cleared} onOpenItem={() => {}} onCloseItem={closed} />,
		);

		await waitFor(() => expect(frames.at(-1)!.dots.length).toBeGreaterThan(5));
		expect(container.querySelector('[aria-label^="Since your last visit"]')).toBeNull();
		expect(litKeys()).toBeUndefined();
	});
});

describe('MapView agents', () => {
	/** The laptop has a live session (2 minutes ago) and a quiet one (20 minutes ago); the build box has a live one. */
	function working(): { read: MapRead; b: BoardBuilder; items: string[] } {
		const b = new BoardBuilder();
		const one = b.add({ status: 'in_progress', title: 'Wire the index' });
		const two = b.add({ status: 'in_progress', title: 'Draw the cards' });
		const three = b.add({ status: 'in_progress', title: 'Write the roster' });
		for (let i = 0; i < 5; i++) b.add({ status: 'ready' });
		b.work(one, 'aa', 'personal-laptop', 2);
		b.work(two, 'bb', 'personal-laptop', 20);
		b.work(three, 'cc', 'build-box', 4);
		return { read: wholeRead(b.rows), b, items: [one.key, two.key, three.key] };
	}

	const agentsButton = (container: HTMLElement): HTMLButtonElement =>
		Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Agents at work') as HTMLButtonElement;

	const liveChip = (container: HTMLElement): string =>
		Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.startsWith('Live sessions'))!.textContent!;

	it('puts the Agents at work button in the summary strip, next to the live count', async () => {
		const { read, b } = working();
		const { container } = renderMap(() => Promise.resolve(read), {}, () => b.now);
		await waitFor(() => expect(frames.at(-1)?.agents.length).toBeGreaterThan(0));
		const button = agentsButton(container);
		expect(button.closest('section')!.getAttribute('aria-label')).toBe('Project summary');
		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(liveChip(container)).toBe('Live sessions2');
	});

	it('opens a roster grouped by computer, each session with its items, live ones first', async () => {
		const { read, b, items } = working();
		const { container, getByRole } = renderMap(() => Promise.resolve(read), {}, () => b.now);
		await waitFor(() => expect(frames.at(-1)?.agents.length).toBeGreaterThan(0));
		fireEvent.click(agentsButton(container));
		const roster = getByRole('dialog', { name: 'Agents at work' }) as HTMLElement;
		const groups = Array.from(roster.querySelectorAll<HTMLElement>('section'));
		expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['build-box', 'personal-laptop']);
		const laptop = groups[1]!;
		expect(laptop.querySelector('h3')!.textContent).toBe('personal-laptop1 live of 2');
		const sessions = Array.from(laptop.querySelectorAll<HTMLElement>('[data-state]'));
		expect(sessions.map((s) => s.getAttribute('data-state'))).toEqual(['live', 'quiet']);
		expect(sessions[0]!.textContent).toContain('Session 1, claude-code');
		expect(sessions[0]!.textContent).toContain(items[0]);
		expect(sessions[0]!.textContent).toContain('Wire the index');
		expect(sessions[1]!.textContent).toContain('quiet, last write 20 min ago');
		expect(agentsButton(container).getAttribute('aria-expanded')).toBe('true');
	});

	it('selects the item and flies there when a row is picked, and closes', async () => {
		const { read, b, items } = working();
		const { container, getByRole, queryByRole } = renderMap(() => Promise.resolve(read), {}, () => b.now);
		await waitFor(() => expect(frames.at(-1)?.agents.length).toBeGreaterThan(0));
		fireEvent.click(agentsButton(container));
		const row = Array.from((getByRole('dialog') as HTMLElement).querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('Draw the cards'))!;
		fireEvent.click(row);
		expect(opened).toEqual([items[1]]);
		expect(queryByRole('dialog')).toBeNull();
		await waitFor(() => {
			const { dots, transform } = frames.at(-1)!;
			const dot = dots.find((d) => d.key === items[1])!;
			expect(transform.x + transform.k * dot.x).toBeCloseTo(500, -1);
		}, { timeout: 2000 });
	});

	it('closes on Escape before the Map\'s own Escape sees it, and on a press outside', async () => {
		const { read, b } = working();
		const { container, queryByRole } = renderMap(() => Promise.resolve(read), { openItemKey: 'MAP-1', covered: 400 }, () => b.now);
		await waitFor(() => expect(frames.at(-1)?.agents.length).toBeGreaterThan(0));
		fireEvent.click(agentsButton(container));
		expect(queryByRole('dialog')).not.toBeNull();
		fireEvent.keyDown(document.body, { key: 'Escape' });
		expect(queryByRole('dialog')).toBeNull();
		expect(closed).not.toHaveBeenCalled();

		fireEvent.click(agentsButton(container));
		fireEvent.pointerDown(document.querySelector('canvas')!);
		expect(queryByRole('dialog')).toBeNull();
	});

	it('says so when nothing is at work', async () => {
		const { container, getByRole } = renderMap(() => Promise.resolve(board(5)));
		await waitFor(() => expect(frames.at(-1)?.dots.length).toBe(5));
		fireEvent.click(agentsButton(container));
		expect(getByRole('dialog').textContent).toContain('No agents at work');
	});

	it('asks the clock again every minute, and ages the sessions without laying anything out', async () => {
		const timers: Array<() => void> = [];
		// Only the Map's own minute timer is held back; the test library polls on setInterval too.
		const original = window.setInterval.bind(window);
		vi.spyOn(window, 'setInterval').mockImplementation(((handler: () => void, delay?: number) => (delay === 60_000 ? timers.push(handler) : original(handler, delay))) as unknown as typeof window.setInterval);
		const layouts = vi.spyOn(worker, 'layout');
		const { read, b, items } = working();
		let clock = b.now;
		const { container } = renderMap(() => Promise.resolve(read), {}, () => clock);
		await waitFor(() => expect(frames.at(-1)?.agents.length).toBeGreaterThan(0));
		expect(layouts).toHaveBeenCalledTimes(1);
		expect(liveChip(container)).toBe('Live sessions2');
		expect(frames.at(-1)!.dots.find((d) => d.key === items[0])!.reason).toBeNull();

		// Fifteen minutes and a second later the live sessions have gone quiet.
		clock = b.now + 15 * 60_000 + 1000;
		act(() => timers.forEach((tick) => tick()));
		await waitFor(() => expect(liveChip(container)).toBe('Live sessions0'));
		await waitFor(() => expect(frames.at(-1)!.dots.find((d) => d.key === items[0])!.reason).toBe('quiet'));
		expect(frames.at(-1)!.agents.every((agent) => agent.state === 'quiet')).toBe(true);
		expect(layouts).toHaveBeenCalledTimes(1);

		// An hour past the last write the sessions leave the cluster, and still no layout.
		clock = b.now + 80 * 60_000;
		act(() => timers.forEach((tick) => tick()));
		await waitFor(() => expect(frames.at(-1)!.agents).toEqual([]));
		expect(layouts).toHaveBeenCalledTimes(1);
	});
});
