import { useMemo, useEffect } from 'preact/hooks';
import type { JSX, ComponentChildren } from 'preact';
import { getCookie, setCookie } from '@specboard/core/cookies';
import { parseProjectRef } from '@specboard/core/identifiers';
import { projectModel, projectRoleState, refreshProject, useModel, UserModel } from '@specboard/models';
import { Badge } from '../Badge/Badge';
import { UserMenu } from '../UserMenu/UserMenu';
import { Logo } from '../Logo/Logo';
import { Icon } from '../Icon/Icon';
import styles from './WebHeader.module.css';

/** Navigation tab labels - use these for activeTab prop */
export type NavTabLabel = 'Planning' | 'Pages' | 'Settings';

interface NavTab {
	label: NavTabLabel;
	path: string;
}

const NAV_TABS: NavTab[] = [
	{ label: 'Planning', path: 'planning' },
	{ label: 'Pages', path: 'pages' },
];

/** Shown as a gear beside the tabs; in the small-screen menu it is one more row. */
const SETTINGS_TAB: NavTab = { label: 'Settings', path: 'settings' };

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
	// the last one, or a read that failed, reaches the header and everything else reading
	// the model. On the page that first creates the model its read is still in flight,
	// and refreshProject leaves it be.
	const project = useMemo(() => (projectRef ? projectModel(projectRef) : null), [projectRef]);
	useModel(project);
	useEffect(() => {
		if (projectRef) refreshProject(projectRef);
	}, [projectRef]);

	// RootRedirect reopens the last project from these, and the name cookie keeps the
	// header from flashing blank while a page's project loads.
	const loadedName = project?.name;
	useEffect(() => {
		if (!projectRef || !loadedName) return;
		setCookie('lastProjectRef', projectRef, 30);
		setCookie('lastProjectName', loadedName, 30);
	}, [projectRef, loadedName]);
	const projectName = loadedName ?? (projectRef && getCookie('lastProjectRef') === projectRef ? getCookie('lastProjectName') : null);
	// The owner half comes straight from the address, so it never waits on the project read.
	const ownerSlug = projectRef ? parseProjectRef(projectRef)?.owner ?? null : null;
	const viewOnly = project ? projectRoleState(project).effectiveRole === 'viewer' : false;

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
						<span class={styles.projectTitle}>
							{ownerSlug && (
								<>
									<a href="/projects" class={styles.ownerLink} title="All projects">{ownerSlug}</a>
									<span class={styles.titleSeparator} aria-hidden="true">/</span>
								</>
							)}
							<span class={styles.projectName}>{projectName ?? ''}</span>
						</span>
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
							<a
								href={`/projects/${projectRef}/${SETTINGS_TAB.path}`}
								class={`${styles.navTab} ${styles.settingsTab} ${activeTab === SETTINGS_TAB.label ? styles.navTabActive : ''}`}
								aria-label="Project settings"
								title="Project settings"
								aria-current={activeTab === SETTINGS_TAB.label ? 'page' : undefined}
							>
								<Icon name="settings" />
							</a>
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
							{projectName && <div class={styles.menuProject}>{ownerSlug ? `${ownerSlug} / ${projectName}` : projectName}</div>}
							<div class={styles.menuDivider} />
							{[...NAV_TABS, SETTINGS_TAB].map((tab) => (
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
						avatarUrl={user.avatar_url}
						email={user.email}
						isAdmin={isAdmin}
					/>
				)}
			</div>
		</header>
	);
}
