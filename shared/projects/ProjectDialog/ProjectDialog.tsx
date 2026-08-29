import { useState, useEffect, useMemo, useRef, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import { Dialog, DialogFooter, Button, Icon } from '@specboard/ui';
import {
	GitHubConnectionModel,
	GitHubReposCollection,
	GitHubBranchesCollection,
	useModel,
} from '@specboard/models';
import { isValidProjectSlug, isValidProjectKey, MAX_PROJECT_SLUG_LENGTH } from '@specboard/core/identifiers';
import type { Project, RepositoryConfigCloud } from '../ProjectCard/ProjectCard';
import styles from './ProjectDialog.module.css';

function isCloudRepository(repo: unknown): repo is RepositoryConfigCloud {
	return typeof repo === 'object' && repo !== null && 'type' in repo && (repo as RepositoryConfigCloud).type === 'cloud';
}

export interface RepositoryConfig {
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
	onSave: (data: { name: string; description?: string; systemPrompt?: string; slug?: string; key?: string; repository?: RepositoryConfig }) => Promise<void>;
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
	const [systemPrompt, setSystemPrompt] = useState(project?.systemPrompt ?? '');
	// Only editable once the project exists: on create both are derived from the name.
	const [slug, setSlug] = useState(project?.slug ?? '');
	const [itemKey, setItemKey] = useState(project?.key ?? '');
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

	// GitHub models - only create for new projects
	const githubConnection = useMemo(
		() => (!isEditMode ? new GitHubConnectionModel() : null),
		[isEditMode]
	);
	const githubRepos = useMemo(
		() => (!isEditMode ? new GitHubReposCollection() : null),
		[isEditMode]
	);

	// Subscribe to models (conditional - only for create mode)
	useModel(githubConnection);
	useModel(githubRepos);

	// Repository selection state
	const [selectedRepo, setSelectedRepo] = useState<string>('');
	const [selectedBranch, setSelectedBranch] = useState<string>('');

	// Branches collection - created when repo is selected
	const branchesCollection = useMemo(() => {
		if (!selectedRepo || !githubRepos) return null;

		const repo = githubRepos.find(r => r.fullName === selectedRepo);
		if (!repo) return null;

		return new GitHubBranchesCollection({ owner: repo.owner, repo: repo.name });
	}, [selectedRepo, githubRepos]);

	useModel(branchesCollection);

	// Track branches loading state separately to avoid unstable dependency
	const branchesWorking = branchesCollection?.$meta.working ?? false;
	const branchesLength = branchesCollection?.length ?? 0;

	// Auto-select default branch when branches load
	useEffect(() => {
		if (!branchesCollection || branchesWorking || branchesLength === 0) {
			return;
		}

		// If a branch is already selected and exists in the collection, keep it
		if (selectedBranch && branchesCollection.find(b => b.name === selectedBranch)) {
			return;
		}

		const repo = githubRepos?.find(r => r.fullName === selectedRepo);
		if (!repo) return;

		const defaultBranch = branchesCollection.find(b => b.name === repo.defaultBranch);
		setSelectedBranch(defaultBranch?.name || branchesCollection[0]?.name || '');
	}, [branchesCollection, branchesWorking, branchesLength, selectedBranch, selectedRepo, githubRepos]);

	// Reset form when project changes
	useEffect(() => {
		setName(project?.name ?? '');
		setDescription(project?.description ?? '');
		setSystemPrompt(project?.systemPrompt ?? '');
		setSlug(project?.slug ?? '');
		setItemKey(project?.key ?? '');
		setShowDeleteConfirm(false);
		setError(null);
		setSelectedRepo('');
		setSelectedBranch('');
	}, [project]);

	// Identifiers are only editable in edit mode; on create the server derives them.
	const slugValid = !isEditMode || isValidProjectSlug(slug.trim());
	const keyValid = !isEditMode || isValidProjectKey(itemKey.trim());
	const canSubmit = Boolean(name.trim()) && slugValid && keyValid && !saving;

	async function handleSubmit(e: Event): Promise<void> {
		e.preventDefault();
		if (!canSubmit) return;

		try {
			setSaving(true);
			setError(null);

			const data: { name: string; description?: string; systemPrompt?: string; slug?: string; key?: string; repository?: RepositoryConfig } = {
				name: name.trim(),
				description: description.trim() || undefined,
				systemPrompt: systemPrompt.trim(),
				// Send identifiers only when the user actually changed one, so an untouched
				// dialog can never trip the "already in use" conflict on its own values.
				...(isEditMode && slug.trim() !== project?.slug ? { slug: slug.trim() } : {}),
				...(isEditMode && itemKey.trim() !== project?.key ? { key: itemKey.trim() } : {}),
			};

			// Include repository config if selected
			if (selectedRepo && selectedBranch && githubRepos) {
				const repo = githubRepos.find(r => r.fullName === selectedRepo);
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
					<DialogFooter>
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
					</DialogFooter>
				</div>
			</Dialog>
		);
	}

	// Derive loading states from models
	const githubLoading = githubConnection?.$meta.working ?? false;
	const githubConnected = githubConnection?.connected ?? false;
	const reposLoading = githubRepos?.$meta.working ?? false;
	const branchesLoading = branchesCollection?.$meta.working ?? false;

	const handleRefreshRepos = useCallback(() => {
		setSelectedRepo('');
		setSelectedBranch('');
		githubRepos?.fetch();
	}, [githubRepos]);

	const handleRefreshBranches = useCallback(() => {
		setSelectedBranch('');
		branchesCollection?.fetch();
	}, [branchesCollection]);

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

				{isEditMode && (
					<>
						<div class={styles.field}>
							<label class={styles.label}>
								<span class={styles.labelText}>URL slug</span>
								<span class={styles.hint}>Identifies this project in its address: /projects/{slug || '…'}/planning</span>
								<input
									type="text"
									class={styles.input}
									value={slug}
									onInput={(e) => setSlug((e.target as HTMLInputElement).value.toLowerCase())}
									placeholder="my-project"
									maxLength={MAX_PROJECT_SLUG_LENGTH}
								/>
								{!slugValid && (
									<span class={styles.error}>Lowercase letters, numbers, and single hyphens between them.</span>
								)}
							</label>
						</div>

						<div class={styles.field}>
							<label class={styles.label}>
								<span class={styles.labelText}>Item key prefix</span>
								<span class={styles.hint}>Prefixes this project's work items: {itemKey || '…'}-345</span>
								<input
									type="text"
									class={styles.input}
									value={itemKey}
									onInput={(e) => setItemKey((e.target as HTMLInputElement).value.toUpperCase())}
									placeholder="SB"
									maxLength={10}
								/>
								{!keyValid && (
									<span class={styles.error}>2–10 characters: a letter first, then letters or digits.</span>
								)}
							</label>
						</div>
					</>
				)}

				<div class={styles.field}>
					<label class={styles.label}>
						<span class={styles.labelText}>AI Instructions (optional)</span>
						<span class={styles.hint}>Custom instructions for the AI assistant when working in this project.</span>
						<textarea
							class={styles.textarea}
							value={systemPrompt}
							onInput={(e) => setSystemPrompt((e.target as HTMLTextAreaElement).value)}
							placeholder="e.g., Always respond in bullet points. Use formal tone."
							rows={4}
							maxLength={10000}
						/>
						<span class={styles.charCount}>{systemPrompt.length} / 10,000</span>
					</label>
				</div>

				{/* Repository info - read-only display for edit mode with existing repo */}
				{isEditMode && project?.repository && isCloudRepository(project.repository) && (
					<div class={styles.repositoryInfo}>
						<div class={styles.sectionHeader}>
							<span class={styles.labelText}>Repository</span>
						</div>
						<div class={styles.repoDisplay}>
							<Icon name="github" class="size-sm" />
							<a
								href={project.repository.remote.url}
								target="_blank"
								rel="noopener noreferrer"
								class={styles.repoLink}
							>
								{project.repository.remote.owner}/{project.repository.remote.repo}
							</a>
							<span class={styles.branchBadge}>
								<Icon name="git-branch" class="size-xs" />
								{project.repository.branch}
							</span>
						</div>
						{/* Sync status */}
						<div class={styles.syncStatusDisplay}>
							{project.syncStatus === 'pending' || project.syncStatus === 'syncing' ? (
								<>
									<span class={styles.spinner} />
									<span>Syncing...</span>
								</>
							) : project.syncStatus === 'completed' ? (
								<>
									<span class={styles.successDot} />
									<span>Synced</span>
								</>
							) : project.syncStatus === 'failed' ? (
								<>
									<span class={styles.errorDot} />
									<span class={styles.errorText}>Sync failed</span>
									{project.syncError && (
										<span class={styles.errorDetail}>{project.syncError}</span>
									)}
								</>
							) : null}
						</div>
					</div>
				)}

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
						) : (
							<>
								<div class={styles.field}>
									<label class={styles.label}>
										<span class={styles.labelText}>Repository</span>
										<div class={styles.selectRow}>
											<select
												class={styles.select}
												value={selectedRepo}
												aria-label="Select GitHub repository"
												disabled={reposLoading}
												onChange={(e) => {
													setSelectedRepo((e.target as HTMLSelectElement).value);
													setSelectedBranch('');
												}}
											>
												{reposLoading ? (
													<option value="">Loading repositories...</option>
												) : !githubRepos || githubRepos.length === 0 ? (
													<option value="">No repositories found</option>
												) : (
													<>
														<option value="">Select a repository...</option>
														{githubRepos.map(repo => (
															<option key={repo.id} value={repo.fullName}>
																{repo.fullName} {repo.private ? '(private)' : ''}
															</option>
														))}
													</>
												)}
											</select>
											<button
												type="button"
												class={styles.refreshButton}
												onClick={handleRefreshRepos}
												disabled={reposLoading}
												aria-label="Refresh repositories"
												title="Refresh repositories"
											>
												<Icon name="rotate-ccw" class={`size-xs ${reposLoading ? styles.spinning : ''}`} />
											</button>
										</div>
									</label>
								</div>

								<div class={styles.field}>
									<label class={styles.label}>
										<span class={styles.labelText}>Branch</span>
										<div class={styles.selectRow}>
											<select
												class={styles.select}
												value={selectedBranch}
												aria-label="Select branch"
												disabled={!selectedRepo || branchesLoading}
												onChange={(e) => setSelectedBranch((e.target as HTMLSelectElement).value)}
											>
												{!selectedRepo ? (
													<option value="">Select a repository first...</option>
												) : branchesLoading ? (
													<option value="">Loading branches...</option>
												) : !branchesCollection || branchesCollection.length === 0 ? (
													<option value="">No branches found</option>
												) : (
													branchesCollection.map(branch => (
														<option key={branch.name} value={branch.name}>
															{branch.name}
														</option>
													))
												)}
											</select>
											<button
												type="button"
												class={styles.refreshButton}
												onClick={handleRefreshBranches}
												disabled={!selectedRepo || branchesLoading}
												aria-label="Refresh branches"
												title="Refresh branches"
											>
												<Icon name="rotate-ccw" class={`size-xs ${branchesLoading ? styles.spinning : ''}`} />
											</button>
										</div>
									</label>
								</div>
							</>
						)}
					</div>
				)}

				<DialogFooter
					start={isEditMode && onDelete && (
						<Button
							type="button"
							class="text danger"
							onClick={() => setShowDeleteConfirm(true)}
						>
							Delete
						</Button>
					)}
				>
					<Button type="button" class="text" onClick={onClose}>
						Cancel
					</Button>
					<Button
						type="submit"
						disabled={!canSubmit}
					>
						{saving ? 'Saving...' : isEditMode ? 'Save' : 'Create'}
					</Button>
				</DialogFooter>
			</form>
		</Dialog>
	);
}
