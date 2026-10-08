import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { MapItemRow, MapItemType } from '@specboard/core/map-read';
import { navigate } from '@specboard/router';
import { useModel } from '@specboard/models';
import { LoadError } from '../LoadError/LoadError';
import { COMBINED_POLL_INTERVAL, POLL_INTERVAL } from '../hooks/usePolling';
import { MAP_ANNOUNCE_PREF, readPref, writePref } from '../Planning/prefs';
import { Announcer, summarizeUpdate } from './access/announce';
import { MapTree } from './access/MapTree';
import { activeNode, buildTree } from './access/tree-model';
import { AgentRoster } from './AgentRoster';
import { AgentsButton } from './AgentsButton';
import { NO_AGENTS, agentsOf, deviceLabel } from './agents';
import { MapCards } from './cards/MapCards';
import { MapChangesModel, createChangesSource } from './changes/changes-model';
import { RECENT_LABELS, barTitle, baselineDate, changeLines, changedItems, summaryText } from './changes/changes';
import { createCollapseStore } from './collapse-store';
import { EdgeMarkers } from './EdgeMarkers';
import type { EdgeMarkerInput } from './edge-markers';
import { DRAG_THRESHOLD } from './drag';
import type { Hit } from './hit-index';
import { createLayoutWorker } from './layout/layout-worker-client';
import type { MapPhase, MapPoint } from './layout/types';
import { createCamera, type ScreenPoint } from './map-camera';
import { MapDataModel, type MapProjectFailure } from './map-data-model';
import { mapFacts } from './map-facts';
import { NO_LENS, describeFilters, filtersActive, highlightOf, lensOf, type MapFilters } from './map-lens';
import { MapSearchModel, createSearchSource, type MapSearchSource } from './map-search';
import { createMapSource } from './map-source';
import { mapSetup, scopeKey, type MapScope } from './map-projects';
import { useMapUpdates } from './useMapUpdates';
import { MapSurface } from './map-surface';
import { Minimap } from './minimap/Minimap';
import { OverlayStore } from './overlay';
import { ActivityCache, createActivitySource } from './quick/activity-cache';
import { MapQuickCard } from './quick/MapQuickCard';
import { isTypingTarget, mapKeyOf } from './map-keys';
import { rosterOf } from './roster';
import { readFocus, urlWithFocus } from './map-url';
import { RULER_HEIGHT, createCanvasRenderer } from './renderer';
import { SteppingBar } from './stepping/SteppingBar';
import { SummaryStrip } from './strip/SummaryStrip';
import { upNextNumbers } from './up-next';
import styles from './MapView.module.css';

export interface MapViewProps {
	/** Whose items: a project's own Map, or the combined view's projects. */
	scope: MapScope;
	/** The item the drawer shows (the item URL's key), which the Map keeps selected and in view. */
	openItemKey?: string;
	/** How much of the Map's right side the drawer overlays, in px; 0 while it is closed. */
	covered: number;
	/** A click, Enter on the focused item, or a second tap asks for an item to open, with the ref of the project it is in. */
	onOpenItem(key: string, projectRef: string): void;
	/** Escape asks the drawer to close. */
	onCloseItem(): void;
	/** The toolbar's search text once it has settled; the Map dims what doesn't match it. Empty for no search. */
	search: string;
	/** The toolbar's type filter, which the Map dims by too. */
	type: MapItemType | null;
	/** The stepping bar's Clear, and Escape with nothing else to close: the page empties the search box and the type filter. */
	onClear(): void;
	/** The projects the Map is drawing without, by ref, each time that changes: the combined view names them in its notice. */
	onMissing?(missing: ReadonlyMap<string, MapProjectFailure>): void;
	/** Tests hand in a model with a fake source and worker; the page builds its own. */
	model?: MapDataModel;
	/** Tests hand in the quick card's activity source; the page asks the notes endpoint. */
	activity?: ActivityCache;
	/** Tests hand in the search's source; the page asks the items list. */
	searchSource?: MapSearchSource;
	/** Tests hand in the last-visit model with a fake source; a project's own Map asks the changes read, and the combined view has none. */
	changes?: MapChangesModel;
}

/** The layout fits itself to this plot shape until the container has been measured. */
const FALLBACK_ASPECT = 2;

/** Outlines for a new zoom wait this long after the last frame that wanted them, so a gesture never stalls on them. */
const DEFER_MS = 150;

/** Cards and labels keep this far from the toolbar and the notice that sit over the plot. */
const CHROME_PAD = 8;

/** Sessions age without a data change, so the Map asks the clock again this often: a repaint only if something crossed 15 minutes or an hour, and never a new layout. */
const CLOCK_MS = 60_000;

/** A finger moves a little more than a mouse does while it is only pressing. */
const TOUCH_THRESHOLD = 10;

