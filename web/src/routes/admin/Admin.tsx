import type { JSX } from 'preact';
import type { RouteProps } from '@specboard/router';
import { Page } from '@specboard/ui';
import styles from './Admin.module.css';

export function Admin(_props: RouteProps): JSX.Element {
	return (
		<Page title="Admin">
			<div class={styles.content}>
				<div class={styles.cards}>
					<a href="/admin/users" class={styles.card}>
						<h2 class={styles.cardTitle}>User Management</h2>
						<p class={styles.cardDesc}>
							View, edit, and manage user accounts. Control user roles and activation status.
						</p>
					</a>

					<a href="/admin/waitlist" class={styles.card}>
						<h2 class={styles.cardTitle}>Early Access Waitlist</h2>
						<p class={styles.cardDesc}>
							View all early access signups from the public homepage.
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
		</Page>
	);
}
