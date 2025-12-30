import { useMemo } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@doc-platform/router';
import { navigate } from '@doc-platform/router';
import { AppHeader, type NavTab } from '@doc-platform/ui';
import { DocumentModel } from '@doc-platform/models';
import { useAuth } from '@shared/planning';
import { FileBrowser } from '../FileBrowser/FileBrowser';
import { MarkdownEditor, mockDocument, mockComments } from '../MarkdownEditor';
import styles from './Editor.module.css';

// Format project ID as display name (capitalize first letter)
function formatProjectName(id: string): string {
	return id.charAt(0).toUpperCase() + id.slice(1);
}

export function Editor(props: RouteProps): JSX.Element {
	const projectId = props.params.projectId || 'demo';
	const projectName = formatProjectName(projectId);
	const { user, loading: authLoading } = useAuth();

	// Document model - source of truth for editor content
	// useMemo ensures the model persists across re-renders
	const documentModel = useMemo(() => new DocumentModel({
		title: 'Welcome',
		content: mockDocument,
		dirty: false,
	}), []);

	// Navigation tabs
	const navTabs: NavTab[] = useMemo(() => [
		{ id: 'planning', label: 'Planning', href: `/projects/${projectId}/planning` },
		{ id: 'pages', label: 'Pages', href: `/projects/${projectId}/pages` },
	], [projectId]);

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
				projectName={projectName}
				navTabs={navTabs}
				activeTab="pages"
				user={user ? { displayName: user.displayName, email: user.email, isAdmin: user.roles?.includes('admin') } : undefined}
			/>
			<div class={styles.body}>
				<FileBrowser class={styles.sidebar} />
				<main class={styles.main}>
					<div class={styles.editorArea}>
						<MarkdownEditor
							model={documentModel}
							comments={mockComments}
							placeholder="Start writing..."
						/>
					</div>
				</main>
			</div>
		</div>
	);
}