const media = (query: string): MediaQueryList | null => (typeof window.matchMedia === 'function' ? window.matchMedia(query) : null);

const PROJECT_LIST = new Intl.ListFormat('en', { type: 'conjunction' });

/** Which projects are past the read cap: "this project" on its own Map, and by name on the combined view. */
function readCapNotice(scope: MapScope, refs: readonly string[]): string {
	if ('projectRef' in scope) return 'This project is past the read cap, so finished families are summarized.';
	const names = refs.map((ref) => scope.projects.find((project) => project.ref === ref)?.name ?? ref);
	return names.length === 1
		? `${names[0]} is past the read cap, so its finished families are summarized.`
		: `${PROJECT_LIST.format(names)} are past the read cap, so their finished families are summarized.`;
}

/** A press on the plot, from pointer down to up. */
interface Press {
	id: number;
	start: ScreenPoint;
	hit: Hit | null;
	touch: boolean;
	/** It has moved past the click threshold: whatever it is, it is no longer a click. */
	moved: boolean;
	/** It is pulling a dot. */
	dragging: boolean;
}

/** Moving focus with the keys rewrites the URL's anchor once the person pauses, so holding an arrow doesn't write to history on every repeat. */
const ANCHOR_PAUSE_MS = 300;

/**
 * The Map: one canvas drawing every item's status glyph where the layout put it, a
 * region around every family with its label and collapse control, the links that
 * show, labels that fade with the zoom level, a ruler of dates along its bottom, and
 * a camera of its own; over it, DOM cards at the near level, the quick card, and a
 * minimap once zoomed in. Hover, focus, and selection light an item's relations; a
 * click opens the item, which on a project's own Map is the drawer the board uses. The
 * combined view (multi-project-view.md) is the same Map over several projects, without
 * the since-last-visit layer. The page loads this module lazily, so Board and Table
 * don't carry it.
 */
