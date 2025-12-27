import type { JSX } from 'preact';
import type { RouteProps } from '@doc-platform/router';
import styles from './Editor.module.css';

export function Editor(_props: RouteProps): JSX.Element {
	return (
		<div class={styles.container}>
			<header class={styles.header}>
				<h1 class={styles.title}>Pages</h1>
			</header>
			<main class={styles.main}>
				<div class={styles.placeholder}>
					Editor coming soon...
				</div>
			</main>
		</div>
	);
}
