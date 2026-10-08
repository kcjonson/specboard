import type { JSX } from 'preact';
import { Badge } from '@specboard/ui';
import styles from './ProjectChip.module.css';

/** What a view that mixes projects needs to say which one an item is from. */
export interface ProjectLabel {
	/** The project's address, `owner/project`. */
	ref: string;
	name: string;
	/** The prefix of the project's item keys (`SPE`). */
	key: string;
}

export interface ProjectChipProps {
	project: ProjectLabel;
}

/** The project an item belongs to: its name, with the `owner/project` address on hover. */
export function ProjectChip({ project }: ProjectChipProps): JSX.Element {
	return (
		<span class={styles.chip} title={project.ref}>
			{project.name}
		</span>
	);
}

export interface ProjectKeyProps {
	/** The project's item-key prefix (`SPE`). */
	prefix: string;
}

/** A project's item-key prefix, set in the mono face the keys themselves use. */
export function ProjectKey({ prefix }: ProjectKeyProps): JSX.Element {
	return <Badge class={`size-sm ${styles.key}`}>{prefix}</Badge>;
}
