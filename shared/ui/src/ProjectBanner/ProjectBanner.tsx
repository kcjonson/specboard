import type { JSX } from 'preact';
import { connectGitHub, projectRoleState, useProject } from '@specboard/models';
import { projectBanner } from './project-banner';
import styles from './ProjectBanner.module.css';

export interface ProjectBannerProps {
	projectRef: string;
}

/** The project's read-only or push-access banner, when the caller has one. */
export function ProjectBanner({ projectRef }: ProjectBannerProps): JSX.Element | null {
	const project = useProject(projectRef);
	const content = projectBanner(projectRoleState(project).reason, {
		ownerName: project.ownerName,
		repository: project.repository,
		githubUsername: project.githubUsername,
	});
	if (!content) return null;

	// Back to exactly where they were once GitHub hands them back.
	const connect = (): void => connectGitHub(window.location.pathname + window.location.search);

	return (
		<div class={`${styles.banner} ${styles[content.variant]}`} role="status">
			<span class={styles.message}>{content.message}</span>
			{content.action === 'connect_github' && (
				<button type="button" class="size-sm" onClick={connect}>
					Connect GitHub
				</button>
			)}
		</div>
	);
}
