import type { JSX } from 'preact';
import { Icon } from '../Icon/Icon';
import styles from './DrawerHandle.module.css';

export interface DrawerHandleProps {
	/** Whether the drawer this handle belongs to is open */
	open: boolean;
	/** Toggle the drawer */
	onToggle: () => void;
	/** Accessible label while the drawer is closed (e.g. "Browse files") */
	openLabel: string;
	/** Accessible label while the drawer is open (e.g. "Close file drawer") */
	closeLabel: string;
}

/**
 * Standard edge handle for small-screen drawers. Render it as a direct child of
 * the drawer panel: it pins itself to the panel's trailing edge near the bottom,
 * pokes past the screen edge while the drawer is parked off-screen, and rides
 * the drawer edge with the chevron flipped while open. Owns the pill shape,
 * shadow, 44px hit area, bottom offset, and reduced-motion handling. Hidden on
 * desktop, where drawers are in-flow columns.
 */
export function DrawerHandle({ open, onToggle, openLabel, closeLabel }: DrawerHandleProps): JSX.Element {
	return (
		<button
			type="button"
			class={`${styles.handle} ${open ? styles.open : ''}`}
			onClick={onToggle}
			aria-label={open ? closeLabel : openLabel}
			aria-expanded={open}
		>
			<Icon name="chevron-right" />
		</button>
	);
}
