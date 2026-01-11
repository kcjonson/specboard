import { useState, useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { Dialog, Button } from '@doc-platform/ui';
import { fetchClient } from '@doc-platform/fetch';
import type { Project } from '../ProjectCard/ProjectCard';
import styles from './ProjectDialog.module.css';

interface GitHubRepo {
	id: number;
	fullName: string;
	name: string;
	owner: string;
	private: boolean;
	defaultBranch: string;
	url: string;
}

interface GitHubBranch {
	name: string;
	protected: boolean;
}

interface RepositoryConfig {
	provider: 'github';
	owner: string;
	repo: string;
	branch: string;
	url: string;
}

export interface ProjectDialogProps {
	/** Project to edit (null for create mode) */
	project: Project | null;
	/** Called when dialog should close */
	onClose: () => void;
	/** Called when project is saved (created or updated) */
	onSave: (data: { name: string; description?: string; repository?: RepositoryConfig }) => Promise<void>;
	/** Called when project is deleted (only available in edit mode) */
	onDelete?: () => Promise<void>;
}

export function ProjectDialog({
	project,
	onClose,
	onSave,
	onDelete,
}: ProjectDialogProps): JSX.Element {
	const isEditMode = project !== null;
	const [name, setName] = useState(project?.name ?? '');
	const [description, setDescription] = useState(project?.description ?? '');
	const [saving, setSaving] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Track if component is mounted to prevent state updates after unmount
	const mountedRef = useRef(true);
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	// GitHub connection state
	const [githubConnected, setGithubConnected] = useState<boolean | null>(null);
	const [githubLoading, setGithubLoading] = useState(true);

	// Repository selection state
	const [repos, setRepos] = useState<GitHubRepo[]>([]);
	const [reposLoading, setReposLoading] = useState(false);
	const [selectedRepo, setSelectedRepo] = useState<string>('');
	const [branches, setBranches] = useState<GitHubBranch[]>([]);
	const [branchesLoading, setBranchesLoading] = useState(false);
	const [selectedBranch, setSelectedBranch] = useState<string>('');

	// Reset form when project changes
	useEffect(() => {
		setName(project?.name ?? '');
		setDescription(project?.description ?? '');
		setShowDeleteConfirm(false);
		setError(null);
		setSelectedRepo('');
		setSelectedBranch('');
		setBranches([]);
	}, [project]);

	// Check GitHub connection on mount
	useEffect(() => {
		async function checkGitHubConnection(): Promise<void> {
			setGithubLoading(true);
			try {
				const data = await fetchClient.get<{ connected: boolean }>('/api/github/connection');
				if (!mountedRef.current) return;
				setGithubConnected(data.connected);

				// If connected, load repos
				if (data.connected) {
					setReposLoading(true);
					try {
						const reposData = await fetchClient.get<GitHubRepo[]>('/api/github/repos');
						if (!mountedRef.current) return;
						setRepos(reposData);
					} catch {
						// Repos fetch failed - not critical
					} finally {
						if (mountedRef.current) setReposLoading(false);
					}
				}
			} catch {
				if (mountedRef.current) setGithubConnected(false);
			} finally {
				if (mountedRef.current) setGithubLoading(false);
			}
		}
		checkGitHubConnection();
	}, []);

	// Load branches when repo is selected
	useEffect(() => {
		if (!selectedRepo) {
			setBranches([]);
			setSelectedBranch('');
			return;
		}

		const repo = repos.find(r => r.fullName === selectedRepo);
		if (!repo) return;

		const { owner, name: repoName, defaultBranch: defaultBranchName } = repo;

		async function loadBranches(): Promise<void> {
			setBranchesLoading(true);
			try {
				const branchesData = await fetchClient.get<GitHubBranch[]>(
					`/api/github/repos/${owner}/${repoName}/branches`
				);
				if (!mountedRef.current) return;
				setBranches(branchesData);

				// Auto-select default branch
				if (branchesData.length > 0) {
					const defaultBranch = branchesData.find(b => b.name === defaultBranchName);
					setSelectedBranch(defaultBranch?.name || branchesData[0]!.name);
				}
			} catch {
				if (mountedRef.current) setBranches([]);
			} finally {
				if (mountedRef.current) setBranchesLoading(false);
			}
		}
		loadBranches();
	}, [selectedRepo, repos]);

	async function handleSubmit(e: Event): Promise<void> {
		e.preventDefault();
		if (!name.trim() || saving) return;

		try {
			setSaving(true);
			setError(null);

			const data: { name: string; description?: string; repository?: RepositoryConfig } = {
				name: name.trim(),
				description: description.trim() || undefined,
			};

			// Include repository config if selected
			if (selectedRepo && selectedBranch) {
				const repo = repos.find(r => r.fullName === selectedRepo);
				if (repo) {
					data.repository = {
						provider: 'github',
						owner: repo.owner,
						repo: repo.name,
						branch: selectedBranch,
						url: repo.url,
					};
				}
			}

			await onSave(data);
		} catch (err) {
			if (mountedRef.current) {
				setError(err instanceof Error ? err.message : 'Failed to save project');
			}
		} finally {
			if (mountedRef.current) setSaving(false);
		}
	}

	async function handleDelete(): Promise<void> {
		if (!onDelete || deleting) return;

		try {
			setDeleting(true);
			setError(null);
			await onDelete();
		} catch (err) {
			if (mountedRef.current) {
				setError(err instanceof Error ? err.message : 'Failed to delete project');
			}
		} finally {
			if (mountedRef.current) setDeleting(false);
		}
	}

	if (showDeleteConfirm) {
		return (
			<Dialog
				title="Delete Project"
				onClose={onClose}
				maxWidth="sm"
			>
				<div class={styles.deleteConfirm}>
					{error && (
						<p class={styles.error}>{error}</p>
					)}
					<p>
						Are you sure you want to delete "{project?.name}"? This will also delete all epics and tasks in this project.
					</p>
					<p class={styles.secondaryText}>This action cannot be undone.</p>
					<div class={styles.actions}>
						<Button
							class="text"
							onClick={() => setShowDeleteConfirm(false)}
							disabled={deleting}
						>
							Cancel
						</Button>
						<Button
							class="danger"
							onClick={handleDelete}
							disabled={deleting}
						>
							{deleting ? 'Deleting...' : 'Delete Project'}
						</Button>
					</div>
				</div>
			</Dialog>
		);
	}

	return (
		<Dialog
			title={isEditMode ? 'Edit Project' : 'Create Project'}
			onClose={onClose}
		>
			<form class={styles.form} onSubmit={handleSubmit}>
				{error && (
					<p class={styles.error}>{error}</p>
				)}
				<div class={styles.field}>
					<label class={styles.label}>
						<span class={styles.labelText}>Name</span>
						<input
							type="text"
							class={styles.input}
							value={name}
							onInput={(e) => setName((e.target as HTMLInputElement).value)}
							placeholder="My Project"
							autoFocus
						/>
					</label>
				</div>
				<div class={styles.field}>
					<label class={styles.label}>
						<span class={styles.labelText}>Description (optional)</span>
						<textarea
							class={styles.textarea}
							value={description}
							onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
							placeholder="A brief description of your project"
							rows={3}
						/>
					</label>
				</div>

				{/* Repository section - only for new projects or projects without repo */}
				{!isEditMode && (
					<div class={styles.repositorySection}>
						<div class={styles.sectionHeader}>
							<span class={styles.labelText}>Repository (optional)</span>
							<span class={styles.hint}>Connect a GitHub repository to store documents</span>
						</div>

						{githubLoading ? (
							<div class={styles.loadingText}>Checking GitHub connection...</div>
						) : !githubConnected ? (
							<div class={styles.notConnected}>
								<p>Connect your GitHub account in Settings to link repositories.</p>
								<a href="/settings" class={styles.settingsLink}>Go to Settings</a>
							</div>
						) : reposLoading ? (
							<div class={styles.loadingText}>Loading repositories...</div>
						) : repos.length === 0 ? (
							<div class={styles.noRepos}>No repositories found. Make sure you have access to at least one repository.</div>
						) : (
							<>
								<div class={styles.field}>
									<label class={styles.label}>
										<span class={styles.labelText}>Repository</span>
										<select
											class={styles.select}
											value={selectedRepo}
											onChange={(e) => setSelectedRepo((e.target as HTMLSelectElement).value)}
										>
											<option value="">Select a repository...</option>
											{repos.map(repo => (
												<option key={repo.id} value={repo.fullName}>
													{repo.fullName} {repo.private ? '(private)' : ''}
												</option>
											))}
										</select>
									</label>
								</div>

								{selectedRepo && (
									<div class={styles.field}>
										<label class={styles.label}>
											<span class={styles.labelText}>Branch</span>
											{branchesLoading ? (
												<div class={styles.loadingText}>Loading branches...</div>
											) : (
												<select
													class={styles.select}
													value={selectedBranch}
													onChange={(e) => setSelectedBranch((e.target as HTMLSelectElement).value)}
												>
													{branches.map(branch => (
														<option key={branch.name} value={branch.name}>
															{branch.name} {branch.protected ? '(protected)' : ''}
														</option>
													))}
												</select>
											)}
										</label>
									</div>
								)}
							</>
						)}
					</div>
				)}

				<div class={styles.footer}>
					{isEditMode && onDelete && (
						<Button
							type="button"
							class={`text ${styles.deleteButton}`}
							onClick={() => setShowDeleteConfirm(true)}
						>
							Delete
						</Button>
					)}
					<div class={styles.actions}>
						<Button type="button" class="text" onClick={onClose}>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={!name.trim() || saving}
						>
							{saving ? 'Saving...' : isEditMode ? 'Save' : 'Create'}
						</Button>
					</div>
				</div>
			</form>
		</Dialog>
	);
}
