import { useState, useEffect } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@doc-platform/router';
import { Button, Text } from '@doc-platform/ui';
import { useAuth } from '@shared/planning';
import styles from './UserSettings.module.css';

export function UserSettings(_props: RouteProps): JSX.Element {
	const { user, loading } = useAuth();

	const [displayName, setDisplayName] = useState('');
	const [isSaving, setIsSaving] = useState(false);
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

	// Initialize form when user data loads
	useEffect(() => {
		if (user) {
			setDisplayName(user.displayName);
		}
	}, [user]);

	// Validation and change detection
	const trimmedDisplayName = displayName.trim();
	const isValid = trimmedDisplayName.length > 0;
	const hasChanges = user ? trimmedDisplayName !== user.displayName : false;
	const canSave = isValid && hasChanges && !isSaving;

	const handleDisplayNameChange = (e: Event): void => {
		const value = (e.target as HTMLInputElement).value;
		setDisplayName(value);
		// Clear message when user makes changes
		if (message) {
			setMessage(null);
		}
	};

	const handleSave = async (): Promise<void> => {
		if (!canSave) return;

		setIsSaving(true);
		setMessage(null);

		// TODO: Implement actual API call to update user profile
		await new Promise((resolve) => setTimeout(resolve, 500));

		setIsSaving(false);
		setMessage({ type: 'success', text: 'Settings saved successfully' });
	};

	if (loading) {
		return (
			<div class={styles.container}>
				<div class={styles.content}>
					<div class={styles.loading}>Loading...</div>
				</div>
			</div>
		);
	}

	if (!user) {
		return (
			<div class={styles.container}>
				<div class={styles.content}>
					<nav class={styles.nav}>
						<a href="/projects" class={styles.backLink}>
							← Back to Projects
						</a>
					</nav>
					<div class={styles.card}>
						<p>Please log in to view settings.</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div class={styles.container}>
			<div class={styles.content}>
				<nav class={styles.nav}>
					<a href="/projects" class={styles.backLink}>
						← Back to Projects
					</a>
				</nav>

				<div class={styles.card}>
					<h1 class={styles.title}>User Settings</h1>

					{message && (
						<div class={`${styles.message} ${styles[message.type]}`}>
							{message.text}
						</div>
					)}

					<div class={styles.form}>
						<div class={styles.field}>
							<label class={styles.label} htmlFor="displayName">
								Display Name
							</label>
							<Text
								id="displayName"
								value={displayName}
								onInput={handleDisplayNameChange}
								placeholder="Enter your display name"
							/>
							{!isValid && displayName.length > 0 && (
								<span class={styles.hint} style="color: var(--color-error)">
									Display name cannot be empty
								</span>
							)}
						</div>

						<div class={styles.field}>
							<label class={styles.label} htmlFor="email">
								Email
							</label>
							<Text
								id="email"
								value={user.email}
								disabled
								placeholder="Your email address"
							/>
							<span class={styles.hint}>Email cannot be changed</span>
						</div>

						<div class={styles.actions}>
							<Button onClick={handleSave} disabled={!canSave}>
								{isSaving ? 'Saving...' : 'Save Changes'}
							</Button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
