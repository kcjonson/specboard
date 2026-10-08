import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@specboard/router';
import { formatProjectRef } from '@specboard/core/identifiers';
import { FetchError } from '@specboard/fetch';
import { projectRoleState, refreshProject, useProject } from '@specboard/models';
import { Button, NotFound, Page } from '@specboard/ui';
import { GeneralSection } from './GeneralSection';
import { AiSection } from './AiSection';
import { RepositorySection } from './RepositorySection';
import { MembersSection } from './MembersSection';
import { DangerZone } from './DangerZone';
import styles from './ProjectSettings.module.css';

type SectionId = 'general' | 'ai' | 'repository' | 'members' | 'danger';

const SECTIONS: { id: SectionId; label: string }[] = [
	{ id: 'general', label: 'General' },
	{ id: 'ai', label: 'AI' },
	{ id: 'repository', label: 'Repository' },
	{ id: 'members', label: 'Members' },
	{ id: 'danger', label: 'Danger zone' },
];

/** Everyone else on the project sees only the member list (docs/specs/multi-user-collaboration.md). */
const MEMBER_SECTIONS: SectionId[] = ['members'];

function sectionFromHash(): SectionId | null {
	const id = window.location.hash.slice(1);
	return SECTIONS.some((section) => section.id === id) ? (id as SectionId) : null;
}

/**
 * /projects/:owner/:project/settings. One section at a time, chosen from the side nav and
 * kept in the URL hash so a link can open a section. The owner gets every section; members
 * get Members, read-only, with Leave project.
 */
export function ProjectSettings({ params }: RouteProps): JSX.Element {
	const projectRef = formatProjectRef(params.owner!, params.project!);
	const project = useProject(projectRef);
	const { role, isOwner } = projectRoleState(project);
	const [chosen, setChosen] = useState<SectionId | null>(sectionFromHash);

	if (!role) {
		const error = project.$meta.error;
		if (error && !project.$meta.working) {
			if (error instanceof FetchError && error.status === 404) return <NotFound />;
			return (
				<Page projectRef={projectRef} activeTab="Settings">
					<div class={styles.state} role="alert">
						<p>Couldn't load the project settings.</p>
						<Button class="secondary" onClick={() => refreshProject(projectRef)}>Retry</Button>
					</div>
				</Page>
			);
		}
		return (
			<Page projectRef={projectRef} activeTab="Settings">
				<div class={styles.state}>Loading...</div>
			</Page>
		);
	}

	const available = isOwner ? SECTIONS.map((section) => section.id) : MEMBER_SECTIONS;
	const current = chosen && available.includes(chosen) ? chosen : available[0]!;
	const repositoryName = project.repository?.type === 'cloud' && project.repository.remote
		? `${project.repository.remote.owner}/${project.repository.remote.repo}`
		: null;

	function choose(id: SectionId): void {
		setChosen(id);
		window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${id}`);
	}

	return (
		<Page projectRef={projectRef} activeTab="Settings">
			<div class={styles.layout}>
				<nav class={styles.nav} aria-label="Settings sections">
					{SECTIONS.filter((section) => available.includes(section.id)).map((section) => (
						<button
							key={section.id}
							type="button"
							class={`${styles.navItem} ${section.id === current ? styles.navItemActive : ''}`}
							aria-current={section.id === current ? 'page' : undefined}
							onClick={() => choose(section.id)}
						>
							{section.label}
						</button>
					))}
				</nav>
				<section class={styles.panel} aria-labelledby="settings-section-title">
					<h2 id="settings-section-title" class={styles.panelTitle}>
						{SECTIONS.find((section) => section.id === current)!.label}
					</h2>
					{/* Keyed by project, so opening another project's settings starts its forms over. */}
					{current === 'general' && <GeneralSection key={project.id} project={project} projectRef={projectRef} />}
					{current === 'ai' && <AiSection key={project.id} project={project} projectRef={projectRef} />}
					{current === 'repository' && <RepositorySection project={project} projectRef={projectRef} />}
					{current === 'members' && (
						<MembersSection projectRef={projectRef} projectName={project.name} isOwner={isOwner} repositoryName={repositoryName} />
					)}
					{current === 'danger' && <DangerZone projectRef={projectRef} projectName={project.name} />}
				</section>
			</div>
		</Page>
	);
}
