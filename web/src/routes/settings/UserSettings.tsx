import { useState, useMemo, useEffect } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@doc-platform/router';
import { Button, Text } from '@doc-platform/ui';
import { useModel, UserModel, AuthorizationsCollection } from '@doc-platform/models';
import { AuthorizedApps } from './AuthorizedApps';
import styles from './UserSettings.module.css';

export function UserSettings(_props: RouteProps): JSX.Element {
	// Create models once, auto-fetch on construction
	const user = useMemo(() => new UserModel(), []);
	const authorizations = useMemo(() => new AuthorizationsCollection(), []);
	useModel(user);
	useModel(authorizations);

	// Form state for editable fields
	const [firstName, setFirstName] = useState('');
	const [lastName, setLastName] = useState('');
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
	const [initialized, setInitialized] = useState(false);

	// Initialize form when user data loads (check id to know data is loaded)
	useEffect(() => {
		if (user.id && !initialized) {
			setFirstName(user.first_name || '');
			setLastName(user.last_name || '');
			setInitialized(true);
		}
	}, [user.id, user.first_name, user.last_name, initialized]);

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
		} catch (err: unknown) {
			// Get error message from model metadata, caught error, or fallback
			const errorMessage = user.$meta.error?.message
				|| (err instanceof Error ? err.message : null)
				|| 'Failed to save settings';
			setMessage({ type: 'error', text: errorMessage });
		}
	};

	// Loading state - show when either model is working AND we don't have data yet
	const isLoading = (user.$meta.working && !user.id) || (authorizations.$meta.working && authorizations.length === 0);
	if (isLoading) {
		return (
			<div class={styles.container}>
				<div class={styles.content}>
					<div class={styles.loading}>Loading...</div>
				</div>
			</div>
		);
	}

	// Error state - if any model fails to load, fail the whole page
	const error = user.$meta.error || authorizations.$meta.error;
	if (error) {
		return (
			<div class={styles.container}>
				<div class={styles.content}>
					<nav class={styles.nav}>
						<a href="/" class={styles.backLink}>
							← Back to Board
						</a>
					</nav>
					<div class={styles.card}>
						<p class={styles.error}>Failed to load settings: {error.message}</p>
						<Button onClick={() => { user.fetch(); authorizations.fetch(); }}>
							Retry
						</Button>
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

					<AuthorizedApps authorizations={authorizations} />
				</div>
			</div>
		</div>
	);
}
