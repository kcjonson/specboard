import { useState, useEffect, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@specboard/router';
import { navigate } from '@specboard/router';
import { setCookie } from '@specboard/core/cookies';
import { formatProjectRef } from '@specboard/core/identifiers';
import { fetchClient, fetchErrorText, FetchError } from '@specboard/fetch';
import { Button, Notice, Page } from '@specboard/ui';
import { MIN_PROJECTS } from '@shared/planning';
import { ProjectCard, isCloudRepository, type Project } from '../ProjectCard/ProjectCard';
import { ProjectDialog, type NewProject } from '../ProjectDialog/ProjectDialog';
import { InvitationCard, type Invitation } from '../InvitationCard/InvitationCard';
import { PickerBar } from '../ProjectPicker/PickerBar';
import { useProjectPicker } from '../ProjectPicker/useProjectPicker';
import { SyncProgressDialog } from '../SyncProgressDialog/SyncProgressDialog';
import styles from './ProjectsList.module.css';

function toProjectRef(project: Project): string {
	return formatProjectRef(project.ownerSlug, project.slug);
}

function rememberProject(projectRef: string, name: string): void {
	setCookie('lastProjectRef', projectRef, 30);
	setCookie('lastProjectName', name, 30);
}

export function ProjectsList(_props: RouteProps): JSX.Element {
	const [projects, setProjects] = useState<Project[]>([]);
	const [invitations, setInvitations] = useState<Invitation[]>([]);
	// Shown over the invitation cards: a failed list read, or an invite that closed under one.
	const [invitationNotice, setInvitationNotice] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	// Shown after creating a project with a repository, then the project opens.
	const [syncingProject, setSyncingProject] = useState<{ projectRef: string; name: string } | null>(null);
	// "View together": while it picks, a card click toggles the card instead of opening it.
	const picker = useProjectPicker(projects);

	const fetchProjects = useCallback(async (): Promise<void> => {
		try {
			setLoading(true);
			const data = await fetchClient.get<Project[]>('/api/projects');
			setProjects(data);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to fetch projects');
		} finally {
			setLoading(false);
		}
	}, []);

	// The invitations are their own read, so a failure there never hides the projects.
	const fetchInvitations = useCallback(async (): Promise<void> => {
		try {
			setInvitations(await fetchClient.get<Invitation[]>('/api/invitations'));
		} catch (err) {
			setInvitationNotice(fetchErrorText(err, 'Couldn\'t load your invitations.'));
		}
	}, []);

	useEffect(() => {
		void fetchProjects();
		void fetchInvitations();
	}, [fetchProjects, fetchInvitations]);

	function handleProjectClick(project: Project): void {
		const projectRef = toProjectRef(project);
		rememberProject(projectRef, project.name);
		navigate(`/projects/${projectRef}/planning`);
	}

	function handleOpenSettings(project: Project): void {
		navigate(`/projects/${toProjectRef(project)}/settings`);
	}

	async function handleCreateProject(data: NewProject): Promise<void> {
		try {
			const project = await fetchClient.post<Project>('/api/projects', {
				name: data.name,
				description: data.description,
				system_prompt: data.systemPrompt,
				repository: data.repository,
			});
			setCreating(false);

			if (isCloudRepository(project.repository)) {
				setSyncingProject({ projectRef: toProjectRef(project), name: project.name });
			} else {
				handleProjectClick(project);
			}
		} catch (err) {
			// Rethrow so the dialog shows the failure inline and keeps the user's input.
			throw new Error(fetchErrorText(err, 'Failed to create project'), { cause: err });
		}
	}

	function handleSyncNavigate(destination: 'planning' | 'pages'): void {
		if (!syncingProject) return;
		rememberProject(syncingProject.projectRef, syncingProject.name);
		setSyncingProject(null);
		navigate(`/projects/${syncingProject.projectRef}/${destination}`);
	}

	function handleSyncDismiss(): void {
		handleSyncNavigate('planning');
	}

	async function handleRetrySync(project: Project): Promise<void> {
		try {
			setProjects((prev) =>
				prev.map((p) => (p.id === project.id ? { ...p, syncStatus: 'pending' as const, syncError: null } : p))
			);
			await fetchClient.post(`/api/projects/${toProjectRef(project)}/sync/initial`);
			await fetchProjects();
		} catch (err) {
			setError(fetchErrorText(err, 'Failed to retry sync'));
			await fetchProjects();
		}
	}

	/**
	 * Answer an invitation. One that closed since the list loaded (revoked, expired, or
	 * answered elsewhere: 410) or is gone with its project (404) gets a notice and a fresh
	 * list, which carries any invitation that replaced it; other failures stay on the card.
	 */
	async function answerInvitation(invitation: Invitation, action: 'accept' | 'decline'): Promise<void> {
		setInvitationNotice(null);
		try {
			const result = await fetchClient.post<{ project: { ref: string; name: string } }>(
				`/api/invitations/${invitation.id}/${action}`
			);
			if (action === 'accept') {
				rememberProject(result.project.ref, result.project.name);
				navigate(`/projects/${result.project.ref}/planning`);
				return;
			}
			setInvitations((prev) => prev.filter((i) => i.id !== invitation.id));
		} catch (err) {
			const fallback = action === 'accept' ? 'Couldn\'t accept the invitation.' : 'Couldn\'t decline the invitation.';
			if (err instanceof FetchError && (err.status === 410 || err.status === 404)) {
				setInvitationNotice(err.status === 410 ? fetchErrorText(err, 'That invitation is no longer open.') : 'That invitation is no longer open.');
				await fetchInvitations();
				return;
			}
			throw new Error(fetchErrorText(err, fallback), { cause: err });
		}
	}

	if (loading) {
		return (
			<Page title="Projects">
				<div class={styles.loading}>Loading...</div>
			</Page>
		);
	}

	if (error) {
		return (
			<Page title="Projects">
				<div class={styles.error}>
					<h2>Error</h2>
					<p>{error}</p>
					<Button onClick={fetchProjects}>Retry</Button>
				</div>
			</Page>
		);
	}

	const owned = projects.filter((p) => p.grantedRole === 'owner');
	const shared = projects.filter((p) => p.grantedRole !== 'owner');
	const nothingHere = projects.length === 0 && invitations.length === 0;

	return (
		<Page title="Projects">
			<main class={styles.main}>
				{picker.active ? (
					<PickerBar picker={picker} />
				) : (
					<div class={styles.toolbar}>
						{projects.length >= MIN_PROJECTS && (
							<button type="button" class="secondary" ref={picker.triggerRef} onClick={picker.start}>
								View together
							</button>
						)}
						<Button onClick={() => setCreating(true)}>+ New Project</Button>
					</div>
				)}

				{(invitations.length > 0 || invitationNotice) && (
					<section class={styles.section} aria-labelledby="projects-invitations">
						<h2 id="projects-invitations" class={styles.sectionTitle}>Invitations</h2>
						{invitationNotice && <Notice variant="warning" announce>{invitationNotice}</Notice>}
						<div class={styles.grid}>
							{invitations.map((invitation) => (
								<InvitationCard
									key={invitation.id}
									invitation={invitation}
									onAccept={(i) => answerInvitation(i, 'accept')}
									onDecline={(i) => answerInvitation(i, 'decline')}
								/>
							))}
						</div>
					</section>
				)}

				{nothingHere ? (
					<div class={styles.empty}>
						<h2>No projects yet</h2>
						<p class={styles.secondaryText}>
							Create your first project to get started
						</p>
						<Button onClick={() => setCreating(true)}>Create Project</Button>
					</div>
				) : (
					<>
						<section class={styles.section} aria-labelledby="projects-yours">
							<h2 id="projects-yours" class={styles.sectionTitle}>Your projects</h2>
							{owned.length === 0 ? (
								<p class={styles.secondaryText}>You don't own any projects yet.</p>
							) : (
								<div class={styles.grid}>
									{owned.map((project) => (
										<ProjectCard
											key={project.id}
											project={project}
											onClick={picker.active ? picker.toggle : handleProjectClick}
											onOpenSettings={picker.active ? undefined : handleOpenSettings}
											onRetrySync={picker.active ? undefined : handleRetrySync}
											selected={picker.active ? picker.isChosen(project) : undefined}
										/>
									))}
								</div>
							)}
						</section>

						{shared.length > 0 && (
							<section class={styles.section} aria-labelledby="projects-shared">
								<h2 id="projects-shared" class={styles.sectionTitle}>Shared with you</h2>
								<div class={styles.grid}>
									{shared.map((project) => (
										<ProjectCard
											key={project.id}
											project={project}
											onClick={picker.active ? picker.toggle : handleProjectClick}
											selected={picker.active ? picker.isChosen(project) : undefined}
										/>
									))}
								</div>
							</section>
						)}
					</>
				)}
			</main>

			{creating && <ProjectDialog onClose={() => setCreating(false)} onCreate={handleCreateProject} />}

			{syncingProject && (
				<SyncProgressDialog
					projectRef={syncingProject.projectRef}
					projectName={syncingProject.name}
					onNavigate={handleSyncNavigate}
					onDismiss={handleSyncDismiss}
				/>
			)}
		</Page>
	);
}
