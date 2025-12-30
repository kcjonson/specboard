import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import styles from './UserMenu.module.css';

export interface UserMenuProps {
	/** User's display name (used to generate initials) */
	displayName: string;
	/** User's email (optional, shown in menu header) */
	email?: string;
	/** Whether the user is an admin (shows Admin link if true) */
	isAdmin?: boolean;
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

const BASE_MENU_ITEMS = ['projects', 'settings', 'logout'] as const;
const ADMIN_MENU_ITEMS = ['projects', 'admin', 'settings', 'logout'] as const;
type MenuItemId = 'projects' | 'admin' | 'settings' | 'logout';

export function UserMenu({
	displayName,
	email,
	isAdmin,
	class: className,
}: UserMenuProps): JSX.Element {
	const menuItems = isAdmin ? ADMIN_MENU_ITEMS : BASE_MENU_ITEMS;
	const [isOpen, setIsOpen] = useState(false);
	const [focusedIndex, setFocusedIndex] = useState(-1);
	const menuRef = useRef<HTMLDivElement>(null);
	const menuItemRefs = useRef<Map<MenuItemId, HTMLElement>>(new Map());

	const initials = getInitials(displayName);

	const handleToggle = useCallback((): void => {
		setIsOpen((prev) => !prev);
	}, []);

	const handleLogoutClick = useCallback(async (): Promise<void> => {
		setIsOpen(false);
		try {
			await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
		} finally {
			window.location.href = '/login';
		}
	}, []);

	const activateItem = useCallback((index: number): void => {
		const item = menuItems[index];
		if (!item) return;
		if (item === 'logout') {
			handleLogoutClick();
		} else {
			// For links, trigger a click to navigate
			menuItemRefs.current.get(item)?.click();
		}
	}, [handleLogoutClick, menuItems]);

	// Focus first item when menu opens
	useEffect(() => {
		if (isOpen) {
			setFocusedIndex(0);
			const firstItem = menuItemRefs.current.get('projects');
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
						const next = prev < menuItems.length - 1 ? prev + 1 : 0;
						const item = menuItems[next];
						if (item) menuItemRefs.current.get(item)?.focus();
						return next;
					});
					break;
				case 'ArrowUp':
					e.preventDefault();
					setFocusedIndex((prev) => {
						const next = prev > 0 ? prev - 1 : menuItems.length - 1;
						const item = menuItems[next];
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
	}, [isOpen, focusedIndex, activateItem, menuItems]);

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
					<a
						href="/projects"
						class={styles.menuItem}
						role="menuitem"
						tabIndex={isOpen ? 0 : -1}
						ref={(el) => {
							if (el) menuItemRefs.current.set('projects', el);
						}}
					>
						Projects
					</a>
					{isAdmin && (
						<a
							href="/admin"
							class={styles.menuItem}
							role="menuitem"
							tabIndex={isOpen ? 0 : -1}
							ref={(el) => {
								if (el) menuItemRefs.current.set('admin', el);
							}}
						>
							Admin
						</a>
					)}
					<a
						href="/settings"
						class={styles.menuItem}
						role="menuitem"
						tabIndex={isOpen ? 0 : -1}
						ref={(el) => {
							if (el) menuItemRefs.current.set('settings', el);
						}}
					>
						Settings
					</a>
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
