import type { JSX } from 'preact';
import { Text } from '@specboard/ui';
import { isValidUserSlug, MAX_USER_SLUG_LENGTH } from '@specboard/core/identifiers';
import styles from './UserSlugField.module.css';

export interface UserSlugFieldProps {
	value: string;
	onInput: (value: string) => void;
	/**
	 * The slug as saved. When set and the value differs, the field warns that saving
	 * moves every project URL the user owns.
	 */
	savedSlug?: string | null;
	disabled?: boolean;
}

/** The user slug input, with a preview of the project URLs it produces. */
export function UserSlugField({ value, onInput, savedSlug, disabled }: UserSlugFieldProps): JSX.Element {
	const slug = value.trim();
	const invalid = slug.length > 0 && !isValidUserSlug(slug);
	const changing = Boolean(savedSlug) && slug !== savedSlug;

	return (
		<div class={styles.field}>
			<label class={styles.label} htmlFor="userSlug">User slug</label>
			<Text
				id="userSlug"
				value={value}
				onInput={(e) => onInput((e.target as HTMLInputElement).value)}
				placeholder="your-slug"
				autoComplete="off"
				compact
				disabled={disabled}
			/>
			<span class={styles.preview}>
				{window.location.host}/projects/<strong>{slug || 'your-slug'}</strong>/your-project/...
			</span>
			<span class={invalid ? styles.invalid : styles.hint}>
				Up to {MAX_USER_SLUG_LENGTH} lowercase letters, numbers, and single hyphens
			</span>
			{changing && (
				<span class={styles.warning} role="alert">
					Changing your user slug changes the URL of every project you own. Links and
					.mcp.json files that use {savedSlug}/... will stop working.
				</span>
			)}
		</div>
	);
}
