import { useState, useEffect, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@specboard/router';
import { navigate } from '@specboard/router';
import { getCookie, setCookie } from '@specboard/core/cookies';
import { fetchClient, FetchError } from '@specboard/fetch';
import { Button, Page } from '@specboard/ui';
import { ProjectCard, type Project } from '../ProjectCard/ProjectCard';
import { ProjectDialog, type RepositoryConfig } from '../ProjectDialog/ProjectDialog';
import { SyncProgressDialog } from '../SyncProgressDialog/SyncProgressDialog';
import styles from './ProjectsList.module.css';

/** The API's own error text when it sent one, so 409s name the field that collided. */
function apiErrorMessage(err: unknown, fallback: string): string {
	if (err instanceof FetchError && typeof (err.data as { error?: unknown })?.error === 'string') {
		return (err.data as { error: string }).error;
	}
	return err instanceof Error ? err.message : fallback;
}

export function ProjectsList(_props: RouteProps): JSX.Element {
	const [projects, setProjects] = useState<Project[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	// Dialog state: null = closed, undefined = create mode, Project = edit mode
	const [dialogProject, setDialogProject] = useState<Project | null | undefined>(null);
	// Sync progress dialog state: shown after creating a project with a repo
	const [syncingProject, setSyncingProject] = useState<{ slug: string; name: string } | null>(null);

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

	useEffect(() => {
		fetchProjects();
	}, [fetchProjects]);

	function handleProjectClick(project: Project): void {
		// Store last project in cookie
		setCookie('lastProjectSlug', project.slug, 30);
		setCookie('lastProjectName', project.name, 30);
		navigate(`/projects/${project.slug}/planning`);
	}

	function handleOpenCreateDialog(): void {
		setDialogProject(undefined); // undefined = create mode
	}

	function handleEditProject(project: Project): void {
		setDialogProject(project);
	}

	function handleCloseDialog(): void {
		setDialogProject(null);
	}

	async function handleSaveProject(data: { name: string; description?: string; systemPrompt?: string; slug?: string; key?: string; repository?: RepositoryConfig }): Promise<void> {
		try {
			// Map systemPrompt to system_prompt for API. slug/key are only present when the
			// user changed them; on create the server derives both from the name.
			const apiData = {
				name: data.name,
				description: data.description,
				system_prompt: data.systemPrompt,
				...(data.slug !== undefined ? { slug: data.slug } : {}),
				...(data.key !== undefined ? { key: data.key } : {}),
				repository: data.repository,
			};

			if (dialogProject === undefined) {
				// Create mode
				const project = await fetchClient.post<Project>('/api/projects', apiData);
				// API create response doesn't include stats — initialize them
				const projectWithStats = { ...project, itemCount: project.itemCount ?? 0, itemCounts: project.itemCounts ?? { ready: 0, in_progress: 0, in_review: 0, done: 0 } };
				setProjects((prev) => [projectWithStats, ...prev]);
				setDialogProject(null);

				if (project.repository && 'type' in project.repository && project.repository.type === 'cloud') {
					// Repository configured — show sync progress dialog
					setSyncingProject({ slug: project.slug, name: project.name });
				} else {
					// No repository — navigate immediately
					setCookie('lastProjectSlug', project.slug, 30);
					setCookie('lastProjectName', project.name, 30);
					navigate(`/projects/${project.slug}/planning`);
				}
			} else if (dialogProject) {
				// Edit mode
				const updated = await fetchClient.put<Project>(`/api/projects/${dialogProject.slug}`, apiData);
				setProjects((prev) =>
					prev.map((p) => (p.id === updated.id ? { ...updated } : p))
				);
				// Refresh the cookies if this is the current project. Compare against the
				// slug we edited, not the returned one — the slug is user-editable now, so
				// a rename would otherwise never match and leave the cookie pointing at a
				// slug that no longer resolves.
				if (getCookie('lastProjectSlug') === dialogProject.slug) {
					setCookie('lastProjectSlug', updated.slug, 30);
					setCookie('lastProjectName', updated.name, 30);
				}
				setDialogProject(null);
			}
		} catch (err) {
			// Rethrow so the dialog renders the failure inline and keeps the user's edits.
			// Setting the page-level error here would swap the whole list (and the dialog
			// with it) for a full-screen retry panel — a taken slug would discard the form.
			// A taken slug or key comes back as a 409 whose body says which one; FetchError's
			// own message is just "HTTP 409: Conflict", so prefer the server's wording.
			throw new Error(apiErrorMessage(err, 'Failed to save project'));
		}
	}

	async function handleDeleteProject(): Promise<void> {
		if (!dialogProject) return;

		try {
			await fetchClient.delete(`/api/projects/${dialogProject.slug}`);
			setProjects((prev) => prev.filter((p) => p.id !== dialogProject.id));
			setDialogProject(null);
		} catch (err) {
			// Rethrow for the same reason handleSaveProject does: the page-level error
			// swaps the list — and the open confirm dialog with it — for a retry panel.
			throw new Error(apiErrorMessage(err, 'Failed to delete project'));
		}
	}

	function handleSyncNavigate(destination: 'planning' | 'pages'): void {
		if (!syncingProject) return;
		setCookie('lastProjectSlug', syncingProject.slug, 30);
		setCookie('lastProjectName', syncingProject.name, 30);
		setSyncingProject(null);
		navigate(`/projects/${syncingProject.slug}/${destination}`);
	}

	function handleSyncDismiss(): void {
		if (!syncingProject) return;
		setCookie('lastProjectSlug', syncingProject.slug, 30);
		setCookie('lastProjectName', syncingProject.name, 30);
		setSyncingProject(null);
		navigate(`/projects/${syncingProject.slug}/planning`);
	}

	async function handleRetrySync(project: Project): Promise<void> {
		try {
			// Update local state to show pending
			setProjects((prev) =>
				prev.map((p) => (p.id === project.id ? { ...p, syncStatus: 'pending' as const, syncError: null } : p))
			);
			await fetchClient.post(`/api/projects/${project.slug}/sync/initial`);
			// Refetch projects to get updated sync status
			await fetchProjects();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to retry sync');
			// Refetch to get accurate state
			await fetchProjects();
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

	return (
		<Page title="Projects">
			<main class={styles.main}>
				<div class={styles.toolbar}>
					<Button onClick={handleOpenCreateDialog}>+ New Project</Button>
				</div>

				{projects.length === 0 ? (
					<div class={styles.empty}>
						<h2>No projects yet</h2>
						<p class={styles.secondaryText}>
							Create your first project to get started
						</p>
						<Button onClick={handleOpenCreateDialog}>Create Project</Button>
					</div>
				) : (
					<div class={styles.grid}>
						{projects.map((project) => (
							<ProjectCard
								key={project.id}
								project={project}
								onClick={handleProjectClick}
								onEdit={handleEditProject}
								onRetrySync={handleRetrySync}
							/>
						))}
					</div>
				)}
			</main>

			{/* dialogProject: null=closed, undefined=create mode, Project=edit mode */}
			{dialogProject !== null && (
				<ProjectDialog
					project={dialogProject === undefined ? null : dialogProject}
					onClose={handleCloseDialog}
					onSave={handleSaveProject}
					onDelete={dialogProject ? handleDeleteProject : undefined}
				/>
			)}

			{syncingProject && (
				<SyncProgressDialog
					projectSlug={syncingProject.slug}
					projectName={syncingProject.name}
					onNavigate={handleSyncNavigate}
					onDismiss={handleSyncDismiss}
				/>
			)}
		</Page>
	);
}
