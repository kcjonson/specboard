import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { navigate } from '@specboard/router';
import { isValidProjectKey, isValidProjectSlug, MAX_PROJECT_SLUG_LENGTH } from '@specboard/core/identifiers';
import { Button, Notice } from '@specboard/ui';
import { writeFailure, type ProjectModel } from '@specboard/models';
import { saveProject } from './settings-api';
import styles from './ProjectSettings.module.css';

export interface GeneralSectionProps {
	project: ProjectModel;
	projectRef: string;
}

/** Name, description, and the two identifiers: the URL slug and the item key prefix. */
export function GeneralSection({ project, projectRef }: GeneralSectionProps): JSX.Element {
	const [name, setName] = useState(project.name ?? '');
	const [description, setDescription] = useState(project.description ?? '');
	const [slug, setSlug] = useState(project.slug ?? '');
	const [itemKey, setItemKey] = useState(project.key ?? '');
	const [saving, setSaving] = useState(false);
	const [status, setStatus] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);

	const slugValid = isValidProjectSlug(slug.trim());
	const keyValid = isValidProjectKey(itemKey.trim());
	const valid = Boolean(name.trim()) && slugValid && keyValid;

	async function handleSubmit(e: Event): Promise<void> {
		e.preventDefault();
		if (!valid || saving) return;

		const newSlug = slug.trim();
		const newKey = itemKey.trim();
		setSaving(true);
		setStatus(null);
		try {
			const savedRef = await saveProject(project, projectRef, {
				name: name.trim(),
				description: description.trim(),
				// Identifiers go only when changed, so an untouched form can't trip
				// "already in use" on its own values.
				...(newSlug !== project.slug ? { slug: newSlug } : {}),
				...(newKey !== project.key ? { key: newKey } : {}),
			});
			if (savedRef !== projectRef) {
				// The project moved; this address no longer resolves.
				navigate(`/projects/${savedRef}/settings`, { replace: true });
				return;
			}
			setStatus({ variant: 'success', text: 'Saved.' });
		} catch (err) {
			setStatus({ variant: 'error', text: writeFailure(err, 'Failed to save project', projectRef) });
		} finally {
			setSaving(false);
		}
	}

	return (
		<form class={styles.form} onSubmit={handleSubmit}>
			<label class={styles.field}>
				<span class={styles.label}>Name</span>
				<input
					type="text"
					value={name}
					onInput={(e) => setName((e.target as HTMLInputElement).value)}
					placeholder="My Project"
				/>
			</label>

			<label class={styles.field}>
				<span class={styles.label}>Description (optional)</span>
				<textarea
					value={description}
					onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
					placeholder="A brief description of your project"
					rows={3}
				/>
			</label>

			<label class={styles.field}>
				<span class={styles.label}>URL slug</span>
				<span class={styles.hint}>
					Its address: /projects/{project.ownerSlug}/{slug || '…'}/planning. Changing it moves the
					project, and old links and .mcp.json bindings that name it stop working.
				</span>
				<input
					type="text"
					value={slug}
					onInput={(e) => setSlug((e.target as HTMLInputElement).value.toLowerCase())}
					placeholder="my-project"
					maxLength={MAX_PROJECT_SLUG_LENGTH}
				/>
				{!slugValid && <span class={styles.fieldError}>Lowercase letters, numbers, and single hyphens between them.</span>}
			</label>

			<label class={styles.field}>
				<span class={styles.label}>Item key prefix</span>
				<span class={styles.hint}>
					Prefixes this project's work items: {itemKey || '…'}-345. Changing it renames every item key, so links,
					branch names and MCP references that use the old keys stop matching.
				</span>
				<input
					type="text"
					value={itemKey}
					onInput={(e) => setItemKey((e.target as HTMLInputElement).value.toUpperCase())}
					placeholder="SB"
					maxLength={10}
				/>
				{!keyValid && <span class={styles.fieldError}>2–10 characters: a letter first, then letters or digits.</span>}
			</label>

			{status && <Notice variant={status.variant} announce>{status.text}</Notice>}

			<div class={styles.formActions}>
				<Button type="submit" disabled={!valid} busy={saving}>{saving ? 'Saving...' : 'Save'}</Button>
			</div>
		</form>
	);
}
