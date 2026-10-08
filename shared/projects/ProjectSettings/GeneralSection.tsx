import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { navigate } from '@specboard/router';
import { isValidProjectKey, isValidProjectSlug, MAX_PROJECT_SLUG_LENGTH } from '@specboard/core/identifiers';
import { FetchError } from '@specboard/fetch';
import { Button, ConfirmDialog, Notice } from '@specboard/ui';
import { writeFailure, type ProjectModel } from '@specboard/models';
import { saveProject } from './settings-api';
import { SectionHeader } from './SectionHeader';
import styles from './ProjectSettings.module.css';

export interface GeneralSectionProps {
	title: string;
	project: ProjectModel;
	projectRef: string;
}

type Identifier = 'slug' | 'key';

/** What changing each identifier breaks, for the confirm before saving it. */
const BREAKS: Record<Identifier, string> = {
	slug: 'The project moves to a new address. Old links to it stop working, and so do .mcp.json bindings that name it.',
	key: 'Every item key is renamed. Links, branch names and MCP references that use the old keys stop matching.',
};

/** Name, description, and the two identifiers: the URL slug and the item key prefix. */
export function GeneralSection({ title, project, projectRef }: GeneralSectionProps): JSX.Element {
	const [name, setName] = useState(project.name ?? '');
	const [description, setDescription] = useState(project.description ?? '');
	const [slug, setSlug] = useState(project.slug ?? '');
	const [itemKey, setItemKey] = useState(project.key ?? '');
	const [saving, setSaving] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [status, setStatus] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);
	// The server's refusal of one identifier (taken), shown under that field.
	const [taken, setTaken] = useState<{ field: Identifier; text: string } | null>(null);

	const newSlug = slug.trim();
	const newKey = itemKey.trim();
	const slugValid = isValidProjectSlug(newSlug);
	const keyValid = isValidProjectKey(newKey);
	const valid = Boolean(name.trim()) && slugValid && keyValid;
	const changed: Identifier[] = [
		...(newSlug !== project.slug ? ['slug' as const] : []),
		...(newKey !== project.key ? ['key' as const] : []),
	];

	function handleSubmit(e: Event): void {
		e.preventDefault();
		if (!valid || saving) return;
		setStatus(null);
		if (changed.length > 0) setConfirming(true);
		else void save();
	}

	async function save(): Promise<void> {
		setSaving(true);
		setStatus(null);
		setTaken(null);
		try {
			const savedRef = await saveProject(project, projectRef, {
				name: name.trim(),
				description: description.trim(),
				// Identifiers go only when changed, so an untouched form can't trip
				// "already in use" on its own values.
				...(changed.includes('slug') ? { slug: newSlug } : {}),
				...(changed.includes('key') ? { key: newKey } : {}),
			});
			setStatus({ variant: 'success', text: 'Saved.' });
			// The project moved; this address no longer resolves. The page stays mounted.
			if (savedRef !== projectRef) navigate(`/projects/${savedRef}/settings`, { replace: true });
		} catch (err) {
			const field = err instanceof FetchError && err.status === 409 ? (err.data as { field?: string } | undefined)?.field : undefined;
			const text = writeFailure(err, 'Failed to save project', projectRef);
			if (field === 'slug' || field === 'key') setTaken({ field, text });
			else setStatus({ variant: 'error', text });
		} finally {
			setSaving(false);
		}
	}

	const slugError = !slugValid
		? 'Lowercase letters, numbers, and single hyphens between them.'
		: taken?.field === 'slug' ? taken.text : null;
	const keyError = !keyValid
		? '2–10 characters: a letter first, then letters or digits.'
		: taken?.field === 'key' ? taken.text : null;

	return (
		<form class={styles.form} onSubmit={handleSubmit}>
			<SectionHeader title={title} />
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
				<span class={styles.hint}>Its address: /projects/{project.ownerSlug}/{slug || '…'}/planning</span>
				<input
					type="text"
					value={slug}
					onInput={(e) => {
						setSlug((e.target as HTMLInputElement).value.toLowerCase());
						if (taken?.field === 'slug') setTaken(null);
					}}
					placeholder="my-project"
					maxLength={MAX_PROJECT_SLUG_LENGTH}
					aria-invalid={slugError ? true : undefined}
				/>
				{slugError && <span class={styles.fieldError} role={taken?.field === 'slug' ? 'alert' : undefined}>{slugError}</span>}
			</label>

			<label class={styles.field}>
				<span class={styles.label}>Item key prefix</span>
				<span class={styles.hint}>Prefixes this project's work items: {itemKey || '…'}-345</span>
				<input
					type="text"
					value={itemKey}
					onInput={(e) => {
						setItemKey((e.target as HTMLInputElement).value.toUpperCase());
						if (taken?.field === 'key') setTaken(null);
					}}
					placeholder="SB"
					maxLength={10}
					aria-invalid={keyError ? true : undefined}
				/>
				{keyError && <span class={styles.fieldError} role={taken?.field === 'key' ? 'alert' : undefined}>{keyError}</span>}
			</label>

			{status && <Notice variant={status.variant} announce>{status.text}</Notice>}

			<div class={styles.formActions}>
				<Button type="submit" disabled={!valid} busy={saving}>{saving ? 'Saving...' : 'Save'}</Button>
			</div>

			<ConfirmDialog
				open={confirming}
				title={changed.length === 2 ? 'Change the URL slug and item key?' : changed[0] === 'key' ? 'Change the item key prefix?' : 'Change the URL slug?'}
				message={changed.map((field) => BREAKS[field]).join(' ')}
				confirmText="Save changes"
				onConfirm={() => {
					setConfirming(false);
					void save();
				}}
				onCancel={() => setConfirming(false)}
			/>
		</form>
	);
}
