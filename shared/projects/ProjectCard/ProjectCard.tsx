import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Card, StatusDot, Icon } from '@specboard/ui';
import styles from './ProjectCard.module.css';

export type SyncStatus = 'pending' | 'syncing' | 'completed' | 'failed';

export interface EpicCounts {
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

export interface Project {
	id: string;
	name: string;
	description?: string;
	epicCount: number;
	epicCounts?: EpicCounts;
	repository?: RepositoryConfigCloud | Record<string, never>;
	syncStatus?: SyncStatus | null;
	syncError?: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface ProjectCardProps {
	project: Project;
	onClick: (project: Project) => void;
	onEdit?: (project: Project) => void;
	onRetrySync?: (project: Project) => Promise<void>;
}

export function ProjectCard({ project, onClick, onEdit, onRetrySync }: ProjectCardProps): JSX.Element {
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

	function handleEditClick(event: MouseEvent): void {
		event.stopPropagation();
		onEdit?.(project);
	}

	function handleEditKeyDown(event: KeyboardEvent): void {
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

	const { epicCounts, syncStatus, syncError } = project;
	const hasEpics = project.epicCount > 0;
	const isSyncing = syncStatus === 'pending' || syncStatus === 'syncing';
	const hasSyncError = syncStatus === 'failed';

	return (
		<Card
			class={styles.card}
			onClick={handleClick}
			onKeyDown={handleKeyDown}
			tabIndex={0}
			role="button"
		>
			<div class={styles.header}>
				<h3 class={styles.name}>{project.name}</h3>
				{onEdit && (
					<button
						type="button"
						class={styles.editButton}
						onClick={handleEditClick}
						onKeyDown={handleEditKeyDown}
						aria-label="Edit project"
					>
						<Icon name="pencil" class="size-sm" />
					</button>
				)}
			</div>
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
					{syncError && (
						<p class={styles.syncErrorMessage}>{syncError}</p>
					)}
				</div>
			)}
			{/* Only show epic stats when not showing sync error */}
			{!hasSyncError && (
				<div class={styles.stats}>
					{hasEpics && epicCounts ? (
						<div class={styles.epicStats}>
							{epicCounts.ready > 0 && (
								<span class={styles.statItem}>
									<StatusDot status="ready" />
									<span class={styles.statCount}>{epicCounts.ready}</span>
								</span>
							)}
							{epicCounts.in_progress > 0 && (
								<span class={styles.statItem}>
									<StatusDot status="in_progress" />
									<span class={styles.statCount}>{epicCounts.in_progress}</span>
								</span>
							)}
							{epicCounts.in_review > 0 && (
								<span class={styles.statItem}>
									<StatusDot status="in_review" />
									<span class={styles.statCount}>{epicCounts.in_review}</span>
								</span>
							)}
							{epicCounts.done > 0 && (
								<span class={styles.statItem}>
									<StatusDot status="done" />
									<span class={styles.statCount}>{epicCounts.done}</span>
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
