import { useMemo, useState, useEffect } from 'preact/hooks';
import type { JSX, ComponentChildren } from 'preact';
import { getCookie, setCookie } from '@specboard/core/cookies';
import { fetchClient } from '@specboard/fetch';
import { useModel, UserModel } from '@specboard/models';
import { UserMenu } from '../UserMenu/UserMenu';
import { Logo } from '../Logo/Logo';
import { Icon } from '../Icon/Icon';
import styles from './WebHeader.module.css';

/** Navigation tab labels - use these for activeTab prop */
export type NavTabLabel = 'Planning' | 'Pages';

interface NavTab {
	label: NavTabLabel;
	path: string;
}

const NAV_TABS: NavTab[] = [
	{ label: 'Planning', path: 'planning' },
	{ label: 'Pages', path: 'pages' },
];

export interface WebHeaderProps {
	/** Project ref (owner/project) - if provided, shows project name and nav tabs */
	projectRef?: string;
	/** Currently active tab (matches NavTabLabel) */
	activeTab?: NavTabLabel;
	/** Page title - shown when no projectRef (for non-project pages like Settings) */
	title?: string;
	/** Optional right-side action buttons (placed before user menu) */
	actions?: ComponentChildren;
	/** Additional CSS class */
	class?: string;
}

export function WebHeader({
	projectRef,
	activeTab,
	title,
	actions,
	class: className,
}: WebHeaderProps): JSX.Element {
	// Create and bind UserModel - request deduplication prevents duplicate API calls
	const user = useMemo(() => new UserModel({ id: 'me' }), []);
	useModel(user);

	const isAdmin = user.roles?.includes('admin') ?? false;

	// Get project name from cookie or fetch if needed
	const [fetchedName, setFetchedName] = useState<string | null>(null);

	useEffect(() => {
		// Check cookie inside effect to ensure consistent behavior
		const lastProjectRef = getCookie('lastProjectRef');
		const cachedName = projectRef && lastProjectRef === projectRef ? getCookie('lastProjectName') : null;

		if (!projectRef || cachedName) {
			setFetchedName(cachedName);
			return;
		}

		// Track if effect is still active for cleanup
		let cancelled = false;

		// Fetch project name and update cookie
		fetchClient
			.get<{ id: string; name: string }>(`/api/projects/${projectRef}`, { params: { fields: 'name' } })
			.then((project) => {
				if (cancelled) return;
				setFetchedName(project.name);
				setCookie('lastProjectRef', projectRef, 30);
				setCookie('lastProjectName', project.name, 30);
			})
			.catch(() => {
				// Silently fail - header will just be empty
			});

		return () => {
			cancelled = true;
		};
	}, [projectRef]);

	const projectName = fetchedName;

	// Router navigation swaps the page under the popover but the popover element
	// survives the re-render, so close it explicitly when a link is chosen.
	const handleMenuNavClick = (e: MouseEvent): void => {
		if ((e.target as HTMLElement).closest('a')) {
			(e.currentTarget as HTMLElement).hidePopover();
		}
	};

	return (
		<header class={`${styles.header} ${className || ''}`}>
			<div class={styles.left}>
				<Logo size={16} responsive href="/projects" />
				<span class={styles.brandDivider} />
				{projectRef ? (
					<>
						<span class={styles.projectName}>{projectName ?? ''}</span>
						<nav class={styles.nav}>
							{NAV_TABS.map((tab) => (
								<a
									key={tab.label}
									href={`/projects/${projectRef}/${tab.path}`}
									class={`${styles.navTab} ${activeTab === tab.label ? styles.navTabActive : ''}`}
								>
									{tab.label}
								</a>
							))}
						</nav>
					</>
				) : (
					<>
						{title && <span class={styles.pageTitle}>{title}</span>}
						{title !== 'Projects' && (
							<nav class={styles.nav}>
								<a href="/projects" class={styles.navTab}>Projects</a>
							</nav>
						)}
					</>
				)}
			</div>
			<div class={styles.actions}>
				{actions}
				{projectRef && (
					<>
						<button
							type="button"
							class={`icon mobile-only ${styles.menuButton}`}
							popovertarget="sb-nav-menu"
							aria-label="Project menu"
						>
							<Icon name="menu" />
						</button>
						<div popover="auto" id="sb-nav-menu" class={styles.menuPopover} onClick={handleMenuNavClick}>
							{projectName && <div class={styles.menuProject}>{projectName}</div>}
							<div class={styles.menuDivider} />
							{NAV_TABS.map((tab) => (
								<a
									key={tab.label}
									href={`/projects/${projectRef}/${tab.path}`}
									class={`${styles.menuItem} ${activeTab === tab.label ? styles.menuItemActive : ''}`}
									aria-current={activeTab === tab.label ? 'page' : undefined}
								>
									{tab.label}
								</a>
							))}
						</div>
					</>
				)}
				{user.email && (
					<UserMenu
						displayName={[user.first_name, user.last_name].filter(Boolean).join(' ') || user.email.split('@')[0] || user.email}
						email={user.email}
						isAdmin={isAdmin}
					/>
				)}
			</div>
		</header>
	);
}
