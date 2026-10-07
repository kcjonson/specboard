import { useMemo, useEffect } from 'preact/hooks';
import type { JSX, ComponentChildren } from 'preact';
import { getCookie, setCookie } from '@specboard/core/cookies';
import { projectModel, refreshProject, useModel, UserModel } from '@specboard/models';
import { Badge } from '../Badge/Badge';
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

	// The page's shared project model (see projectModel). The header is mounted once per
	// page, so it is where that model is re-read on each page view: a role changed since
	// the last one reaches the header and everything else reading the model.
	const project = useMemo(() => (projectRef ? projectModel(projectRef) : null), [projectRef]);
	useModel(project);
	useEffect(() => {
		if (projectRef && project?.$meta.lastFetched != null) refreshProject(projectRef);
	}, [projectRef, project]);

	// RootRedirect reopens the last project from these, and the name cookie keeps the
	// header from flashing blank while a page's project loads.
	const loadedName = project?.name;
	useEffect(() => {
		if (!projectRef || !loadedName) return;
		setCookie('lastProjectRef', projectRef, 30);
		setCookie('lastProjectName', loadedName, 30);
	}, [projectRef, loadedName]);
	const projectName = loadedName ?? (projectRef && getCookie('lastProjectRef') === projectRef ? getCookie('lastProjectName') : null);
	const viewOnly = project?.effectiveRole === 'viewer';

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
						{viewOnly && (
							<Badge class="size-sm" title="You can see this project but not change it">
								View only
							</Badge>
						)}
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
