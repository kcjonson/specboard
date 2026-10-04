import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { STATUS_TOKENS } from '@specboard/ui';
import type { MapPoint } from '../layout/types';
import type { MinimapFrame, OverlayStore } from '../overlay';
import { fromMinimap, toMinimap } from './minimap';
import styles from './Minimap.module.css';

export interface MinimapProps {
	store: OverlayStore;
	/** A click or drag in the miniature: put this layout point in the middle of the plot. `fly` is false for a drag. */
	onCenter(point: MapPoint, fly: boolean): void;
}

/** Arrow keys move the view by this share of what the plot shows. */
const KEY_STEP = 0.25;
const ARROWS: Record<string, MapPoint> = {
	ArrowLeft: { x: -1, y: 0 },
	ArrowRight: { x: 1, y: 0 },
	ArrowUp: { x: 0, y: -1 },
	ArrowDown: { x: 0, y: 1 },
};

/** Each dot is a speck this wide; what matters is the shape of the Map, not any one item. */
const SPECK = 2;

function drawSpecks(canvas: HTMLCanvasElement, frame: MinimapFrame): void {
	const ctx = canvas.getContext('2d');
	if (!ctx) return;
	const ratio = window.devicePixelRatio || 1;
	const { width, height } = frame.size;
	canvas.width = Math.max(1, Math.round(width * ratio));
	canvas.height = Math.max(1, Math.round(height * ratio));
	ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
	const style = window.getComputedStyle(canvas);
	const colors = new Map<string, string>();
	for (const [status, token] of Object.entries(STATUS_TOKENS)) colors.set(status, style.getPropertyValue(token).trim());
	for (const dot of frame.dots) {
		const { x, y } = toMinimap(frame.size, frame.bounds, dot);
		ctx.fillStyle = colors.get(dot.status) ?? style.color;
		ctx.fillRect(x - SPECK / 2, y - SPECK / 2, SPECK, SPECK);
	}
}

/**
 * The whole Map in miniature over the plot's lower left, the viewport marked. It is DOM
 * rather than canvas so it can sit above the cards; its panel is the box the surface
 * keeps labels off. It is a focus stop of its own: the arrow keys move the view a
 * quarter of the plot, as a click moves it to a point. The specks redraw when the
 * Map's dots, size, or theme change, and a pan only moves the rectangle.
 */
export function Minimap({ store, onCenter }: MinimapProps): JSX.Element | null {
	const [frame, setFrame] = useState<MinimapFrame | null>(store.frame.minimap);
	const specks = useRef<HTMLCanvasElement>(null);
	const latest = useRef<MinimapFrame | null>(frame);
	latest.current = frame;

	useEffect(() => store.subscribe(({ minimap }) => setFrame(minimap)), [store]);

	const dots = frame?.dots;
	const scale = frame?.size.scale;
	useEffect(() => {
		const canvas = specks.current;
		if (!canvas || !latest.current) return;
		const redraw = (): void => {
			if (latest.current) drawSpecks(canvas, latest.current);
		};
		redraw();
		const scheme = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
		scheme?.addEventListener('change', redraw);
		return () => scheme?.removeEventListener('change', redraw);
	}, [dots, scale]);

	if (!frame) return null;
	const { panel, size, bounds, viewport, center, span } = frame;
	const point = (event: PointerEvent): MapPoint => {
		const rect = specks.current!.getBoundingClientRect();
		return fromMinimap(size, bounds, { x: event.clientX - rect.left, y: event.clientY - rect.top });
	};
	const onKeyDown = (event: KeyboardEvent): void => {
		const step = ARROWS[event.key];
		if (!step || event.ctrlKey || event.metaKey || event.altKey) return;
		event.preventDefault();
		onCenter({ x: center.x + step.x * KEY_STEP * span.width, y: center.y + step.y * KEY_STEP * span.height }, true);
	};
	return (
		<div
			class={styles.minimap}
			style={{ left: `${panel.x}px`, top: `${panel.y}px`, width: `${panel.w}px`, height: `${panel.h}px` }}
			role="group"
			aria-label="Minimap"
			aria-description="Arrow keys move the view"
			tabIndex={0}
			onKeyDown={onKeyDown}
			onPointerDown={(event) => {
				event.currentTarget.setPointerCapture(event.pointerId);
				onCenter(point(event), true);
			}}
			onPointerMove={(event) => {
				if (event.currentTarget.hasPointerCapture(event.pointerId)) onCenter(point(event), false);
			}}
		>
			<canvas ref={specks} class={styles.specks} aria-hidden="true" style={{ width: `${size.width}px`, height: `${size.height}px` }} />
			<div class={styles.viewport} aria-hidden="true" style={{ width: `${viewport.w}px`, height: `${viewport.h}px`, transform: `translate(${viewport.x}px, ${viewport.y}px)` }} />
		</div>
	);
}
