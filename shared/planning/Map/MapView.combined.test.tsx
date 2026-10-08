/**
 * The combined Map (multi-project-view.md): several projects' items on one Map, which
 * only reads. Its reads go through the real sources over a stubbed fetch client, so the
 * tests see every request it makes, and the ones it never does.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import type { JSX } from 'preact';
import { encodeMapChanges } from '@specboard/core/map-changes';
import { encodeMapRead, type MapItemRow, type MapRead } from '@specboard/core/map-read';
import { FetchError } from '@specboard/fetch';
import { COMBINED_POLL_INTERVAL, POLL_INTERVAL } from '../hooks/usePolling';
import { memoryStorage } from '../test-support/memory-storage';
import { installPointerEvents } from '../test-support/pointer-events';
import { memoryCollapseStore } from './collapse-store.fixture';
import { BoardBuilder, deltaRead, wholeRead } from './layout/board-fixture';
import { layoutMap } from './layout/layout';
import type { MapLayoutWorker } from './layout/layout-worker-client';
import { MapDataModel, type MapProjectFailure } from './map-data-model';
import type { MapProject, MapScope } from './map-projects';
import { MapView } from './MapView';
import { traceRegions } from './regions/outline';
import type { MapFrame, MapRenderer } from './renderer';

const fetchClient = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@specboard/fetch', async (importOriginal) => ({ ...(await importOriginal<typeof import('@specboard/fetch')>()), fetchClient }));

/** The interval the Map asked to be polled at; the poll itself never runs here. */
const polls = vi.hoisted(() => [] as number[]);
vi.mock('../hooks/usePolling', async (importOriginal) => ({
	...(await importOriginal<typeof import('../hooks/usePolling')>()),
	usePolling: (_poll: unknown, _skip: unknown, interval: number) => {
		polls.push(interval);
	},
}));

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
	outlines: (inputs, step) => Promise.resolve(traceRegions(inputs, step)),
	terminate: vi.fn(),
};
vi.mock('./layout/layout-worker-client', () => ({ createLayoutWorker: () => worker }));

const PROJECTS: MapProject[] = [
	{ ref: 'acme/specboard', key: 'SPE', name: 'Specboard' },
	{ ref: 'kim/planner', key: 'PLN', name: 'Planner' },
];

/** Two projects, each with ready work up next: three of Specboard's, two of Planner's. */
function boards(): { spe: MapItemRow[]; pln: MapItemRow[] } {
	const spe = new BoardBuilder(undefined, 'SPE');
	spe.add({ status: 'in_progress' });
	for (let i = 0; i < 3; i++) spe.add({ status: 'ready', created: spe.now - (i + 1) * 86_400_000 });
	const pln = new BoardBuilder(undefined, 'PLN');
	pln.add({ status: 'done' });
	for (let i = 0; i < 2; i++) pln.add({ status: 'ready', created: pln.now - (i + 2) * 86_400_000 });
	return { spe: spe.rows, pln: pln.rows };
}

/** Answers the Map's reads: each project's own, and the last-visit read a project's own Map makes. */
function serve(reads: Record<string, MapRead | Error>): void {
	fetchClient.get.mockImplementation((path: string) => {
		const [, ref, rest] = /^\/api\/projects\/([^/]+\/[^/]+)\/(.*)$/.exec(path) ?? [];
		const read = reads[ref!];
		if (rest === 'map') {
			if (read instanceof Error) return Promise.reject(read);
			const key = PROJECTS.find((project) => project.ref === ref)!.key;
			return Promise.resolve(encodeMapRead(read!, key));
		}
		if (rest === 'map/changes') return Promise.resolve(encodeMapChanges({ baseline: Date.now() - 86_400_000, readAt: Date.now(), changes: [] }, 'SPE'));
		return Promise.resolve([]);
	});
	fetchClient.post.mockResolvedValue(undefined);
}

const asked = (): string[] => fetchClient.get.mock.calls.map(([path]) => path as string);

interface Rendered {
	opened: Array<[string, string]>;
	failures: Array<ReadonlyMap<string, MapProjectFailure>>;
	container: Element;
	unmount(): void;
	rerender(props: { search: string }): void;
}

/** Renders the Map over the stubbed reads, or over a model the test hands in. */
function renderMap(scope: MapScope, model?: MapDataModel): Rendered {
	const opened: Array<[string, string]> = [];
	const failures: Array<ReadonlyMap<string, MapProjectFailure>> = [];
	const view = (search: string): JSX.Element => (
		<MapView
			scope={scope}
			model={model}
			covered={0}
			search={search}
			type={null}
			onClear={() => {}}
			onOpenItem={(key, ref) => opened.push([key, ref])}
			onCloseItem={() => {}}
			onFailures={(now) => failures.push(now)}
		/>
	);
	const rendered = render(view(''));
	return { opened, failures, container: rendered.container, unmount: rendered.unmount, rerender: ({ search }) => rendered.rerender(view(search)) };
}

