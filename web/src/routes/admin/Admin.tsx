import type { JSX } from 'preact';
import type { RouteProps } from '@doc-platform/router';
import { AppHeader } from '@doc-platform/ui';
import { useAuth } from '@shared/planning';
import styles from './Admin.module.css';

export function Admin(_props: RouteProps): JSX.Element {
	const { user } = useAuth();

	return (
		<div class={styles.container}>
			<AppHeader
				projectName="Admin"
				user={user ? { displayName: user.displayName, email: user.email, isAdmin: user.roles?.includes('admin') } : undefined}
			/>

			<div class={styles.content}>
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
