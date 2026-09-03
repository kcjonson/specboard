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
	/** Project slug - if provided, shows project name and nav tabs */
	projectSlug?: string;
	/** Currently active tab (matches NavTabLabel) */
	activeTab?: NavTabLabel;
	/** Page title - shown when no projectSlug (for non-project pages like Settings) */
	title?: string;
	/** Optional right-side action buttons (placed before user menu) */
	actions?: ComponentChildren;
	/** Additional CSS class */
	class?: string;
}

export function WebHeader({
	projectSlug,
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
		const lastProjectSlug = getCookie('lastProjectSlug');
		const cachedName = projectSlug && lastProjectSlug === projectSlug ? getCookie('lastProjectName') : null;

		if (!projectSlug || cachedName) {
			setFetchedName(cachedName);
			return;
		}

		// Track if effect is still active for cleanup
		let cancelled = false;

		// Fetch project name and update cookie
		fetchClient
			.get<{ id: string; name: string }>(`/api/projects/${projectSlug}`, { params: { fields: 'name' } })
			.then((project) => {
				if (cancelled) return;
				setFetchedName(project.name);
				setCookie('lastProjectSlug', projectSlug, 30);
				setCookie('lastProjectName', project.name, 30);
			})
			.catch(() => {
				// Silently fail - header will just be empty
			});

		return () => {
			cancelled = true;
		};
	}, [projectSlug]);

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
				{projectSlug ? (
					<>
						<span class={styles.projectName}>{projectName ?? ''}</span>
						<nav class={styles.nav}>
							{NAV_TABS.map((tab) => (
								<a
									key={tab.label}
									href={`/projects/${projectSlug}/${tab.path}`}
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
				{projectSlug && (
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
									href={`/projects/${projectSlug}/${tab.path}`}
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
