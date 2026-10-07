import { useMemo } from 'preact/hooks';
import type { JSX } from 'preact';
import { connectGitHub, GitHubConnectionModel, projectRoleState, useModel, useProject, type ProjectModel } from '@specboard/models';
import { projectBanner, type ProjectBannerContent } from './project-banner';
import styles from './ProjectBanner.module.css';

export interface ProjectBannerProps {
	projectRef: string;
}

function BannerLine({ content }: { content: ProjectBannerContent }): JSX.Element {
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

/** Only mounted for the push-access warning, the one message that names the GitHub account. */
function PushAccessBanner({ project }: { project: ProjectModel }): JSX.Element | null {
	const connection = useMemo(() => new GitHubConnectionModel(), []);
	useModel(connection);
	const content = projectBanner('no_push_access', {
		repository: project.repository,
		githubUsername: connection.username,
	});
	return content && <BannerLine content={content} />;
}

/** The project's read-only or push-access banner, when the caller has one. */
export function ProjectBanner({ projectRef }: ProjectBannerProps): JSX.Element | null {
	const project = useProject(projectRef);
	const { reason } = projectRoleState(project);
	if (reason === 'no_push_access') return <PushAccessBanner project={project} />;
	const content = projectBanner(reason, { ownerName: project.ownerName });
	return content && <BannerLine content={content} />;
}
