import type { JSX } from 'preact';
import type { RouteProps } from '@doc-platform/router';
import { navigate } from '@doc-platform/router';
import { AppHeader } from '@doc-platform/ui';
import { useAuth } from '@shared/planning';
import { FileBrowser } from '../FileBrowser/FileBrowser';
import { CommentsPanel } from '../CommentsPanel/CommentsPanel';
import styles from './Editor.module.css';

export function Editor(_props: RouteProps): JSX.Element {
	const { user, loading: authLoading, logout } = useAuth();

	function handleSettingsClick(): void {
		navigate('/settings');
	}

	async function handleLogoutClick(): Promise<void> {
		await logout();
		navigate('/login');
	}

	if (authLoading) {
		return (
			<div class={styles.container}>
				<div class={styles.editorArea}>
					<div class={styles.placeholder}>Loading...</div>
				</div>
			</div>
		);
	}

	return (
		<div class={styles.container}>
			<AppHeader
				title="Pages"
				user={user ? { displayName: user.displayName, email: user.email } : undefined}
				onSettingsClick={handleSettingsClick}
				onLogoutClick={handleLogoutClick}
			/>
			<div class={styles.body}>
				<FileBrowser class={styles.sidebar} />
				<main class={styles.main}>
					<div class={styles.editorArea}>
						<div class={styles.placeholder}>
							Editor coming soon...
						</div>
					</div>
				</main>
				<CommentsPanel class={styles.commentsPanel} />
			</div>
		</div>
	);
}
