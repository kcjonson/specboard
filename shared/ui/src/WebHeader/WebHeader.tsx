import { useMemo, useState, useEffect } from 'preact/hooks';
import type { JSX, ComponentChildren } from 'preact';
import { getCookie, setCookie } from '@doc-platform/core/cookies';
import { fetchClient } from '@doc-platform/fetch';
import { useModel, UserModel } from '@doc-platform/models';
import { UserMenu } from '../UserMenu/UserMenu';
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
	/** Project ID - if provided, shows project name and nav tabs */
	projectId?: string;
	/** Currently active tab (matches NavTabLabel) */
	activeTab?: NavTabLabel;
	/** Page title - shown when no projectId (for non-project pages like Settings) */
	title?: string;
	/** Optional right-side action buttons (placed before user menu) */
	actions?: ComponentChildren;
	/** Additional CSS class */
	class?: string;
}

export function WebHeader({
	projectId,
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
	const lastProjectId = getCookie('lastProjectId');
	const cachedName = projectId && lastProjectId === projectId ? getCookie('lastProjectName') : null;
	const [fetchedName, setFetchedName] = useState<string | null>(null);

	useEffect(() => {
		if (!projectId || cachedName) {
			setFetchedName(null);
			return;
		}

		// Fetch project name and update cookie
		fetchClient
			.get<{ id: string; name: string }>(`/api/projects/${projectId}?fields=name`)
			.then((project) => {
				setFetchedName(project.name);
				setCookie('lastProjectId', projectId, 30);
				setCookie('lastProjectName', project.name, 30);
			})
			.catch(() => {
				// Silently fail - header will just be empty
			});
	}, [projectId, cachedName]);

	const projectName = cachedName ?? fetchedName;

	return (
		<header class={`${styles.header} ${className || ''}`}>
			<div class={styles.left}>
				{projectId ? (
					<>
						<span class={styles.projectName}>{projectName ?? ''}</span>
						<nav class={styles.nav}>
							{NAV_TABS.map((tab) => (
								<a
									key={tab.label}
									href={`/projects/${projectId}/${tab.path}`}
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
				{user.first_name && (
					<UserMenu
						displayName={`${user.first_name} ${user.last_name}`.trim()}
						email={user.email}
						isAdmin={isAdmin}
					/>
				)}
			</div>
		</header>
	);
}