const dotKeys = (): string[] => (frames.at(-1)?.dots ?? []).map((dot) => dot.key).sort();

installPointerEvents();

beforeEach(() => {
	frames.length = 0;
	polls.length = 0;
	vi.stubGlobal('localStorage', memoryStorage());
	window.history.replaceState(null, '', '/planning?projects=acme/specboard,kim/planner&view=map');
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
		return this.getAttribute('role') === 'group'
			? { x: 12, y: 12, left: 12, top: 12, right: 200, bottom: 52, width: 188, height: 40, toJSON: () => ({}) }
			: { x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 532, width: 1000, height: 532, toJSON: () => ({}) };
	});
});

afterEach(() => {
	cleanup();
	fetchClient.get.mockReset();
	fetchClient.post.mockReset();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('The combined Map', () => {
	it('draws every chosen project\'s items on one Map, each project read from its own route', async () => {
		const { spe, pln } = boards();
		serve({ 'acme/specboard': wholeRead(spe), 'kim/planner': wholeRead(pln) });
		const { container } = renderMap({ projects: PROJECTS });

		await waitFor(() => expect(dotKeys()).toEqual([...spe, ...pln].map((row) => row.key).sort()));
		expect(asked()).toEqual(['/api/projects/acme/specboard/map', '/api/projects/kim/planner/map']);
		expect(container.querySelector('[role="tree"]')!.getAttribute('aria-label')).toBe(`Map of ${spe.length + pln.length} items`);
	});

	it('never reads or moves a since-last-visit baseline, not even as the person leaves', async () => {
		const { spe, pln } = boards();
		serve({ 'acme/specboard': wholeRead(spe), 'kim/planner': wholeRead(pln) });
		const { container, unmount } = renderMap({ projects: PROJECTS });
		await waitFor(() => expect(dotKeys()).toHaveLength(spe.length + pln.length));

		window.dispatchEvent(new Event('pagehide'));
		unmount();

		expect(asked().filter((path) => path.includes('/map/changes'))).toEqual([]);
		expect(fetchClient.post).not.toHaveBeenCalled();
		expect(container.textContent).not.toMatch(/Since|Mark all seen/);
	});

	it('polls every 30 s, where a project\'s own Map polls every 10 s', async () => {
		const { spe, pln } = boards();
		serve({ 'acme/specboard': wholeRead(spe), 'kim/planner': wholeRead(pln) });
		const combined = renderMap({ projects: PROJECTS });
		await waitFor(() => expect(dotKeys()).toHaveLength(spe.length + pln.length));
		expect(new Set(polls)).toEqual(new Set([COMBINED_POLL_INTERVAL]));
		combined.unmount();

		polls.length = 0;
		renderMap({ projectRef: 'acme/specboard' });
		await waitFor(() => expect(dotKeys()).toHaveLength(spe.length));
		expect(new Set(polls)).toEqual(new Set([POLL_INTERVAL]));
	});

	it('opens an item with the ref of the project it is in', async () => {
		const { spe, pln } = boards();
		serve({ 'acme/specboard': wholeRead(spe), 'kim/planner': wholeRead(pln) });
		const { opened } = renderMap({ projects: PROJECTS });
		await waitFor(() => expect(dotKeys()).toHaveLength(spe.length + pln.length));

		const { dots, transform } = frames.at(-1)!;
		const canvas = document.querySelector('canvas')!;
		for (const key of [pln[1]!.key, spe[2]!.key]) {
			const dot = dots.find((d) => d.key === key)!;
			const at = { clientX: transform.x + transform.k * dot.x, clientY: transform.y + transform.k * dot.y };
			fireEvent.pointerDown(canvas, at);
			fireEvent.pointerUp(canvas, at);
		}
		expect(opened).toEqual([[pln[1]!.key, 'kim/planner'], [spe[2]!.key, 'acme/specboard']]);
	});

	it('numbers each project\'s up next from 1', async () => {
		const { spe, pln } = boards();
		serve({ 'acme/specboard': wholeRead(spe), 'kim/planner': wholeRead(pln) });
		renderMap({ projects: PROJECTS });
		await waitFor(() => expect(dotKeys()).toHaveLength(spe.length + pln.length));

		const numbered = frames.at(-1)!.dots.filter((dot) => dot.upNext !== null).map((dot) => [dot.key, dot.upNext]);
		expect(Object.fromEntries(numbered)).toEqual({ [spe[1]!.key]: 1, [spe[2]!.key]: 2, [spe[3]!.key]: 3, [pln[1]!.key]: 1, [pln[2]!.key]: 2 });
	});

	it('draws the projects it can read when one can\'t be, and tells the page which it dropped', async () => {
		const { spe } = boards();
		serve({ 'acme/specboard': wholeRead(spe), 'kim/planner': new FetchError('HTTP 403: Forbidden', 403) });
		const { failures, container } = renderMap({ projects: PROJECTS });

		await waitFor(() => expect(dotKeys()).toEqual(spe.map((row) => row.key).sort()));
		await waitFor(() => expect(failures.at(-1)?.get('kim/planner')).toMatchObject({ unreadable: true, held: false }));
		expect([...failures.at(-1)!.keys()]).toEqual(['kim/planner']);
		expect(container.querySelector('[role="alert"]')).toBeNull();
	});

	it('cuts to a fresh layout when a project\'s rows arrive late, and says nothing about them', async () => {
		const { spe, pln } = boards();
		let plannerReads = 0;
		const model = new MapDataModel(
			[
				{ ref: 'acme/specboard', read: (since) => Promise.resolve(since === null ? wholeRead(spe) : deltaRead([], spe.length)) },
				{ ref: 'kim/planner', read: () => (plannerReads++ === 0 ? Promise.reject(new FetchError('HTTP 500: Internal Server Error', 500)) : Promise.resolve(wholeRead(pln))) },
			],
			() => worker,
			memoryCollapseStore(),
		);
		const layouts = vi.spyOn(worker, 'layout');
		const { failures } = renderMap({ projects: PROJECTS }, model);
		await waitFor(() => expect(dotKeys()).toEqual(spe.map((row) => row.key).sort()));
		await waitFor(() => expect(failures.at(-1)?.get('kim/planner')).toMatchObject({ unreadable: false, held: false }));

		await act(async () => {
			await model.refresh();
		});

		await waitFor(() => expect(dotKeys()).toEqual([...spe, ...pln].map((row) => row.key).sort()));
		expect(layouts.mock.calls.at(-1)![0].previous).toBeUndefined();
		expect(failures.at(-1)!.size).toBe(0);
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(document.querySelector('[aria-live]')!.textContent).toBe('');
	});

	it('names the projects past the read cap', async () => {
		const { spe, pln } = boards();
		serve({ 'acme/specboard': wholeRead(spe, { summarized: true }), 'kim/planner': wholeRead(pln, { summarized: true }) });
		const { container } = renderMap({ projects: PROJECTS });

		await waitFor(() => expect(container.querySelector('p[role="status"]')?.textContent).toBe('Specboard and Planner are past the read cap, so their finished families are summarized.'));
	});

	it('searches every project, and lights the matches in each', async () => {
		const { spe, pln } = boards();
		serve({ 'acme/specboard': wholeRead(spe), 'kim/planner': wholeRead(pln) });
		const { rerender } = renderMap({ projects: PROJECTS });
		await waitFor(() => expect(dotKeys()).toHaveLength(spe.length + pln.length));
		const search = fetchClient.get.getMockImplementation()!;
		fetchClient.get.mockImplementation((path: string) => {
			if (path.startsWith('/api/projects/acme/specboard/items?')) return Promise.resolve([{ key: spe[1]!.key }]);
			if (path.startsWith('/api/projects/kim/planner/items?')) return Promise.resolve([{ key: pln[2]!.key }]);
			return search(path);
		});

		rerender({ search: 'import' });

		await waitFor(() => expect(frames.at(-1)?.focus.to?.dots).toEqual(new Set([spe[1]!.key, pln[2]!.key])));
		expect(asked().filter((path) => path.includes('/items?'))).toEqual([
			'/api/projects/acme/specboard/items?search=import&limit=5000',
			'/api/projects/kim/planner/items?search=import&limit=5000',
		]);
	});
});

describe('A project\'s own Map', () => {
	it('still reads what changed since the last visit, and moves the baseline as the person leaves', async () => {
		const { spe } = boards();
		serve({ 'acme/specboard': wholeRead(spe) });
		const { unmount } = renderMap({ projectRef: 'acme/specboard' });
		await waitFor(() => expect(asked()).toContain('/api/projects/acme/specboard/map/changes'));
		await waitFor(() => expect(dotKeys()).toHaveLength(spe.length));

		unmount();

		expect(fetchClient.post).toHaveBeenCalledWith('/api/projects/acme/specboard/map/seen', { readAt: expect.any(Number) }, { keepalive: true });
	});
});
