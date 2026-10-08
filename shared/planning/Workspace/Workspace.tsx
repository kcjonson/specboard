import { useCallback, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import styles from './Workspace.module.css';

/** The drawer's least width (ItemDrawer's own minimum), and the least the view keeps beside it. */
const DRAWER_MIN_WIDTH = 320;
const VIEW_MIN_WIDTH = 360;

/** What the workspace hands the drawer: the widest it may grow, and where its width goes. */
export interface DrawerBounds {
	maxWidth: number | undefined;
	onResize: (width: number) => void;
}

export interface WorkspaceProps {
	/** The active view (the Board, the Table, or the Map), given how much of its right side the drawer covers. */
	children: (covered: number) => ComponentChildren;
	/** The open item's drawer; null while nothing is open. */
	drawer: ((bounds: DrawerBounds) => JSX.Element) | null;
	/** On the Map the drawer lies over the plot's right side instead of narrowing it. */
	overlay: boolean;
}

/**
 * A planning page's working area: the active view and, beside it, the item drawer. The
 * workspace is measured so the drawer can't widen past leaving the view a usable minimum;
 * a callback ref keeps the observer bound to whichever node is current rather than to the
 * one present at mount. The drawer reports its width, which the view hears as how much of
 * it is covered, so the Map can keep what's selected clear of it.
 */
export function Workspace({ children, drawer, overlay }: WorkspaceProps): JSX.Element {
	const [width, setWidth] = useState(0);
	const [drawerWidth, setDrawerWidth] = useState(0);
	const observerRef = useRef<ResizeObserver | null>(null);
	const workspaceRef = useCallback((node: HTMLDivElement | null): void => {
		observerRef.current?.disconnect();
		if (node && typeof ResizeObserver !== 'undefined') {
			const observer = new ResizeObserver((entries) => {
				const entry = entries[0];
				if (entry) setWidth(entry.contentRect.width);
			});
			observer.observe(node);
			observerRef.current = observer;
		}
	}, []);
	const maxWidth = width > 0 ? Math.max(DRAWER_MIN_WIDTH, width - VIEW_MIN_WIDTH) : undefined;

	return (
		<div class={styles.workspace} ref={workspaceRef}>
			<div class={styles.viewArea}>{children(drawer ? drawerWidth : 0)}</div>
			{drawer && (
				<div class={overlay ? styles.drawerOverlay : styles.drawerSlot}>
					{drawer({ maxWidth, onResize: setDrawerWidth })}
				</div>
			)}
		</div>
	);
}
