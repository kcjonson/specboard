import { useState, useEffect, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@doc-platform/router';
import { navigate } from '@doc-platform/router';
import { fetchClient } from '@doc-platform/fetch';
import { Button, Dialog, Text } from '@doc-platform/ui';
import { useAuth } from '@shared/planning';
import { ProjectCard, type Project } from '../ProjectCard/ProjectCard';
import styles from './ProjectsList.module.css';

// Cookie helpers
function setCookie(name: string, value: string, days: number): void {
	const expires = new Date();
	expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
	document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/;SameSite=Lax;Secure`;
}

export function ProjectsList(_props: RouteProps): JSX.Element {
	const { user, loading: authLoading, logout } = useAuth();
	const [projects, setProjects] = useState<Project[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const [newProjectName, setNewProjectName] = useState('');
	const [newProjectDescription, setNewProjectDescription] = useState('');
	const [creating, setCreating] = useState(false);

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
		if (!authLoading) {
			fetchProjects();
		}
	}, [authLoading, fetchProjects]);

	function handleProjectClick(project: Project): void {
		// Store last project in cookie
		setCookie('lastProjectId', project.id, 30);
		navigate(`/projects/${project.id}/planning`);
	}

	function handleOpenCreateDialog(): void {
		setNewProjectName('');
		setNewProjectDescription('');
		setIsCreateDialogOpen(true);
	}

	function handleCloseCreateDialog(): void {
		setIsCreateDialogOpen(false);
	}

	async function handleCreateProject(): Promise<void> {
		if (!newProjectName.trim()) return;

		try {
			setCreating(true);
			const project = await fetchClient.post<Project>('/api/projects', {
				name: newProjectName.trim(),
				description: newProjectDescription.trim() || undefined,
			});
			setProjects((prev) => [project, ...prev]);
			setIsCreateDialogOpen(false);
			// Navigate to the new project
			setCookie('lastProjectId', project.id, 30);
			navigate(`/projects/${project.id}/planning`);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to create project');
		} finally {
			setCreating(false);
		}
	}

	async function handleLogoutClick(): Promise<void> {
		await logout();
		window.location.href = '/login';
	}

	function handleSettingsClick(): void {
		navigate('/settings');
	}

	if (authLoading || loading) {
		return (
			<div class={styles.container}>
				<div class={styles.loading}>Loading...</div>
			</div>
		);
	}

	if (error) {
		return (
			<div class={styles.container}>
				<div class={styles.error}>
					<Text variant="heading">Error</Text>
					<Text>{error}</Text>
					<Button onClick={fetchProjects}>Retry</Button>
				</div>
			</div>
		);
	}

	return (
		<div class={styles.container}>
			<header class={styles.header}>
				<div class={styles.headerLeft}>
					<Text variant="heading" size="large">Projects</Text>
				</div>
				<div class={styles.headerRight}>
					{user && (
						<div class={styles.userMenu}>
							<Text variant="secondary">{user.displayName}</Text>
							<Button variant="ghost" size="small" onClick={handleSettingsClick}>
								Settings
							</Button>
							<Button variant="ghost" size="small" onClick={handleLogoutClick}>
								Log out
							</Button>
						</div>
					)}
				</div>
			</header>

			<main class={styles.main}>
				<div class={styles.toolbar}>
					<Button onClick={handleOpenCreateDialog}>+ New Project</Button>
				</div>

				{projects.length === 0 ? (
					<div class={styles.empty}>
						<Text variant="heading">No projects yet</Text>
						<Text variant="secondary">
							Create your first project to get started
						</Text>
						<Button onClick={handleOpenCreateDialog}>Create Project</Button>
					</div>
				) : (
					<div class={styles.grid}>
						{projects.map((project) => (
							<ProjectCard
								key={project.id}
								project={project}
								onClick={handleProjectClick}
							/>
						))}
					</div>
				)}
			</main>

			{isCreateDialogOpen && (
				<Dialog
					title="Create Project"
					onClose={handleCloseCreateDialog}
				>
					<div class={styles.form}>
						<div class={styles.field}>
							<label class={styles.label}>
								<Text>Name</Text>
								<input
									type="text"
									class={styles.input}
									value={newProjectName}
									onInput={(e) => setNewProjectName((e.target as HTMLInputElement).value)}
									placeholder="My Project"
									autoFocus
								/>
							</label>
						</div>
						<div class={styles.field}>
							<label class={styles.label}>
								<Text>Description (optional)</Text>
								<textarea
									class={styles.textarea}
									value={newProjectDescription}
									onInput={(e) => setNewProjectDescription((e.target as HTMLTextAreaElement).value)}
									placeholder="A brief description of your project"
									rows={3}
								/>
							</label>
						</div>
						<div class={styles.actions}>
							<Button variant="ghost" onClick={handleCloseCreateDialog}>
								Cancel
							</Button>
							<Button
								onClick={handleCreateProject}
								disabled={!newProjectName.trim() || creating}
							>
								{creating ? 'Creating...' : 'Create'}
							</Button>
						</div>
					</div>
				</Dialog>
			)}
		</div>
	);
}
