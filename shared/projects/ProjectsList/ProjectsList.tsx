import { useState, useEffect, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@doc-platform/router';
import { navigate } from '@doc-platform/router';
import { getCookie, setCookie } from '@doc-platform/core/cookies';
import { fetchClient } from '@doc-platform/fetch';
import { Button, Page } from '@doc-platform/ui';
import { ProjectCard, type Project } from '../ProjectCard/ProjectCard';
import { ProjectDialog } from '../ProjectDialog/ProjectDialog';
import styles from './ProjectsList.module.css';

export function ProjectsList(_props: RouteProps): JSX.Element {
	const [projects, setProjects] = useState<Project[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	// Dialog state: null = closed, undefined = create mode, Project = edit mode
	const [dialogProject, setDialogProject] = useState<Project | null | undefined>(null);

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
		setCookie('lastProjectId', project.id, 30);
		setCookie('lastProjectName', project.name, 30);
		navigate(`/projects/${project.id}/planning`);
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

	async function handleSaveProject(data: { name: string; description?: string }): Promise<void> {
		try {
			if (dialogProject === undefined) {
				// Create mode
				const project = await fetchClient.post<Project>('/api/projects', data);
				setProjects((prev) => [project, ...prev]);
				setDialogProject(null);
				// Navigate to the new project
				setCookie('lastProjectId', project.id, 30);
				setCookie('lastProjectName', project.name, 30);
				navigate(`/projects/${project.id}/planning`);
			} else if (dialogProject) {
				// Edit mode
				const updated = await fetchClient.put<Project>(`/api/projects/${dialogProject.id}`, data);
				setProjects((prev) =>
					prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p))
				);
				// Update cookie if this is the current project
				if (getCookie('lastProjectId') === updated.id) {
					setCookie('lastProjectName', updated.name, 30);
				}
				setDialogProject(null);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to save project');
		}
	}

	async function handleDeleteProject(): Promise<void> {
		if (!dialogProject) return;

		try {
			await fetchClient.delete(`/api/projects/${dialogProject.id}`);
			setProjects((prev) => prev.filter((p) => p.id !== dialogProject.id));
			setDialogProject(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to delete project');
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
		</Page>
	);
}
