import { useState, useEffect } from 'preact/hooks';
import type { JSX } from 'preact';
import { Dialog, Button, Text } from '@doc-platform/ui';
import type { Project } from '../ProjectCard/ProjectCard';
import styles from './ProjectDialog.module.css';

export interface ProjectDialogProps {
	/** Project to edit (null for create mode) */
	project: Project | null;
	/** Called when dialog should close */
	onClose: () => void;
	/** Called when project is saved (created or updated) */
	onSave: (data: { name: string; description?: string }) => Promise<void>;
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

	// Reset form when project changes
	useEffect(() => {
		setName(project?.name ?? '');
		setDescription(project?.description ?? '');
		setShowDeleteConfirm(false);
		setError(null);
	}, [project]);

	async function handleSubmit(e: Event): Promise<void> {
		e.preventDefault();
		if (!name.trim() || saving) return;

		try {
			setSaving(true);
			setError(null);
			await onSave({
				name: name.trim(),
				description: description.trim() || undefined,
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to save project');
		} finally {
			setSaving(false);
		}
	}

	async function handleDelete(): Promise<void> {
		if (!onDelete || deleting) return;

		try {
			setDeleting(true);
			setError(null);
			await onDelete();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to delete project');
		} finally {
			setDeleting(false);
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
						<Text variant="error">{error}</Text>
					)}
					<Text>
						Are you sure you want to delete "{project?.name}"? This will also delete all epics and tasks in this project.
					</Text>
					<Text variant="secondary">This action cannot be undone.</Text>
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
					<Text variant="error">{error}</Text>
				)}
				<div class={styles.field}>
					<label class={styles.label}>
						<Text>Name</Text>
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
						<Text>Description (optional)</Text>
						<textarea
							class={styles.textarea}
							value={description}
							onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
							placeholder="A brief description of your project"
							rows={3}
						/>
					</label>
				</div>
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
