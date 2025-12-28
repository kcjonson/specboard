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

	return (
		<Card
			class={styles.card}
			onClick={handleClick}
			tabIndex={0}
			role="button"
		>
			<div class={styles.header}>
				<Text variant="heading" class={styles.name}>{project.name}</Text>
				<Badge variant="neutral">{project.epicCount} epics</Badge>
			</div>
			{project.description && (
				<Text variant="secondary" class={styles.description}>
					{project.description}
				</Text>
			)}
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
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

	if (diffDays === 0) return 'today';
	if (diffDays === 1) return 'yesterday';
	if (diffDays < 7) return `${diffDays} days ago`;
	if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
	if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
	return `${Math.floor(diffDays / 365)} years ago`;
}
