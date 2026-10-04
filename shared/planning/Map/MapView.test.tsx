/**
 * MapView: the states around the canvas (loading, empty, error), the controls, and the
 * history rules for panning and jumping. jsdom has no canvas, so the renderer is a fake.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import type { JSX } from 'preact';
import { BoardBuilder } from './layout/board-fixture';
import { layoutMap } from './layout/layout';
import type { MapLayoutWorker } from './layout/layout-worker-client';
import { MapView } from './MapView';
import type { MapRead } from '@specboard/core/map-read';
import { memoryCollapseStore } from './collapse-store.fixture';
import { MapDataModel } from './map-data-model';
import { ActivityCache } from './quick/activity-cache';
import type { MapFrame, MapRenderer } from './renderer';

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

const worker: MapLayoutWorker = {
	layout: (input) => Promise.resolve({ layout: layoutMap(input), ms: 1 }),
	terminate: vi.fn(),
};

function board(count: number): MapRead {
	const b = new BoardBuilder();
	for (let i = 0; i < count; i++) b.add({ status: i % 3 === 0 ? 'done' : i % 3 === 1 ? 'in_progress' : 'ready', created: b.now - i * 86_400_000 });
	return { items: b.rows, summarized: false };
}

const opened: string[] = [];
const closed = vi.fn();

interface MapProps {
	openItemKey?: string;
	covered?: number;
}

type RenderedMap = Omit<ReturnType<typeof render>, 'rerender'> & { model: MapDataModel; rerender(next: MapProps): void };

function renderMap(source: () => Promise<MapRead>, props: MapProps = {}): RenderedMap {
	const model = new MapDataModel(source, () => worker, memoryCollapseStore());
	const activity = new ActivityCache(() => Promise.resolve([]));
	const view = (next: MapProps): JSX.Element => (
		<MapView projectRef="acme/specboard" model={model} activity={activity} covered={next.covered ?? 0} openItemKey={next.openItemKey} onOpenItem={(key) => opened.push(key)} onCloseItem={closed} />
	);
	const rendered = render(view(props));
	return { ...rendered, model, rerender: (next) => rendered.rerender(view(next)) };
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
	window.history.replaceState(null, '', '/projects/acme/specboard/planning?view=map');
	// The whole Map is 1000 by 532; the toolbar over its corner is a small box, so labels and cards still have the rest.
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
		const toolbar = this.getAttribute('role') === 'group';
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
		const { container, findByText } = renderMap(() => Promise.resolve({ items: [], summarized: false }));
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
		renderMap(() => Promise.resolve({ items: b.rows, summarized: false }));
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
