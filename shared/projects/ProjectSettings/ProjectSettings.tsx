import { useEffect, useRef, useState } from 'preact/hooks';
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
 * /projects/:owner/:project/settings. One section at a time, chosen from the side nav's
 * links to `#general`, `#members` and so on, so a section can be linked to. The owner gets
 * every section; members get Members, read-only, with Leave project.
 */
export function ProjectSettings({ params }: RouteProps): JSX.Element {
	const projectRef = formatProjectRef(params.owner!, params.project!);
	const project = useProject(projectRef);
	const { role, isOwner } = projectRoleState(project);
	const [chosen, setChosen] = useState<SectionId | null>(sectionFromHash);

	useEffect(() => {
		const follow = (): void => setChosen(sectionFromHash());
		window.addEventListener('hashchange', follow);
		return () => window.removeEventListener('hashchange', follow);
	}, []);

	// The forms start from the project's values, so they wait for a read made since the page
	// opened: a model cached from earlier in the session can be stale (another tab renamed the
	// project, or the role changed). A read already in flight counts.
	const openedAt = useRef(Date.now());
	useEffect(() => {
		refreshProject(projectRef);
	}, [projectRef]);
	const settled = (project.$meta.lastFetched ?? 0) >= openedAt.current;

	if (!role || !settled) {
		const error = project.$meta.error;
		if (error && !project.$meta.working && !role) {
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
	const title = SECTIONS.find((section) => section.id === current)!.label;

	return (
		<Page projectRef={projectRef} activeTab="Settings">
			<div class={`${styles.layout} ${available.length === 1 ? styles.single : ''}`}>
				{/* One section (a member's view) needs no way to choose it. */}
				{available.length > 1 && (
					<nav class={styles.nav} aria-label="Settings sections">
						{SECTIONS.filter((section) => available.includes(section.id)).map((section) => (
							<a
								key={section.id}
								href={`#${section.id}`}
								class={`${styles.navItem} ${section.id === current ? styles.navItemActive : ''}`}
								aria-current={section.id === current ? 'page' : undefined}
							>
								{section.label}
							</a>
						))}
					</nav>
				)}
				<section class={styles.panel} aria-labelledby="settings-section-title">
					{/* Keyed by project, so opening another project's settings starts its forms over. */}
					{current === 'general' && <GeneralSection key={project.id} title={title} project={project} projectRef={projectRef} />}
					{current === 'ai' && <AiSection key={project.id} title={title} project={project} projectRef={projectRef} />}
					{current === 'repository' && <RepositorySection title={title} project={project} projectRef={projectRef} />}
					{current === 'members' && (
						<MembersSection
							title={title}
							projectRef={projectRef}
							projectName={project.name}
							isOwner={isOwner}
							repositoryName={repositoryName}
						/>
					)}
					{current === 'danger' && <DangerZone title={title} projectRef={projectRef} projectName={project.name} />}
				</section>
			</div>
		</Page>
	);
}
