import { useState, useMemo, useEffect } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@doc-platform/router';
import { Button, Text } from '@doc-platform/ui';
import { useModel, UserModel } from '@doc-platform/models';
import { AuthorizedApps } from './AuthorizedApps';
import styles from './UserSettings.module.css';

export function UserSettings(_props: RouteProps): JSX.Element {
	// Create user model once, auto-fetches on construction
	const user = useMemo(() => new UserModel(), []);
	useModel(user);

	// Form state for editable fields
	const [firstName, setFirstName] = useState('');
	const [lastName, setLastName] = useState('');
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
	const [initialized, setInitialized] = useState(false);

	// Initialize form when user data loads
	useEffect(() => {
		if (user.first_name && !initialized) {
			setFirstName(user.first_name);
			setLastName(user.last_name || '');
			setInitialized(true);
		}
	}, [user.first_name, user.last_name, initialized]);

	// Validation and change detection
	const trimmedFirstName = firstName.trim();
	const trimmedLastName = lastName.trim();
	const isValid = trimmedFirstName.length > 0 && trimmedLastName.length > 0;
	const hasChanges = initialized && (
		trimmedFirstName !== user.first_name ||
		trimmedLastName !== user.last_name
	);
	const canSave = isValid && hasChanges && !user.$meta.working;

	const handleFirstNameChange = (e: Event): void => {
		const value = (e.target as HTMLInputElement).value;
		setFirstName(value);
		if (message) setMessage(null);
	};

	const handleLastNameChange = (e: Event): void => {
		const value = (e.target as HTMLInputElement).value;
		setLastName(value);
		if (message) setMessage(null);
	};

	const handleSave = async (): Promise<void> => {
		if (!canSave) return;

		setMessage(null);

		try {
			user.set({ first_name: trimmedFirstName, last_name: trimmedLastName });
			await user.save();
			setMessage({ type: 'success', text: 'Settings saved successfully' });
		} catch {
			setMessage({ type: 'error', text: user.$meta.error?.message || 'Failed to save settings' });
		}
	};

	// Loading state - show when working AND no user data yet
	if (user.$meta.working && !user.id) {
		return (
			<div class={styles.container}>
				<div class={styles.content}>
					<div class={styles.loading}>Loading...</div>
				</div>
			</div>
		);
	}

	// Error state - only show if error AND no user data
	if (user.$meta.error && !user.id) {
		return (
			<div class={styles.container}>
				<div class={styles.content}>
					<nav class={styles.nav}>
						<a href="/" class={styles.backLink}>
							← Back to Board
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
					<a href="/planning" class={styles.backLink}>
						← Back to Board
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
							<label class={styles.label} htmlFor="firstName">
								First Name
							</label>
							<Text
								id="firstName"
								value={firstName}
								onInput={handleFirstNameChange}
								placeholder="Enter your first name"
							/>
							{!trimmedFirstName && firstName.length > 0 && (
								<span class={styles.hint} style="color: var(--color-error)">
									First name cannot be empty
								</span>
							)}
						</div>

						<div class={styles.field}>
							<label class={styles.label} htmlFor="lastName">
								Last Name
							</label>
							<Text
								id="lastName"
								value={lastName}
								onInput={handleLastNameChange}
								placeholder="Enter your last name"
							/>
							{!trimmedLastName && lastName.length > 0 && (
								<span class={styles.hint} style="color: var(--color-error)">
									Last name cannot be empty
								</span>
							)}
						</div>

						<div class={styles.field}>
							<label class={styles.label} htmlFor="email">
								Email
							</label>
							<Text
								id="email"
								value={user.email || ''}
								disabled
								placeholder="Your email address"
							/>
							<span class={styles.hint}>Email cannot be changed</span>
						</div>

						<div class={styles.actions}>
							<Button onClick={handleSave} disabled={!canSave}>
								{user.$meta.working ? 'Saving...' : 'Save Changes'}
							</Button>
						</div>
					</div>

					<AuthorizedApps />
				</div>
			</div>
		</div>
	);
}
