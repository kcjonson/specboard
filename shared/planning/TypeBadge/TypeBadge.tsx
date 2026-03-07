import type { JSX } from 'preact';
import type { ItemType } from '@specboard/models';
import { Icon, type IconName } from '@specboard/ui';
import styles from './TypeBadge.module.css';

const TYPE_CONFIG: Record<ItemType, { icon: IconName; label: string }> = {
	epic: { icon: 'file', label: 'Epic' },
	chore: { icon: 'wrench', label: 'Chore' },
	bug: { icon: 'bug', label: 'Bug' },
};

interface TypeBadgeProps {
	type: ItemType;
	class?: string;
}

export function TypeBadge({ type, class: className }: TypeBadgeProps): JSX.Element {
	const config = TYPE_CONFIG[type];
	const classes = [styles.badge, styles[type], className].filter(Boolean).join(' ');

	return (
		<span class={classes} title={config.label} role="img" aria-label={config.label}>
			<Icon name={config.icon} class="size-xs" />
		</span>
	);
}
