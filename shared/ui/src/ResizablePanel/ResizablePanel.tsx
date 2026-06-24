import { useRef, useState, useEffect } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import styles from './ResizablePanel.module.css';

/** Keyboard resize steps (px). */
const STEP = 16;
const STEP_LARGE = 64;

export interface ResizablePanelProps {
	/** Stable id; persisted under `specboard.panel.<storageKey>.width`. */
	storageKey: string;
	/**
	 * Which inner edge the handle sits on. A left sidebar uses `'right'`; a right
	 * sidebar/drawer uses `'left'`. Also flips the sign of the drag/keyboard math.
	 */
	handleSide: 'left' | 'right';
	defaultWidth: number;
	minWidth: number;
	/** Upper bound; the parent may recompute each render (e.g. to protect a sibling). */
	maxWidth?: number;
	/** Called whenever the width changes (restore, drag, keyboard, re-clamp). */
	onResize?: (width: number) => void;
	/** Accessible label for the separator, e.g. "Resize file browser". */
	label: string;
	/** Extra class names applied to the panel root. */
	class?: string;
	children: ComponentChildren;
}

const clamp = (value: number, lo: number, hi: number): number => Math.min(Math.max(value, lo), hi);
const storageKeyFor = (key: string): string => `specboard.panel.${key}.width`;

function readStoredWidth(key: string, fallback: number): number {
	try {
		const stored = globalThis.localStorage?.getItem(storageKeyFor(key));
		const parsed = stored == null ? NaN : Number(stored);
		return Number.isFinite(parsed) ? parsed : fallback;
	} catch {
		return fallback;
	}
}

/**
 * A fixed-position panel whose width the user can drag to resize, with the value
 * persisted to localStorage. The single drag-to-resize primitive in the app
 * (editor sidebars, planning drawer).
 *
 * The drag leans on pointer capture: `setPointerCapture` retargets move/up to the
 * handle, and `lostpointercapture` fires on release *or* if the panel unmounts
 * mid-drag — so one handler covers all the teardown. Width ownership/persistence
 * live here; the only cross-panel coupling is the optional `maxWidth`/`onResize`
 * pair, used where a parent must enforce a constraint it alone can see.
 */
export function ResizablePanel(props: ResizablePanelProps): JSX.Element {
	const { storageKey, handleSide, defaultWidth, minWidth, maxWidth = Infinity, onResize, label } = props;

	const [width, setWidthState] = useState(() => clamp(readStoredWidth(storageKey, defaultWidth), minWidth, maxWidth));
	const panelRef = useRef<HTMLDivElement>(null);
	const stationaryEdge = useRef(0);

	const setWidth = (next: number): void => {
		const w = clamp(next, minWidth, maxWidth);
		setWidthState(w);
		try {
			globalThis.localStorage?.setItem(storageKeyFor(storageKey), String(Math.round(w)));
		} catch {
			// A UI preference that can't persist is non-fatal.
		}
	};

	// Re-clamp when bounds tighten (viewport shrinks, sibling grows); report up.
	useEffect(() => setWidthState((w) => clamp(w, minWidth, maxWidth)), [minWidth, maxWidth]);
	useEffect(() => onResize?.(width), [width, onResize]);

	const onPointerDown = (e: PointerEvent): void => {
		const rect = panelRef.current?.getBoundingClientRect();
		if (!rect) return;
		e.preventDefault();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		stationaryEdge.current = handleSide === 'right' ? rect.left : rect.right;
		document.body.style.userSelect = 'none';
		document.body.style.cursor = 'col-resize';
	};

	const onPointerMove = (e: PointerEvent): void => {
		if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
		setWidth(handleSide === 'right' ? e.clientX - stationaryEdge.current : stationaryEdge.current - e.clientX);
	};

	// Fires on pointer up/cancel and on unmount-while-captured — the only teardown.
	const onLostPointerCapture = (): void => {
		document.body.style.userSelect = '';
		document.body.style.cursor = '';
	};

	const onKeyDown = (e: KeyboardEvent): void => {
		// stopPropagation keeps resize keys from reaching document-level listeners
		// (e.g. the planning board's keyboard navigation).
		const grow = handleSide === 'right' ? 1 : -1;
		const step = (e.shiftKey ? STEP_LARGE : STEP) * grow;
		if (e.key === 'ArrowRight') setWidth(width + step);
		else if (e.key === 'ArrowLeft') setWidth(width - step);
		else if (e.key === 'Home') setWidth(minWidth);
		else if (e.key === 'End' && Number.isFinite(maxWidth)) setWidth(maxWidth);
		else return;
		e.preventDefault();
		e.stopPropagation();
	};

	return (
		<div
			ref={panelRef}
			class={props.class ? `${styles.panel} ${props.class}` : styles.panel}
			style={{ width: `${width}px` }}
		>
			{props.children}
			<div
				class={`${styles.handle} ${handleSide === 'right' ? styles.handleRight : styles.handleLeft}`}
				role="separator"
				aria-orientation="vertical"
				aria-label={label}
				aria-valuemin={minWidth}
				aria-valuemax={Number.isFinite(maxWidth) ? maxWidth : undefined}
				aria-valuenow={Math.round(width)}
				tabIndex={0}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onLostPointerCapture={onLostPointerCapture}
				onKeyDown={onKeyDown}
			/>
		</div>
	);
}
