import { useState, useEffect, useMemo } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon } from '@specboard/ui';
import {
	GitHubConnectionModel,
	GitHubReposCollection,
	GitHubBranchesCollection,
	useModel,
} from '@specboard/models';
import styles from './RepositoryPicker.module.css';

/** A GitHub repository and branch to attach, as project create and update take it. */
export interface RepositoryConfig {
	provider: 'github';
	owner: string;
	repo: string;
	branch: string;
	url: string;
}

export interface RepositoryPickerProps {
	/** Called with the chosen repository and branch, or null until both are picked. */
	onChange: (repository: RepositoryConfig | null) => void;
	disabled?: boolean;
}

/**
 * Pick one of the caller's GitHub repositories and a branch of it. Used by project
 * create and by the settings page's Repository section, for a project that has none.
 */
export function RepositoryPicker({ onChange, disabled = false }: RepositoryPickerProps): JSX.Element {
	const githubConnection = useMemo(() => new GitHubConnectionModel(), []);
	const githubRepos = useMemo(() => new GitHubReposCollection(), []);
	useModel(githubConnection);
	useModel(githubRepos);

	const [selectedRepo, setSelectedRepo] = useState('');
	const [selectedBranch, setSelectedBranch] = useState('');

	const branchesCollection = useMemo(() => {
		if (!selectedRepo) return null;
		const repo = githubRepos.find((r) => r.fullName === selectedRepo);
		return repo ? new GitHubBranchesCollection({ owner: repo.owner, repo: repo.name }) : null;
	}, [selectedRepo, githubRepos]);
	useModel(branchesCollection);

	const branchesWorking = branchesCollection?.$meta.working ?? false;
	const branchesLength = branchesCollection?.length ?? 0;

	// Select the repository's default branch once its branches load.
	useEffect(() => {
		if (!branchesCollection || branchesWorking || branchesLength === 0) return;
		if (selectedBranch && branchesCollection.find((b) => b.name === selectedBranch)) return;

		const repo = githubRepos.find((r) => r.fullName === selectedRepo);
		if (!repo) return;

		const defaultBranch = branchesCollection.find((b) => b.name === repo.defaultBranch);
		setSelectedBranch(defaultBranch?.name || branchesCollection[0]?.name || '');
	}, [branchesCollection, branchesWorking, branchesLength, selectedBranch, selectedRepo, githubRepos]);

	useEffect(() => {
		const repo = selectedRepo && selectedBranch ? githubRepos.find((r) => r.fullName === selectedRepo) : undefined;
		onChange(repo ? { provider: 'github', owner: repo.owner, repo: repo.name, branch: selectedBranch, url: repo.url } : null);
	}, [selectedRepo, selectedBranch, githubRepos, onChange]);

	function handleRefreshRepos(): void {
		setSelectedRepo('');
		setSelectedBranch('');
		void githubRepos.fetch();
	}

	function handleRefreshBranches(): void {
		setSelectedBranch('');
		void branchesCollection?.fetch();
	}

	if (githubConnection.$meta.working) {
		return <div class={styles.loadingText}>Checking GitHub connection...</div>;
	}

	if (!githubConnection.connected) {
		return (
			<div class={styles.notConnected}>
				<p>Connect your GitHub account in Settings to link repositories.</p>
				<a href="/settings" class={styles.settingsLink}>Go to Settings</a>
			</div>
		);
	}

	const reposLoading = githubRepos.$meta.working;
	const branchesLoading = branchesWorking;

	return (
		<div class={styles.picker}>
			<label class={styles.label}>
				<span class={styles.labelText}>Repository</span>
				<div class={styles.selectRow}>
					<select
						class={styles.select}
						value={selectedRepo}
						aria-label="Select GitHub repository"
						disabled={disabled || reposLoading}
						onChange={(e) => {
							setSelectedRepo((e.target as HTMLSelectElement).value);
							setSelectedBranch('');
						}}
					>
						{reposLoading ? (
							<option value="">Loading repositories...</option>
						) : githubRepos.length === 0 ? (
							<option value="">No repositories found</option>
						) : (
							<>
								<option value="">Select a repository...</option>
								{githubRepos.map((repo) => (
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
						disabled={disabled || reposLoading}
						aria-label="Refresh repositories"
						title="Refresh repositories"
					>
						<Icon name="rotate-ccw" class={`size-xs ${reposLoading ? styles.spinning : ''}`} />
					</button>
				</div>
			</label>

			<label class={styles.label}>
				<span class={styles.labelText}>Branch</span>
				<div class={styles.selectRow}>
					<select
						class={styles.select}
						value={selectedBranch}
						aria-label="Select branch"
						disabled={disabled || !selectedRepo || branchesLoading}
						onChange={(e) => setSelectedBranch((e.target as HTMLSelectElement).value)}
					>
						{!selectedRepo ? (
							<option value="">Select a repository first...</option>
						) : branchesLoading ? (
							<option value="">Loading branches...</option>
						) : !branchesCollection || branchesCollection.length === 0 ? (
							<option value="">No branches found</option>
						) : (
							branchesCollection.map((branch) => (
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
						disabled={disabled || !selectedRepo || branchesLoading}
						aria-label="Refresh branches"
						title="Refresh branches"
					>
						<Icon name="rotate-ccw" class={`size-xs ${branchesLoading ? styles.spinning : ''}`} />
					</button>
				</div>
			</label>
		</div>
	);
}
