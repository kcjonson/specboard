/**
 * MapView: the states around the canvas (loading, empty, error), the controls, and the
 * history rules for panning and jumping. jsdom has no canvas, so the renderer is a fake.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { BoardBuilder } from './layout/board-fixture';
import { layoutMap } from './layout/layout';
import type { MapLayoutWorker } from './layout/layout-worker-client';
import { MapView } from './MapView';
import type { MapRead } from '@specboard/core/map-read';
import { memoryCollapseStore } from './collapse-store.fixture';
import { MapDataModel } from './map-data-model';
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

function renderMap(source: () => Promise<MapRead>): { model: MapDataModel } & ReturnType<typeof render> {
	const model = new MapDataModel(source, () => worker, memoryCollapseStore());
	return { model, ...render(<MapView projectRef="acme/specboard" model={model} />) };
}

beforeEach(() => {
	frames.length = 0;
	window.history.replaceState(null, '', '/projects/acme/specboard/planning?view=map');
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
		x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 532, width: 1000, height: 532, toJSON: () => ({}),
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
		fireEvent.mouseMove(canvas, { clientX: 200, clientY: 100 });
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

		fireEvent.mouseMove(canvas, { clientX: toggle.x, clientY: toggle.y });
		expect(canvas.hasAttribute('data-control')).toBe(true);
		fireEvent.mouseMove(canvas, { clientX: 1, clientY: 1 });
		expect(canvas.hasAttribute('data-control')).toBe(false);

		fireEvent.click(canvas, { clientX: toggle.x, clientY: toggle.y });
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
