import type { JSX } from 'preact';
import { Card, Text, Badge } from '@doc-platform/ui';
import styles from './ProjectCard.module.css';

export interface Project {
	id: string;
	name: string;
	description?: string;
	epicCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface ProjectCardProps {
	project: Project;
	onClick: (project: Project) => void;
}

export function ProjectCard({ project, onClick }: ProjectCardProps): JSX.Element {
	function handleClick(): void {
		onClick(project);
	}

	function handleKeyDown(event: KeyboardEvent): void {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onClick(project);
		}
	}

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
				<Badge variant="neutral">{project.epicCount} {project.epicCount === 1 ? 'epic' : 'epics'}</Badge>
			</div>
			{project.description && (
				<Text variant="secondary" class={styles.description}>
					{project.description}
				</Text>
			)}
			<div class={styles.footer}>
				<Text variant="secondary" size="small">
					Last updated {formatRelativeTime(project.updatedAt)}
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
