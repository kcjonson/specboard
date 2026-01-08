import { useState, useMemo, useEffect } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@doc-platform/router';
import { Button, Text, Page } from '@doc-platform/ui';
import { fetchClient } from '@doc-platform/fetch';
import { useModel, UserModel, AuthorizationsCollection } from '@doc-platform/models';
import { AuthorizedApps } from './AuthorizedApps';
import { ApiKeys } from './ApiKeys';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { SetPasswordDialog } from './SetPasswordDialog';
import styles from './UserSettings.module.css';

interface User {
	id: string;
	username: string;
	email: string;
	first_name: string;
	last_name: string;
	email_verified: boolean;
	roles: string[];
	is_active: boolean;
	created_at: string;
	updated_at: string;
}

export function UserSettings(props: RouteProps): JSX.Element {
	const userId = props.params?.userId;

	// Current user model (always needed for permission checks)
	const currentUser = useMemo(() => new UserModel({ id: 'me' }), []);
	useModel(currentUser);

	// Check if admin is viewing their own profile via admin route
	const isViewingSelf = userId && currentUser.id && userId === currentUser.id;
	const isViewingOther = !!userId && !isViewingSelf;

	// Target user state (the user being viewed/edited)
	const [targetUser, setTargetUser] = useState<User | null>(null);
	const [targetLoading, setTargetLoading] = useState(isViewingOther);
	const [targetError, setTargetError] = useState<string | null>(null);

	// Authorizations (only for viewing own settings)
	const authorizations = useMemo(() => new AuthorizationsCollection(), []);
	useModel(authorizations);

	// Form state
	const [firstName, setFirstName] = useState('');
	const [lastName, setLastName] = useState('');
	const [username, setUsername] = useState('');
	const [email, setEmail] = useState('');
	const [isAdmin, setIsAdmin] = useState(false);
	const [isActive, setIsActive] = useState(true);
	const [emailVerified, setEmailVerified] = useState(false);
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
	const [initialized, setInitialized] = useState(false);
	const [saving, setSaving] = useState(false);

	// Password dialog state
	const [showPasswordDialog, setShowPasswordDialog] = useState(false);
	const [showSetPasswordDialog, setShowSetPasswordDialog] = useState(false);

	// Fetch target user if viewing another user
	useEffect(() => {
		if (!userId) return;

		async function fetchUser(): Promise<void> {
			setTargetLoading(true);
			setTargetError(null);
			try {
				const user = await fetchClient.get<User>(`/api/users/${userId}`);
				setTargetUser(user);
			} catch {
				setTargetError('Failed to load user');
			} finally {
				setTargetLoading(false);
			}
		}
		fetchUser();
	}, [userId]);

	// The user being edited (target user if viewing other, current user otherwise)
	const user = isViewingOther ? targetUser : (currentUser.id ? {
		id: currentUser.id,
		username: currentUser.username,
		email: currentUser.email,
		first_name: currentUser.first_name,
		last_name: currentUser.last_name,
		email_verified: currentUser.email_verified,
		roles: currentUser.roles || [],
		is_active: currentUser.is_active ?? true,
		created_at: '',
		updated_at: '',
	} : null);

	// Check if current user is admin
	const isCurrentUserAdmin = currentUser.roles?.includes('admin') ?? false;

	// Check if current user is superadmin (must be 'superadmin' and have admin role)
	const isCurrentUserSuperadmin = currentUser.username === 'superadmin' && isCurrentUserAdmin;

	// Initialize form when user data loads
	useEffect(() => {
		if (user && !initialized) {
			setFirstName(user.first_name || '');
			setLastName(user.last_name || '');
			setUsername(user.username || '');
			setEmail(user.email || '');
			setIsAdmin(user.roles?.includes('admin') ?? false);
			setIsActive(user.is_active ?? true);
			setEmailVerified(user.email_verified ?? false);
			setInitialized(true);
		}
	}, [user, initialized]);

	// Reset form when switching users
	useEffect(() => {
		setInitialized(false);
		setMessage(null);
	}, [userId]);

	// Validation
	const trimmedFirstName = firstName.trim();
	const trimmedLastName = lastName.trim();
	const trimmedUsername = username.trim();
	const trimmedEmail = email.trim();
	const isValid = trimmedFirstName.length > 0 && trimmedLastName.length > 0 &&
		(isCurrentUserAdmin ? trimmedUsername.length > 0 && trimmedEmail.length > 0 : true);

	// Change detection
	const hasChanges = initialized && user && (
		trimmedFirstName !== user.first_name ||
		trimmedLastName !== user.last_name ||
		(isCurrentUserAdmin && (
			trimmedUsername !== user.username ||
			trimmedEmail !== user.email ||
			isAdmin !== user.roles?.includes('admin') ||
			isActive !== user.is_active ||
			emailVerified !== user.email_verified
		))
	);

	const canSave = isValid && hasChanges && !saving;

	const handleSave = async (): Promise<void> => {
		if (!canSave || !user) return;

		setMessage(null);
		setSaving(true);

		try {
			const data: Record<string, unknown> = {
				first_name: trimmedFirstName,
				last_name: trimmedLastName,
			};

			// Admin can edit additional fields
			if (isCurrentUserAdmin) {
				data.username = trimmedUsername;
				data.email = trimmedEmail;
				data.roles = isAdmin ? ['admin'] : [];
				data.is_active = isActive;
				data.email_verified = emailVerified;
			}

			await fetchClient.put(`/api/users/${user.id}`, data);
			setMessage({ type: 'success', text: 'Settings saved successfully' });

			// Refetch to get updated data
			if (isViewingOther) {
				const updated = await fetchClient.get<User>(`/api/users/${userId}`);
				setTargetUser(updated);
				setInitialized(false);
			} else {
				currentUser.fetch();
				setInitialized(false);
			}
		} catch (err: unknown) {
			const errorMessage = err instanceof Error ? err.message : 'Failed to save settings';
			setMessage({ type: 'error', text: errorMessage });
		} finally {
			setSaving(false);
		}
	};

	// Loading state
	const isLoading = isViewingOther
		? (targetLoading || (!currentUser.id && currentUser.$meta.working))
		: ((currentUser.$meta.working && !currentUser.id) || (authorizations.$meta.working && !authorizations.$meta.lastFetched));

	if (isLoading) {
		return (
			<Page title="Settings">
				<div class={styles.container}>
					<div class={styles.content}>
						<div class={styles.loading}>Loading...</div>
					</div>
				</div>
			</Page>
		);
	}

	// Error state
	const error = targetError || currentUser.$meta.error || (!isViewingOther && authorizations.$meta.error);
	if (error) {
		const errorMessage = typeof error === 'string' ? error : error.message;
		return (
			<Page title="Settings">
				<div class={styles.container}>
					<div class={styles.content}>
						<div class={styles.card}>
							<p class={styles.error}>Failed to load: {errorMessage}</p>
							<Button onClick={() => {
								if (isViewingOther) {
									setTargetError(null);
									setTargetLoading(true);
									fetchClient.get<User>(`/api/users/${userId}`)
										.then(setTargetUser)
										.catch(() => setTargetError('Failed to load user'))
										.finally(() => setTargetLoading(false));
								} else {
									currentUser.fetch();
									authorizations.fetch();
								}
							}}>
								Retry
							</Button>
						</div>
					</div>
				</div>
			</Page>
		);
	}

	// Permission check for viewing other users
	if (isViewingOther && !isCurrentUserAdmin) {
		return (
			<Page title="Settings">
				<div class={styles.container}>
					<div class={styles.content}>
						<div class={styles.card}>
							<p class={styles.error}>You don't have permission to view this user.</p>
						</div>
					</div>
				</div>
			</Page>
		);
	}

	if (!user) {
		return (
			<Page title="Settings">
				<div class={styles.container}>
					<div class={styles.content}>
						<div class={styles.loading}>Loading...</div>
					</div>
				</div>
			</Page>
		);
	}

	const pageTitle = isViewingOther
		? `${user.first_name} ${user.last_name}`
		: 'Settings';

	return (
		<Page title={pageTitle}>
			<div class={styles.container}>
				<div class={styles.content}>
					<div class={styles.card}>
					<h1 class={styles.title}>{pageTitle}</h1>

					{message && (
						<div class={`${styles.message} ${styles[message.type]}`}>
							{message.text}
						</div>
					)}

					<div class={styles.form}>
						<div class={styles.row}>
							<div class={styles.field}>
								<label class={styles.label} htmlFor="firstName">
									First Name
								</label>
								<Text
									id="firstName"
									value={firstName}
									onInput={(e) => { setFirstName((e.target as HTMLInputElement).value); if (message) setMessage(null); }}
									placeholder="First name"
								/>
							</div>

							<div class={styles.field}>
								<label class={styles.label} htmlFor="lastName">
									Last Name
								</label>
								<Text
									id="lastName"
									value={lastName}
									onInput={(e) => { setLastName((e.target as HTMLInputElement).value); if (message) setMessage(null); }}
									placeholder="Last name"
								/>
							</div>
						</div>

						{isCurrentUserAdmin ? (
							<>
								<div class={styles.field}>
									<label class={styles.label} htmlFor="username">
										Username
									</label>
									<Text
										id="username"
										value={username}
										onInput={(e) => { setUsername((e.target as HTMLInputElement).value); if (message) setMessage(null); }}
										placeholder="Username"
									/>
								</div>

								<div class={styles.field}>
									<label class={styles.label} htmlFor="email">
										Email
									</label>
									<Text
										id="email"
										value={email}
										onInput={(e) => { setEmail((e.target as HTMLInputElement).value); if (message) setMessage(null); }}
										placeholder="Email address"
										type="email"
									/>
									<label class={styles.checkboxInline}>
										<input
											type="checkbox"
											checked={emailVerified}
											onChange={(e) => { setEmailVerified((e.target as HTMLInputElement).checked); if (message) setMessage(null); }}
										/>
										<span>Email Verified</span>
									</label>
								</div>

								<div class={styles.checkboxRow}>
									<label class={styles.checkbox}>
										<input
											type="checkbox"
											checked={isAdmin}
											onChange={(e) => { setIsAdmin((e.target as HTMLInputElement).checked); if (message) setMessage(null); }}
										/>
										<span>Admin</span>
									</label>
									<label class={styles.checkbox}>
										<input
											type="checkbox"
											checked={isActive}
											onChange={(e) => { setIsActive((e.target as HTMLInputElement).checked); if (message) setMessage(null); }}
										/>
										<span>Active</span>
									</label>
								</div>
							</>
						) : (
							<>
								<div class={styles.field}>
									<label class={styles.label} htmlFor="email">
										Email
									</label>
									<Text
										id="email"
										value={user.email || ''}
										disabled
										placeholder="Email address"
									/>
									<span class={styles.hint}>Email cannot be changed</span>
								</div>
								<div class={styles.statusRow}>
									<span class={styles.statusLabel}>Email Status:</span>
									{user.email_verified ? (
										<span class={styles.statusVerified}>Verified</span>
									) : (
										<span class={styles.statusUnverified}>Not Verified</span>
									)}
								</div>
							</>
						)}

						<div class={styles.actions}>
							<Button onClick={handleSave} disabled={!canSave}>
								{saving ? 'Saving...' : 'Save Changes'}
							</Button>
						</div>

						{!isViewingOther && (
							<div class={styles.securitySection}>
								<h3 class={styles.sectionTitle}>Security</h3>
								<Button variant="secondary" onClick={() => setShowPasswordDialog(true)}>
									Change Password
								</Button>
							</div>
						)}

						{isViewingOther && isCurrentUserSuperadmin && (
							<div class={styles.securitySection}>
								<h3 class={styles.sectionTitle}>Security</h3>
								<Button variant="secondary" onClick={() => setShowSetPasswordDialog(true)}>
									Set Password
								</Button>
							</div>
						)}
					</div>

					{!isViewingOther && (
						<AuthorizedApps authorizations={authorizations} />
					)}

					{!isViewingOther && (
						<ApiKeys />
					)}

					<ChangePasswordDialog
						open={showPasswordDialog}
						onClose={() => setShowPasswordDialog(false)}
					/>

					{isViewingOther && user && (
						<SetPasswordDialog
							open={showSetPasswordDialog}
							onClose={() => setShowSetPasswordDialog(false)}
							userId={user.id}
							userName={`${user.first_name} ${user.last_name}`.trim() || user.username}
						/>
					)}
				</div>
			</div>
		</div>
		</Page>
	);
}
