import type { JSX } from 'preact';
import { Card, Text, StatusDot } from '@doc-platform/ui';
import styles from './ProjectCard.module.css';

export interface EpicCounts {
	ready: number;
	in_progress: number;
	in_review: number;
	done: number;
}

export interface Project {
	id: string;
	name: string;
	description?: string;
	epicCount: number;
	epicCounts?: EpicCounts;
	createdAt: string;
	updatedAt: string;
}

export interface ProjectCardProps {
	project: Project;
	onClick: (project: Project) => void;
	onEdit?: (project: Project) => void;
}

export function ProjectCard({ project, onClick, onEdit }: ProjectCardProps): JSX.Element {
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

	const { epicCounts } = project;
	const hasEpics = project.epicCount > 0;

	return (
		<Card
			class={styles.card}
			onClick={handleClick}
			onKeyDown={handleKeyDown}
			tabIndex={0}
			role="button"
		>
			<div class={styles.header}>
				<Text variant="heading" class={styles.name}>{project.name}</Text>
				{onEdit && (
					<button
						type="button"
						class={styles.editButton}
						onClick={handleEditClick}
						onKeyDown={handleEditKeyDown}
						aria-label="Edit project"
					>
						✎
					</button>
				)}
			</div>
			{project.description && (
				<Text variant="secondary" class={styles.description}>
					{project.description}
				</Text>
			)}
			<div class={styles.stats}>
				{hasEpics && epicCounts ? (
					<div class={styles.epicStats}>
						{epicCounts.ready > 0 && (
							<span class={styles.statItem}>
								<StatusDot status="ready" />
								<Text size="small">{epicCounts.ready}</Text>
							</span>
						)}
						{epicCounts.in_progress > 0 && (
							<span class={styles.statItem}>
								<StatusDot status="in_progress" />
								<Text size="small">{epicCounts.in_progress}</Text>
							</span>
						)}
						{epicCounts.in_review > 0 && (
							<span class={styles.statItem}>
								<StatusDot status="in_review" />
								<Text size="small">{epicCounts.in_review}</Text>
							</span>
						)}
						{epicCounts.done > 0 && (
							<span class={styles.statItem}>
								<StatusDot status="done" />
								<Text size="small">{epicCounts.done}</Text>
							</span>
						)}
					</div>
				) : (
					<Text variant="secondary" size="small">No epics yet</Text>
				)}
			</div>
			<div class={styles.footer}>
				<Text variant="secondary" size="small">
					Updated {formatRelativeTime(project.updatedAt)}
				</Text>
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