export function MapView({ scope, openItemKey, covered, onOpenItem, onCloseItem, search, type, onClear, onMissing, model: provided, activity: providedActivity, searchSource, changes: providedChanges }: MapViewProps): JSX.Element {
	// Built from what the scope says rather than the object it came in, so a container that hands in a new one every render doesn't start the Map over.
	const setup = useMemo(() => mapSetup(scope), [scopeKey(scope)]);
	const model = useMemo(
		() => provided ?? new MapDataModel(setup.refs.map((ref) => ({ ref, read: createMapSource(ref) })), createLayoutWorker, createCollapseStore(setup.refs)),
		[provided, setup],
	);
	useModel(model);
	const activity = useMemo(() => providedActivity ?? new ActivityCache(createActivitySource(setup.refOf)), [providedActivity, setup]);

	// The Map's read carries no descriptions, so the board's own search says which items match: every project's, but not one the Map has dropped.
	const searcher = useMemo(
		() => new MapSearchModel(searchSource ?? createSearchSource(() => setup.refs.filter((ref) => !model.missing.get(ref)?.unreadable))),
		[searchSource, setup, model],
	);
	useModel(searcher);
	useEffect(() => searcher.setQuery(search), [searcher, search]);
	useEffect(() => () => searcher.dispose(), [searcher]);

	// Since your last visit, on a project's own Map: read beside the Map's own read, and the baseline moves forward when the person leaves.
	// The combined view never reads or moves anyone's baseline (multi-project-view.md, decision 10).
	const changesModel = useMemo(
		() => (setup.own === null ? null : providedChanges ?? new MapChangesModel(createChangesSource(setup.own))),
		[providedChanges, setup],
	);
	useModel(changesModel);
	useMapUpdates(model, changesModel, setup.own === null ? COMBINED_POLL_INTERVAL : POLL_INTERVAL);
	useEffect(() => {
		if (!changesModel) return;
		void changesModel.load();
		// `pagehide` is the one event a closing tab, a reload, and a navigation away all fire; the model sends with keepalive so the request survives it.
		const leave = (): void => changesModel.leave();
		window.addEventListener('pagehide', leave);
		return () => {
			window.removeEventListener('pagehide', leave);
			leave();
		};
	}, [changesModel]);
	// The view is open whenever changes are waiting, until the person closes it; the strip reopens it. It is derived, not set from an effect, so the first frame that draws the Map already dims it.
	const [changesClosed, setChangesClosed] = useState(false);

	// The strip's counts that name a filter are its buttons; type is the toolbar's.
	const [phases, setPhases] = useState<ReadonlySet<MapPhase>>(() => new Set());
	const [needsOnly, setNeedsOnly] = useState(false);
	const [liveOnly, setLiveOnly] = useState(false);
	const filters = useMemo<MapFilters>(() => ({ type, phases, needsPerson: needsOnly, live: liveOnly }), [type, phases, needsOnly, liveOnly]);

	const containerRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const controlsRef = useRef<HTMLDivElement>(null);
	const noticeRef = useRef<HTMLParagraphElement>(null);
	const barRef = useRef<HTMLDivElement>(null);
	const surfaceRef = useRef<MapSurface | null>(null);
	const [viewportEmpty, setViewportEmpty] = useState(false);
	const [allLinks, setAllLinks] = useState(false);
	const [rosterOpen, setRosterOpen] = useState(false);
	// A read stamps its own time; between reads the clock ticks, and whichever is later is now.
	const [ticked, setTicked] = useState(() => model.clock());
	const overlay = useMemo(() => new OverlayStore(), []);

	// The accessible tree holds the Map's keyboard focus; `focusKey` is what its active descendant follows.
	const treeRef = useRef<HTMLDivElement>(null);
	const treeId = useId();
	const [focusKey, setFocusKey] = useState<string | null>(null);
	// Where focus was when it left the Map, so coming back to it lands there.
	const lastFocus = useRef<string | null>(null);
	// A press on the canvas hands the tree focus; that isn't a key asking for an item.
	const pointerFocus = useRef(false);
	const stepRef = useRef<((delta: 1 | -1) => void) | null>(null);
	const anchorTimer = useRef<number | undefined>(undefined);

	// Remote changes are said once a second pass of the read shows them, a few at a time; a setting turns that off.
	const [announcement, setAnnouncement] = useState('');
	const [announce, setAnnounce] = useState(() => readPref(MAP_ANNOUNCE_PREF) !== 'false');
	const announcer = useMemo(
		() => new Announcer({ say: setAnnouncement, now: () => Date.now(), later: (task, ms) => window.setTimeout(task, ms), cancel: (handle) => window.clearTimeout(handle as number) }),
		[],
	);
	useEffect(() => announcer.setEnabled(announce), [announcer, announce]);
	useEffect(() => () => announcer.dispose(), [announcer]);
	const handleToggleAnnounce = useCallback((): void => {
		setAnnounce(!announce);
		writePref(MAP_ANNOUNCE_PREF, String(!announce));
	}, [announce]);

	// The surface lives as long as the view, so what it calls back into is read from here.
	const openItem = (key: string): void => onOpenItem(key, setup.refOf(key));
	const live = useRef({ openItemKey, openItem, onCloseItem, onMissing, model, clear: () => {}, lensActive: false, changesShown: false, closeChanges: () => {} });
	const clearLens = useCallback((): void => {
		onClear();
		setPhases(new Set());
		setNeedsOnly(false);
		setLiveOnly(false);
	}, [onClear]);
	const lensActive = searcher.query !== '' || filtersActive(filters);
	const closeChanges = useCallback((): void => setChangesClosed(true), []);

	// Panning and zooming replace the history entry, so a copied URL anchors on the item in
	// the middle of the plot (spec, Navigation and interaction); a jump pushes one.
	const anchor = useCallback((key: string | null, push: boolean): void => {
		const url = urlWithFocus(window.location, key);
		if (push) navigate(url);
		else if (url !== window.location.pathname + window.location.search + window.location.hash) {
			window.history.replaceState(window.history.state, '', url);
		}
	}, []);

	// The toolbar and the notice sit over the plot, so cards and labels are placed around them.
	const reserveChrome = useCallback((): void => {
		const surface = surfaceRef.current;
		const container = containerRef.current;
		if (!surface || !container) return;
		const origin = container.getBoundingClientRect();
		const boxes = [controlsRef.current, noticeRef.current, barRef.current].flatMap((element) => {
			if (!element) return [];
			const rect = element.getBoundingClientRect();
			return [{ x: rect.left - origin.left - CHROME_PAD, y: rect.top - origin.top - CHROME_PAD, w: rect.width + 2 * CHROME_PAD, h: rect.height + 2 * CHROME_PAD }];
		});
		surface.setChrome(boxes);
	}, []);

	useEffect(() => {
		const container = containerRef.current!;
		const canvas = canvasRef.current!;
		const reducedMotion = media('(prefers-reduced-motion: reduce)');
		const colorScheme = media('(prefers-color-scheme: dark)');
		const forcedColors = media('(forced-colors: active)');

		// A press on a dot's glyph is the start of a drag, which the camera must not pan from.
		let claimed = false;
		const camera = createCamera(canvas, {
			reducedMotion: () => reducedMotion?.matches ?? false,
			onSettle: () => surfaceRef.current?.settled(),
			claims: () => claimed,
		});
		const surface = new MapSurface(
			{
				renderer: createCanvasRenderer(canvas),
				camera,
				overlay,
				now: () => window.performance.now(),
				reducedMotion: () => reducedMotion?.matches ?? false,
				schedule: (paint) => window.requestAnimationFrame(paint),
				defer: (task) => window.setTimeout(task, DEFER_MS),
			},
			{
				onViewportEmpty: setViewportEmpty,
				onSettle: (key) => {
					if (key) anchor(key, false);
				},
				onOpen: (key) => live.current.openItem(key),
				onCollapse: (key, collapse) => void live.current.model.setCollapsed(key, collapse),
				onOutlineStep: (step) => {
					live.current.model.outlineStep = step;
				},
				traceOutlines: (inputs, step) => live.current.model.traceOutlines(inputs, step),
				onPointerTarget: (target) => {
					if (target) canvas.dataset.target = target;
					else delete canvas.dataset.target;
				},
				onFocus: (key) => {
					setFocusKey(key);
					if (key) lastFocus.current = key;
				},
			},
		);
		surfaceRef.current = surface;

		const measure = (): { width: number; height: number } => {
			const { width, height } = container.getBoundingClientRect();
			surface.resize(width, height);
			reserveChrome();
			return { width, height: height - RULER_HEIGHT };
		};
		const { width, height } = measure();
		void model.load(width > 0 && height > 0 ? width / height : FALLBACK_ASPECT);

		const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
		observer?.observe(container);
		const onColorScheme = (): void => surface.refreshTheme();
		colorScheme?.addEventListener('change', onColorScheme);
		forcedColors?.addEventListener('change', onColorScheme);
		// Back and Forward move between anchors; an entry with none is the opening view.
		const onPopState = (): void => {
			const key = readFocus(window.location.search);
			if (!key || !surface.focusOn(key, false)) surface.reopen();
		};
		window.addEventListener('popstate', onPopState);

		const pointOf = (event: MouseEvent): ScreenPoint => {
			const { left, top } = canvas.getBoundingClientRect();
			return { x: event.clientX - left, y: event.clientY - top };
		};
		// Z held is Figma's zoom tool: a click zooms in a step (out, with Option) and centers where it landed, and the
		// cursor says which. It takes Z wherever focus is while the pointer is over the canvas, since the hand on the
		// mouse is asking, but never in a field or with Cmd or Ctrl (Cmd+Z stays undo).
		let zoomTool = false;
		let overCanvas = false;
		const showZoomTool = (mode: 'in' | 'out' | null): void => {
			zoomTool = mode !== null;
			if (mode) canvas.dataset.zoomTool = mode;
			else delete canvas.dataset.zoomTool;
		};
		// Option+Z types an omega on a Mac, so Z is read from `code`.
		const onZoomKeyDown = (event: KeyboardEvent): void => {
			if (event.metaKey || event.ctrlKey || isTypingTarget(event.target)) return;
			if (event.code === 'KeyZ' && (overCanvas || zoomTool)) {
				event.preventDefault();
				showZoomTool(event.altKey ? 'out' : 'in');
			} else if (event.key === 'Alt' && zoomTool) {
				showZoomTool('out');
			}
		};
		const onZoomKeyUp = (event: KeyboardEvent): void => {
			if (!zoomTool) return;
			if (event.code === 'KeyZ') showZoomTool(null);
			else if (event.key === 'Alt') showZoomTool('in');
		};
		// A Z let go of in another window never comes back as a keyup here.
		const onWindowBlur = (): void => showZoomTool(null);
		document.addEventListener('keydown', onZoomKeyDown);
		document.addEventListener('keyup', onZoomKeyUp);
		window.addEventListener('blur', onWindowBlur);

		let press: Press | null = null;
		const onPointerDown = (event: PointerEvent): void => {
			if (event.button !== 0) return;
			// A second finger down is a pinch, which is no click.
			if (press) {
				press.moved = true;
				return;
			}
			// The canvas can't take focus itself, so a press on it hands focus to the tree: the keys work from the first click.
			pointerFocus.current = true;
			treeRef.current?.focus({ preventScroll: true });
			pointerFocus.current = false;
			const point = pointOf(event);
			const touch = event.pointerType === 'touch';
			const hit = surface.hitAt(point, touch);
			press = { id: event.pointerId, start: point, hit, touch, moved: false, dragging: false };
			// With the zoom tool up, a press on a dot is a click to zoom or the start of a pan, never a drag.
			claimed = !touch && !zoomTool && hit?.type === 'dot' && hit.part === 'glyph';
			// Captured, so a release outside the canvas still ends the press instead of leaving it open.
			canvas.setPointerCapture?.(event.pointerId);
		};
		const onPointerMove = (event: PointerEvent): void => {
			overCanvas = true;
			const point = pointOf(event);
			if (press) {
				if (press.id !== event.pointerId) return;
				const threshold = press.touch ? TOUCH_THRESHOLD : DRAG_THRESHOLD;
				if (!press.moved && Math.hypot(point.x - press.start.x, point.y - press.start.y) > threshold) {
					press.moved = true;
					if (claimed && press.hit?.type === 'dot') {
						press.dragging = true;
						canvas.dataset.dragging = '';
						surface.beginDrag(press.hit.key, press.start);
					}
				}
				if (press.dragging) surface.dragTo(point);
				return;
			}
			// A finger has no hover, and a button held is a pan: neither is worth a hit test.
			if (event.pointerType === 'touch' || event.buttons !== 0) return;
			surface.hoverAt(point);
		};
		const onPointerEnd = (event: PointerEvent): void => {
			if (!press || press.id !== event.pointerId) return;
			const ended = press;
			press = null;
			claimed = false;
			delete canvas.dataset.dragging;
			if (ended.dragging) surface.endDrag();
			else if (event.type === 'pointerup' && !ended.moved) {
				if (zoomTool && !ended.touch) surface.zoomToolAt(ended.start, event.altKey ? 'out' : 'in');
				else surface.tap(ended.hit, ended.touch);
			}
		};
		const onPointerLeave = (event: PointerEvent): void => {
			overCanvas = false;
			if (event.pointerType !== 'touch' && !press?.dragging) surface.hoverAt(null);
		};
		canvas.addEventListener('pointerdown', onPointerDown);
		canvas.addEventListener('pointermove', onPointerMove);
		canvas.addEventListener('pointerup', onPointerEnd);
		canvas.addEventListener('pointercancel', onPointerEnd);
		canvas.addEventListener('pointerleave', onPointerLeave);

		// Escape works from anywhere on the page, the way the board's does, and Z over the canvas (above); every other key is the focused tree's (see `handleKeyDown`).
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== 'Escape' || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
			// A dialog over the page has its own Escape.
			if ((event.target as HTMLElement | null)?.closest?.('dialog, [role="dialog"]')) return;
			// The drawer first, then the selection it leaves lit.
			if (live.current.openItemKey) {
				event.preventDefault();
				live.current.onCloseItem();
			} else if (surface.selection !== null) {
				event.preventDefault();
				surface.select(null);
			} else if (live.current.lensActive) {
				event.preventDefault();
				live.current.clear();
			} else if (live.current.changesShown) {
				event.preventDefault();
				live.current.closeChanges();
			}
		};
		document.addEventListener('keydown', onKeyDown);

		return () => {
			document.removeEventListener('keydown', onKeyDown);
			document.removeEventListener('keydown', onZoomKeyDown);
			document.removeEventListener('keyup', onZoomKeyUp);
			window.removeEventListener('blur', onWindowBlur);
			canvas.removeEventListener('pointerdown', onPointerDown);
			canvas.removeEventListener('pointermove', onPointerMove);
			canvas.removeEventListener('pointerup', onPointerEnd);
			canvas.removeEventListener('pointercancel', onPointerEnd);
			canvas.removeEventListener('pointerleave', onPointerLeave);
			window.removeEventListener('popstate', onPopState);
			colorScheme?.removeEventListener('change', onColorScheme);
			forcedColors?.removeEventListener('change', onColorScheme);
			observer?.disconnect();
			surface.destroy();
			camera.destroy();
			surfaceRef.current = null;
			model.dispose();
		};
	}, [model, anchor, overlay, reserveChrome]);

	useEffect(() => {
		const timer = window.setInterval(() => setTicked(model.clock()), CLOCK_MS);
		return () => window.clearInterval(timer);
	}, [model]);

	const { state, layout, rows, missing } = model;
	useEffect(() => live.current.onMissing?.(missing), [missing]);
	const now = Math.max(model.now, ticked);
	const working = useMemo(() => (layout ? agentsOf(layout, rows, now) : NO_AGENTS), [layout, rows, now]);
	// Before the layout effect, so a new layout is drawn against the right time the first time.
	useEffect(() => surfaceRef.current!.setNow(now), [now]);
	// The notice and the stepping bar come and go, so what labels keep off is measured again after every render.
	useEffect(reserveChrome);
	useEffect(() => {
		const surface = surfaceRef.current!;
		if (state !== 'ready' || !layout) surface.clear();
		else if (surface.showing) surface.update(layout, rows, model.changes);
		else surface.show(layout, rows, readFocus(window.location.search));
	}, [state, layout, rows, model]);

	// What the strip counts, and what search and the filters light. Neither moves anything: the layout never hears of them.
	const facts = useMemo(() => (state === 'ready' && layout ? mapFacts(layout, rows, now) : null), [state, layout, rows, now]);
	const lens = useMemo(
		() => (state === 'ready' && layout && facts ? lensOf({ layout, rows, facts, filters, search: searcher.keys }) : NO_LENS),
		[state, layout, rows, facts, filters, searcher.keys],
	);
	// What is out of view and worth knowing about gets a marker at the plot's edge: live sessions first, then what needs a person, then up next.
	useEffect(() => {
		const markers: EdgeMarkerInput[] = [];
		if (state === 'ready' && layout && facts) {
			for (const session of working.sessions) if (session.state === 'live') markers.push({ key: session.node, kind: 'live', label: `Session ${session.number} on ${deviceLabel(session.device)}` });
			for (const key of facts.needs.keys()) markers.push({ key, kind: 'needs-person' });
			for (const [key, number] of upNextNumbers(layout.upNext)) markers.push({ key, kind: 'up-next', text: String(number) });
		}
		surfaceRef.current!.setEdgeMarkers(markers);
	}, [state, layout, facts, working]);

	// The item URL is the selection: a link to an item opens it on the Map, and the drawer's
	// related items move it. The drawer overlays the plot, so the camera pans just far enough
	// to keep the selection clear of it.
	useEffect(() => {
		const surface = surfaceRef.current!;
		surface.setDrawer(openItemKey ?? null);
		if (openItemKey) surface.select(openItemKey);
	}, [openItemKey]);
	useEffect(() => surfaceRef.current!.setCovered(covered), [covered]);
	const interactive = state === 'ready' && !model.isEmpty;

	// The changes since the person's baseline, as items in the order they happened. A change can name an item the read doesn't carry, which has nowhere to light.
	const sinceBaseline = changesModel?.changes;
	const waiting = useMemo(
		() => (state === 'ready' && layout && sinceBaseline ? changedItems(sinceBaseline, (key) => rows.has(key) && layout.representative[key] !== undefined) : []),
		[state, layout, rows, sinceBaseline],
	);
	const baseline = changesModel?.baseline ?? null;
	// A search or filter takes the canvas while it is on and gives it back when it ends; the view stays open behind it.
	const changesShown = interactive && !changesClosed && waiting.length > 0 && !lensActive;
	live.current = { openItemKey, openItem, onCloseItem, onMissing, model, clear: clearLens, lensActive, changesShown, closeChanges };
	const changesHighlight = useMemo(
		() => (layout && waiting.length > 0 ? highlightOf(waiting.map((item) => item.key), layout, waiting.slice(-RECENT_LABELS).map((item) => item.key)) : null),
		[layout, waiting],
	);
	const changeNotes = useMemo(
		() => (changesShown ? new Map(waiting.map((item) => [item.key, changeLines(item, rows.get(item.key)!, rows)])) : null),
		[changesShown, waiting, rows],
	);
	useEffect(() => surfaceRef.current!.setHighlight(lensActive ? lens.highlight : changesShown ? changesHighlight : null), [lens, lensActive, changesShown, changesHighlight]);
	useEffect(() => surfaceRef.current!.setChangeNotes(changeNotes), [changeNotes]);

	const drawerShowing = covered > 0;
	useEffect(() => {
		if (openItemKey && drawerShowing && interactive) surfaceRef.current!.reveal(openItemKey);
	}, [openItemKey, drawerShowing, interactive]);
	useEffect(() => surfaceRef.current!.setAllLinks(allLinks), [allLinks]);

	const surface = (): MapSurface => surfaceRef.current!;
	const handleFitAll = useCallback((): void => {
		surface().fitAll();
		anchor(null, true);
	}, [anchor]);
	const handleNow = useCallback((): void => {
		surface().now();
		anchor(null, true);
	}, [anchor]);
	const handleJumpToNearest = useCallback((): void => {
		const key = surface().jumpToNearest();
		if (key) anchor(key, true);
	}, [anchor]);
	const handleCenter = useCallback((point: MapPoint, fly: boolean): void => surface().centerOn(point, fly), []);
	const handleRetry = useCallback((): void => void model.retry(), [model]);
	const handleAllLinks = useCallback((): void => setAllLinks((on) => !on), []);
	const handleTogglePhase = useCallback((phase: MapPhase): void => {
		setPhases((previous) => {
			const next = new Set(previous);
			if (!next.delete(phase)) next.add(phase);
			return next;
		});
	}, []);
	const handleToggleNeeds = useCallback((): void => setNeedsOnly((on) => !on), []);
	const handleToggleLive = useCallback((): void => setLiveOnly((on) => !on), []);
	// The strip's summary is gone once the view it opens is, so focus goes to the view's bar instead of to the body.
	const focusBar = useRef(false);
	const handleOpenChanges = useCallback((): void => {
		focusBar.current = !lensActive;
		setChangesClosed(false);
	}, [lensActive]);
	useEffect(() => {
		if (!focusBar.current || !changesShown) return;
		focusBar.current = false;
		barRef.current?.querySelector('button')?.focus();
	}, [changesShown]);
	const handleMarkSeen = useCallback((): void => changesModel?.markSeen(), [changesModel]);
	const handleRoster = useCallback((): void => setRosterOpen((open) => !open), []);
	const handleCloseRoster = useCallback((): void => setRosterOpen(false), []);
	const roster = useMemo(() => (rosterOpen ? rosterOf(working, rows, now) : []), [rosterOpen, working, rows, now]);
	// A row selects its item, which opens it as a click does, and flies the Map there.
	const handlePick = useCallback((key: string): void => {
		setRosterOpen(false);
		surface().focusOn(key);
		live.current.openItem(key);
	}, []);

	// A step in the bar lands on an item: it takes the focus (so its relations light and its card opens) and the camera goes to it.
	const stepped = useRef(false);
	const handleStep = useCallback((key: string): void => {
		stepped.current = true;
		surface().setFocus(key);
		surface().focusOn(key);
		anchor(key, false);
	}, [anchor]);
	const handleJump = useCallback((key: string): void => {
		surface().focusOn(key);
		anchor(key, true);
	}, [anchor]);
	const handleRetrySearch = useCallback((): void => searcher.retry(), [searcher]);
	const barShown = interactive && (lensActive || changesShown);
	useEffect(() => {
		if (barShown || !stepped.current) return;
		stepped.current = false;
		surfaceRef.current?.setFocus(null);
	}, [barShown]);

	// Past the read cap, finished families come back folded into one row, so the count is of rows, not of items.
	const capped = interactive ? model.summarized : [];
	const summarized = capped.length > 0;

	const searching = searcher.query !== '';
	const searchFailed = searching && searcher.state === 'error';
	const lensTitle = searching ? `Matches for "${searcher.query}"` : `Filtered: ${describeFilters(filters).join(', ')}`;

	// The accessible tree, and which of its items the Map's keyboard focus is on.
	const tree = useMemo(
		() => (interactive && layout && facts ? buildTree({ layout, rows, needs: facts.needs, liveItems: facts.liveItems, working, now, idPrefix: `map-tree-${treeId}`, summarized }) : null),
		[interactive, layout, rows, facts, working, now, treeId, summarized],
	);
	const activeId = tree && layout ? activeNode(tree, layout, focusKey)?.id : undefined;

	// What each applied refresh changed is news to a listener: the model's update, the same one the canvas moves to. A load or a collapse has none.
	const shown = useRef<ReadonlyMap<string, MapItemRow>>(rows);
	const { changes: update } = model;
	useEffect(() => {
		const before = shown.current;
		shown.current = rows;
		if (update && state === 'ready') announcer.push(summarizeUpdate(update, rows, before));
	}, [update, state, rows, announcer]);

	const anchorSoon = useCallback((key: string): void => {
		window.clearTimeout(anchorTimer.current);
		anchorTimer.current = window.setTimeout(() => anchor(key, false), ANCHOR_PAUSE_MS);
	}, [anchor]);
	useEffect(() => () => window.clearTimeout(anchorTimer.current), []);

	// The tree holds the Map's keys while it has focus: arrows, Enter, the zoom and fit keys, P and L, and ] and [. Nothing else on the page hears them, and a field never does.
	const handleKeyDown = useCallback((event: KeyboardEvent): void => {
		if (event.defaultPrevented || event.target !== treeRef.current) return;
		const key = mapKeyOf(event);
		if (!key) return;
		event.preventDefault();
		const map = surface();
		switch (key.kind) {
			case 'move': {
				const to = map.moveFocus(key.direction);
				if (to) anchorSoon(to);
				break;
			}
			case 'open':
				map.activateFocus();
				break;
			case 'zoom-focus':
				if (key.direction === 'in') map.zoomInAtFocus();
				else map.zoomOutAtFocus();
				break;
			case 'fit-all':
				handleFitAll();
				break;
			case 'now':
				handleNow();
				break;
			case 'fit-focus': {
				const fit = map.fitFamily();
				if (fit) anchor(fit, true);
				break;
			}
			case 'needs': {
				const to = map.stepNeedsPerson(key.delta);
				if (to) anchorSoon(to);
				else announcer.say('Nothing needs a person right now');
				break;
			}
			case 'live': {
				// A session isn't an item, so there is nothing for the URL to anchor on.
				if (!map.stepLiveSession(key.delta)) announcer.say('No live agent sessions right now');
				break;
			}
			case 'step':
				stepRef.current?.(key.delta);
				break;
			case 'collapse':
				map.collapseFocus();
				break;
			case 'expand':
				map.expandFocus();
				break;
		}
	}, [anchor, anchorSoon, announcer, handleFitAll, handleNow]);

	// Tabbing in brings focus to the last thing it was on, or what is nearest the middle; a click on the Map isn't asking for an item.
	const handleFocusIn = useCallback((event: FocusEvent): void => {
		const map = surfaceRef.current;
		if (!map || pointerFocus.current || event.target !== treeRef.current || map.focus !== null) return;
		const back = lastFocus.current;
		if (back && map.canFocus(back)) map.setFocus(back);
		else map.focusNearCenter();
	}, []);
	// Focus leaving the Map for somewhere else puts the Map's own away: nothing stays lit, and no card stays open, for a keyboard that has gone elsewhere.
	const handleFocusOut = useCallback((event: FocusEvent): void => {
		const next = event.relatedTarget as Node | null;
		if (next && containerRef.current?.contains(next)) return;
		surfaceRef.current?.setFocus(null);
	}, []);
	// A screen reader's activate on a tree item is Enter on the focused one.
	const handleActivate = useCallback((key: string): void => {
		const map = surface();
		if (!map.canFocus(key)) return;
		map.setFocus(key);
		map.activateFocus();
	}, []);

	return (
		<div class={styles.map}>
			<SummaryStrip
				summary={facts?.summary ?? null}
				filters={filters}
				onTogglePhase={handleTogglePhase}
				onToggleNeedsPerson={handleToggleNeeds}
				onToggleLive={handleToggleLive}
				updatedAt={state === 'ready' ? model.loadedAt : null}
				retrying={model.retrying}
				agents={(compact) => <AgentsButton compact={compact} open={rosterOpen} disabled={!interactive} onClick={handleRoster} />}
				since={interactive && waiting.length > 0 && baseline !== null
					? { date: baselineDate(baseline), text: summaryText(waiting), open: changesShown, onOpen: handleOpenChanges }
					: undefined}
				announce={{ on: announce, onToggle: handleToggleAnnounce }}
			/>
			<div class={styles.plot} ref={containerRef} onKeyDown={handleKeyDown} onFocusIn={handleFocusIn} onFocusOut={handleFocusOut}>
				{tree && <MapTree tree={tree} activeId={activeId} selectedKey={openItemKey ?? null} onActivate={handleActivate} treeRef={treeRef} />}
				<canvas ref={canvasRef} class={styles.canvas} aria-hidden="true" />
				<MapCards store={overlay} bottom={RULER_HEIGHT} />
				<MapQuickCard store={overlay} activity={activity} bottom={RULER_HEIGHT} />
				<EdgeMarkers store={overlay} bottom={RULER_HEIGHT} onJump={handleJump} />
				<div class={styles.controls} ref={controlsRef} role="group" aria-label="Map view">
					<button type="button" class={styles.control} disabled={!interactive} onClick={handleFitAll}>Fit all</button>
					<button type="button" class={styles.control} disabled={!interactive} onClick={handleNow}>Now</button>
					<button type="button" class={styles.control} disabled={!interactive} aria-label="Zoom out" onClick={() => surface().zoomOut()}>&minus;</button>
					<button type="button" class={styles.control} disabled={!interactive} aria-label="Zoom in" onClick={() => surface().zoomIn()}>+</button>
					<button type="button" class={styles.control} disabled={!interactive} aria-pressed={allLinks} onClick={handleAllLinks}>All links</button>
				</div>
				{rosterOpen && (
					<div class={styles.roster}>
						<AgentRoster groups={roster} onPick={handlePick} onClose={handleCloseRoster} />
					</div>
				)}
				{barShown && (
					<div class={styles.barSlot} ref={barRef}>
						{lensActive ? (
							<SteppingBar
								key="lens"
								title={lensTitle}
								keys={searchFailed ? [] : lens.matches}
								unit={['match', 'matches']}
								empty={searchFailed ? 'Search failed' : 'No matches'}
								busy={searcher.state === 'loading'}
								onStep={handleStep}
								stepRef={stepRef}
								onClose={clearLens}
								closeLabel="Clear"
								action={searchFailed ? { label: 'Retry', onClick: handleRetrySearch } : undefined}
							/>
						) : (
							<SteppingBar
								key="changes"
								title={barTitle(baseline!)}
								keys={waiting.map((item) => item.key)}
								unit={['change', 'changes']}
								empty="No changes"
								onStep={handleStep}
								stepRef={stepRef}
								onClose={closeChanges}
								closeLabel="Close"
								accept={{ label: 'Mark all seen', onClick: handleMarkSeen }}
							/>
						)}
					</div>
				)}
				{summarized && <p class={styles.notice} ref={noticeRef} role="status">{readCapNotice(scope, capped)}</p>}
				<div class={styles.overlay} style={{ bottom: `${RULER_HEIGHT}px` }}>
					{state === 'loading' && <p class={styles.message} role="status">Loading the map...</p>}
					{state === 'error' && model.error && <LoadError error={model.error} onRetry={handleRetry} />}
					{model.isEmpty && <p class={styles.message}>Nothing on the map yet. New items land at the right edge.</p>}
					{interactive && viewportEmpty && (
						<button type="button" class={styles.jump} onClick={handleJumpToNearest}>Jump to the nearest dots</button>
					)}
				</div>
				<Minimap store={overlay} onCenter={handleCenter} />
			</div>
			<div class={styles.live} aria-live="polite" aria-atomic="true">{announcement}</div>
		</div>
	);
}
