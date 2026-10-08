import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import styles from './Avatar.module.css';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

export interface AvatarProps {
	/** The person's display name, for the initials and the accessible label. */
	name: string;
	/** Their picture. Initials stand in when there is none or it fails to load. */
	avatarUrl?: string | null;
	/** xs 20px, sm 24px, md 28px (default), lg 36px. */
	size?: AvatarSize;
	/** `primary` fills with the brand color, `muted` with the quieter surface tone. */
	tone?: 'primary' | 'muted';
	/** Hide it from assistive tech when the name is already printed beside it. */
	decorative?: boolean;
	class?: string;
}

/** The first letters of the first and last words, or '?' for a blank name. */
export function initials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	const first = words[0]?.[0];
	if (!first) return '?';
	const last = words.length > 1 ? words[words.length - 1]![0] : '';
	return (first + last).toUpperCase();
}

export function Avatar({
	name,
	avatarUrl,
	size = 'md',
	tone = 'primary',
	decorative = false,
	class: className,
}: AvatarProps): JSX.Element {
	const [failed, setFailed] = useState(false);
	useEffect(() => setFailed(false), [avatarUrl]);

	const classes = [styles.avatar, styles[size], styles[tone], className].filter(Boolean).join(' ');
	return (
		<span
			class={classes}
			title={name}
			role={decorative ? undefined : 'img'}
			aria-label={decorative ? undefined : name}
			aria-hidden={decorative || undefined}
		>
			{avatarUrl && !failed ? (
				<img class={styles.image} src={avatarUrl} alt="" onError={() => setFailed(true)} />
			) : (
				initials(name)
			)}
		</span>
	);
}
