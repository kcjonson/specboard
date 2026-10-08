import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Avatar, Badge, Card, StatusGlyph, Icon } from '@specboard/ui';
import type { ProjectRole } from '@specboard/models';
import { ProjectKey } from '@shared/planning';
import styles from './ProjectCard.module.css';

export type SyncStatus = 'pending' | 'syncing' | 'completed' | 'failed';

export interface ItemCounts {
	ready: number;
	in_progress: number;
	in_review: number;
	done: number;
}

export interface RepositoryConfigCloud {
	type: 'cloud';
	remote: {
		provider: 'github';
		owner: string;
		repo: string;
		url: string;
	};
	branch: string;
}

export function isCloudRepository(repo: Project['repository']): repo is RepositoryConfigCloud {
	return repo !== undefined && 'type' in repo && repo.type === 'cloud';
}

export interface Project {
	id: string;
	/** URL identifier for this project, unique per owner (e.g. "roadmap"). */
	slug: string;
	/** The owner's user slug; the project's address is ownerSlug/slug (acme/roadmap). */
	ownerSlug: string;
	/** The owner's display name. */
	ownerName: string;
	/** The caller's role as granted: owner for their own projects, else their membership's. */
	grantedRole: ProjectRole;
	/** The role access checks use: a granted editor without GitHub works as a viewer. */
	effectiveRole: ProjectRole;
	/** Short uppercase prefix for this project's item keys (e.g. "SB"). */
	key: string;
	name: string;
	description?: string;
	systemPrompt?: string;
	itemCount: number;
	itemCounts?: ItemCounts;
	repository?: RepositoryConfigCloud | Record<string, never>;
	syncStatus?: SyncStatus | null;
	syncError?: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface ProjectCardProps {
	project: Project;
	onClick: (project: Project) => void;
	/** Open the project's settings. Owners only; a shared card gets neither this nor retry. */
	onOpenSettings?: (project: Project) => void;
	onRetrySync?: (project: Project) => Promise<void>;
	/**
	 * Set while the page is picking projects to view together. The card is then a checkbox
	 * in this state, and onClick toggles it; the page leaves out its other actions, since a
	 * checkbox can't hold controls of its own.
	 */
	selected?: boolean;
}

const ROLE_LABELS: Record<ProjectRole, string> = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' };

export function ProjectCard({ project, onClick, onOpenSettings, onRetrySync, selected }: ProjectCardProps): JSX.Element {
	const [isRetrying, setIsRetrying] = useState(false);

	function handleClick(): void {
		onClick(project);
	}

	function handleKeyDown(event: KeyboardEvent): void {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onClick(project);
		}
	}

	function handleSettingsClick(event: MouseEvent): void {
		event.stopPropagation();
		onOpenSettings?.(project);
	}

	function handleSettingsKeyDown(event: KeyboardEvent): void {
		if (event.key === 'Enter' || event.key === ' ') {
			event.stopPropagation();
		}
	}

	async function handleRetryClick(event: MouseEvent): Promise<void> {
		event.stopPropagation();
		if (!onRetrySync || isRetrying) return;
		setIsRetrying(true);
		try {
			await onRetrySync(project);
		} finally {
			setIsRetrying(false);
		}
	}

	const { itemCounts, syncStatus, syncError } = project;
	const hasItems = project.itemCount > 0;
	const isSyncing = syncStatus === 'pending' || syncStatus === 'syncing';
	const hasSyncError = syncStatus === 'failed';
	const picking = selected !== undefined;
	const shared = project.grantedRole !== 'owner';

