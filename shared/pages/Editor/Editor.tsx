import { useMemo } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@doc-platform/router';
import { Page } from '@doc-platform/ui';
import { DocumentModel } from '@doc-platform/models';
import { FileBrowser } from '../FileBrowser/FileBrowser';
import { MarkdownEditor, mockDocument, mockComments } from '../MarkdownEditor';
import styles from './Editor.module.css';

export function Editor(props: RouteProps): JSX.Element {
	const projectId = props.params.projectId || 'demo';

	// Document model - source of truth for editor content
	// useMemo ensures the model persists across re-renders
	const documentModel = useMemo(() => new DocumentModel({
		title: 'Welcome',
		content: mockDocument,
		dirty: false,
	}), []);

	return (
		<Page projectId={projectId} activeTab="Pages">
			<div class={styles.body}>
				<FileBrowser projectId={projectId} class={styles.sidebar} />
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
		</Page>
	);
}
