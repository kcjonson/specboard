import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import styles from './UserMenu.module.css';

export interface UserMenuProps {
	/** User's display name (used to generate initials) */
	displayName: string;
	/** User's email (optional, shown in menu header) */
	email?: string;
	/** Called when Settings is clicked */
	onSettingsClick?: () => void;
	/** Called when Logout is clicked */
	onLogoutClick?: () => void;
	/** Additional CSS class */
	class?: string;
}

function getInitials(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) {
		return '?';
	}
	const parts = trimmed.split(/\s+/);
	if (parts.length >= 2) {
		const first = parts[0];
		const last = parts[parts.length - 1];
		return (first?.[0] || '').toUpperCase() + (last?.[0] || '').toUpperCase();
	}
	return trimmed[0]?.toUpperCase() || '?';
}

const MENU_ITEMS = ['settings', 'logout'] as const;
type MenuItemId = typeof MENU_ITEMS[number];

export function UserMenu({
	displayName,
	email,
	onSettingsClick,
	onLogoutClick,
	class: className,
}: UserMenuProps): JSX.Element {
	const [isOpen, setIsOpen] = useState(false);
	const [focusedIndex, setFocusedIndex] = useState(-1);
	const menuRef = useRef<HTMLDivElement>(null);
	const menuItemRefs = useRef<Map<MenuItemId, HTMLButtonElement>>(new Map());

	const initials = getInitials(displayName);

	const handleToggle = useCallback((): void => {
		setIsOpen((prev) => !prev);
	}, []);

	const handleSettingsClick = useCallback((): void => {
		setIsOpen(false);
		onSettingsClick?.();
	}, [onSettingsClick]);

	const handleLogoutClick = useCallback((): void => {
		setIsOpen(false);
		onLogoutClick?.();
	}, [onLogoutClick]);

	const activateItem = useCallback((index: number): void => {
		if (index === 0) {
			handleSettingsClick();
		} else if (index === 1) {
			handleLogoutClick();
		}
	}, [handleSettingsClick, handleLogoutClick]);

	// Focus first item when menu opens
	useEffect(() => {
		if (isOpen) {
			setFocusedIndex(0);
			const firstItem = menuItemRefs.current.get('settings');
			firstItem?.focus();
		} else {
			setFocusedIndex(-1);
		}
	}, [isOpen]);

	// Close menu when clicking outside and handle keyboard navigation
	useEffect(() => {
		if (!isOpen) return;

		const handleClickOutside = (e: MouseEvent): void => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				setIsOpen(false);
			}
		};

		const handleKeyDown = (e: KeyboardEvent): void => {
			switch (e.key) {
				case 'Escape':
					setIsOpen(false);
					break;
				case 'ArrowDown':
					e.preventDefault();
					setFocusedIndex((prev) => {
						const next = prev < MENU_ITEMS.length - 1 ? prev + 1 : 0;
						const item = MENU_ITEMS[next];
						if (item) menuItemRefs.current.get(item)?.focus();
						return next;
					});
					break;
				case 'ArrowUp':
					e.preventDefault();
					setFocusedIndex((prev) => {
						const next = prev > 0 ? prev - 1 : MENU_ITEMS.length - 1;
						const item = MENU_ITEMS[next];
						if (item) menuItemRefs.current.get(item)?.focus();
						return next;
					});
					break;
				case 'Enter':
				case ' ':
					if (focusedIndex >= 0) {
						e.preventDefault();
						activateItem(focusedIndex);
					}
					break;
			}
		};

		document.addEventListener('mousedown', handleClickOutside);
		document.addEventListener('keydown', handleKeyDown);

		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, [isOpen, focusedIndex, activateItem]);

	return (
		<div class={`${styles.container} ${className || ''}`} ref={menuRef}>
			<button
				type="button"
				class={styles.avatar}
				onClick={handleToggle}
				aria-expanded={isOpen}
				aria-haspopup="menu"
				aria-label={`User menu for ${displayName}`}
			>
				{initials}
			</button>

			{isOpen && (
				<div class={styles.dropdown} role="menu">
					<div class={styles.header}>
						<span class={styles.name}>{displayName}</span>
						{email && <span class={styles.email}>{email}</span>}
					</div>
					<div class={styles.divider} />
					<button
						type="button"
						class={styles.menuItem}
						onClick={handleSettingsClick}
						role="menuitem"
						tabIndex={isOpen ? 0 : -1}
						ref={(el) => {
							if (el) menuItemRefs.current.set('settings', el);
						}}
					>
						Settings
					</button>
					<button
						type="button"
						class={styles.menuItem}
						onClick={handleLogoutClick}
						role="menuitem"
						tabIndex={isOpen ? 0 : -1}
						ref={(el) => {
							if (el) menuItemRefs.current.set('logout', el);
						}}
					>
						Log out
					</button>
				</div>
			)}
		</div>
	);
}