	return (
		<Card
			class={[styles.card, picking && styles.picking, selected && 'variant-selected'].filter(Boolean).join(' ')}
			onClick={handleClick}
			onKeyDown={handleKeyDown}
			tabIndex={0}
			role={picking ? 'checkbox' : 'button'}
			aria-checked={selected}
			aria-label={picking ? `${project.name} (${project.key})` : undefined}
		>
			<div class={styles.header}>
				{/* Only the look of a checkbox: the card is the control, so this one is inert. */}
				{picking && <input type="checkbox" class={styles.pickBox} checked={selected} inert />}
				<h3 class={styles.name}>{project.name}</h3>
				{/* Shown while picking, because two projects can't share a prefix in one view. */}
				{picking && <ProjectKey prefix={project.key} />}
				{onOpenSettings && (
					<button
						type="button"
						class={styles.settingsButton}
						onClick={handleSettingsClick}
						onKeyDown={handleSettingsKeyDown}
						aria-label="Project settings"
						title="Project settings"
					>
						<Icon name="settings" class="size-sm" />
					</button>
				)}
			</div>
			{shared && (
				<div class={styles.owner}>
					<Avatar name={project.ownerName} size="xs" decorative />
					<span class={styles.ownerName}>{project.ownerName}</span>
					<Badge class="size-sm">{ROLE_LABELS[project.grantedRole]}</Badge>
				</div>
			)}
			{shared && project.effectiveRole !== project.grantedRole && (
				<div>
					<Badge class="variant-info-subtle size-sm">View only until you connect GitHub</Badge>
				</div>
			)}
			{project.description && (
				<p class={styles.description}>
					{project.description}
				</p>
			)}
			{/* Sync status display */}
			{isSyncing && (
				<div class={styles.syncStatus}>
					<span class={styles.spinner} />
					<span>Syncing repository...</span>
				</div>
			)}
			{hasSyncError && (
				<div class={styles.syncError}>
					<div class={styles.syncErrorHeader}>
						<span class={styles.errorDot} />
						<span>Sync failed</span>
						{onRetrySync && (
							<button
								type="button"
								class={styles.retryButton}
								onClick={handleRetryClick}
								disabled={isRetrying}
							>
								{isRetrying ? 'Retrying...' : 'Retry'}
							</button>
						)}
					</div>
					{/* The raw error is about the owner's repository and GitHub connection; theirs to act on. */}
					{syncError && !shared && (
						<p class={styles.syncErrorMessage}>{syncError}</p>
					)}
				</div>
			)}
			{/* Only show epic stats when not showing sync error */}
			{!hasSyncError && (
				<div class={styles.stats}>
					{hasItems && itemCounts ? (
						<div class={styles.epicStats}>
							{itemCounts.ready > 0 && (
								<span class={styles.statItem}>
									<StatusGlyph status="ready" />
									<span class={styles.statCount}>{itemCounts.ready}</span>
								</span>
							)}
							{itemCounts.in_progress > 0 && (
								<span class={styles.statItem}>
									<StatusGlyph status="in_progress" />
									<span class={styles.statCount}>{itemCounts.in_progress}</span>
								</span>
							)}
							{itemCounts.in_review > 0 && (
								<span class={styles.statItem}>
									<StatusGlyph status="in_review" />
									<span class={styles.statCount}>{itemCounts.in_review}</span>
								</span>
							)}
							{itemCounts.done > 0 && (
								<span class={styles.statItem}>
									<StatusGlyph status="done" />
									<span class={styles.statCount}>{itemCounts.done}</span>
								</span>
							)}
						</div>
					) : (
						<span class={styles.noEpics}>No epics yet</span>
					)}
				</div>
			)}
			<div class={styles.footer}>
				<span class={styles.updatedAt}>
					Updated {formatRelativeTime(project.updatedAt)}
				</span>
			</div>
		</Card>
	);
}

function formatRelativeTime(dateStr: string): string {
	const date = new Date(dateStr);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();

	// Handle future dates or invalid dates
	if (diffMs < 0) return 'just now';

	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

	if (diffDays === 0) return 'today';
	if (diffDays === 1) return 'yesterday';
	if (diffDays < 7) return `${diffDays} days ago`;

	const diffWeeks = Math.floor(diffDays / 7);
	if (diffDays < 30) return `${diffWeeks} ${diffWeeks === 1 ? 'week' : 'weeks'} ago`;

	const diffMonths = Math.floor(diffDays / 30);
	if (diffDays < 365) return `${diffMonths} ${diffMonths === 1 ? 'month' : 'months'} ago`;

	const diffYears = Math.floor(diffDays / 365);
	return `${diffYears} ${diffYears === 1 ? 'year' : 'years'} ago`;
}
