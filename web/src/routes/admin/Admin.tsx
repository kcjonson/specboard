import type { JSX } from 'preact';
import type { RouteProps } from '@doc-platform/router';
import styles from './Admin.module.css';

export function Admin(_props: RouteProps): JSX.Element {
	return (
		<div class={styles.container}>
			<div class={styles.content}>
				<nav class={styles.nav}>
					<a href="/projects" class={styles.backLink}>
						← Back to Projects
					</a>
				</nav>

				<h1 class={styles.title}>Admin</h1>

				<div class={styles.cards}>
					<a href="/admin/users" class={styles.card}>
						<h2 class={styles.cardTitle}>User Management</h2>
						<p class={styles.cardDesc}>
							View, edit, and manage user accounts. Control user roles and activation status.
						</p>
					</a>

					<a href="/admin/ui" class={styles.card}>
						<h2 class={styles.cardTitle}>UI Components</h2>
						<p class={styles.cardDesc}>
							Component library demo page showing all available UI components and their variants.
						</p>
					</a>
				</div>
			</div>
		</div>
	);
}
