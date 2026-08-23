import { useState, useMemo } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Text } from '@specboard/ui';
import { fetchClient, FetchError } from '@specboard/fetch';
import { navigate } from '@specboard/router';
import { useModel, UserModel } from '@specboard/models';
import {
	browserSupportsWebAuthn,
	createPasskey,
	passkeyErrorMessage,
	type PublicKeyCredentialCreationOptionsJSON,
} from '../../lib/webauthn';
import styles from './Onboarding.module.css';

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,30}$/;

interface RegisterOptionsResponse {
	challengeId: string;
	options: PublicKeyCredentialCreationOptionsJSON;
}

/**
 * Post-first-login onboarding for email-only signups: claim a username and
 * names (required), then optionally create a password. Reached via the
 * profile_complete guard in main.tsx.
 */
export function Onboarding(): JSX.Element | null {
	const user = useMemo(() => new UserModel({ id: 'me' }), []);
	useModel(user);

	const [step, setStep] = useState<'identity' | 'password' | 'passkey'>('identity');
	const passkeySupported = browserSupportsWebAuthn();
	const [username, setUsername] = useState('');
	const [firstName, setFirstName] = useState('');
	const [lastName, setLastName] = useState('');
	const [newPassword, setNewPassword] = useState('');
	const [confirmPassword, setConfirmPassword] = useState('');
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Landed here with a finished profile (deep link, back button): move on,
	// unless this visit is mid-flow on the optional password step
	if (user.$meta.lastFetched && user.profile_complete && step === 'identity') {
		navigate('/');
		return null;
	}

	const trimmedFirst = firstName.trim();
	const trimmedLast = lastName.trim();
	const identityValid = USERNAME_PATTERN.test(username.trim()) &&
		trimmedFirst.length > 0 && trimmedLast.length > 0;

	const hasUppercase = /[A-Z]/.test(newPassword);
	const hasLowercase = /[a-z]/.test(newPassword);
	const hasDigit = /\d/.test(newPassword);
	const hasSpecialChar = /[^A-Za-z0-9]/.test(newPassword);
	const meetsComplexity = newPassword.length >= 12 && hasUppercase && hasLowercase && hasDigit && hasSpecialChar;
	const passwordValid = meetsComplexity && newPassword === confirmPassword;

	const finish = (): void => {
		navigate('/');
	};

	// The server's friendly message lives in FetchError.data.error;
	// err.message is just "HTTP 409: Conflict".
	const errorText = (err: unknown, fallback: string): string => {
		if (err instanceof FetchError) {
			const data = err.data as { error?: string } | undefined;
			if (data?.error) return data.error;
		}
		return fallback;
	};

	const handleIdentitySubmit = async (e: Event): Promise<void> => {
		e.preventDefault();
		if (!identityValid || saving) return;
		setError(null);
		setSaving(true);
		try {
			await fetchClient.put('/api/auth/me', {
				username: username.trim(),
				first_name: trimmedFirst,
				last_name: trimmedLast,
			});
			user.fetch();
			setStep('password');
		} catch (err: unknown) {
			setError(errorText(err, 'Failed to save profile'));
		} finally {
			setSaving(false);
		}
	};

	const handlePasswordSubmit = async (e: Event): Promise<void> => {
		e.preventDefault();
		if (!passwordValid || saving) return;
		setError(null);
		setSaving(true);
		try {
			await fetchClient.put('/api/auth/change-password', {
				new_password: newPassword,
			});
			setSaving(false);
			goToPasskeyOrFinish();
		} catch (err: unknown) {
			setError(errorText(err, 'Failed to set password'));
			setSaving(false);
		}
	};

	// After password (set or skipped), offer a passkey if the browser supports
	// one; otherwise onboarding is done.
	const goToPasskeyOrFinish = (): void => {
		setError(null);
		if (passkeySupported) setStep('passkey');
		else finish();
	};

	const handleAddPasskey = async (): Promise<void> => {
		if (saving) return;
		setError(null);
		setSaving(true);
		try {
			const { challengeId, options } = await fetchClient.post<RegisterOptionsResponse>(
				'/api/auth/webauthn/register/options'
			);
			const response = await createPasskey(options);
			await fetchClient.post('/api/auth/webauthn/register/verify', { challengeId, response });
			finish();
		} catch (err: unknown) {
			setError(err instanceof FetchError
				? errorText(err, 'Could not add a passkey.')
				: passkeyErrorMessage(err, 'Could not add a passkey.'));
			setSaving(false);
		}
	};

	return (
		<div class={styles.container}>
			<div class={styles.card}>
				{step === 'identity' ? (
					<>
						<h1 class={styles.title}>Welcome to Specboard</h1>
						<p class={styles.subtitle}>
							Pick a username and tell us your name to finish setting up your account.
						</p>

						{error && <div class={styles.error}>{error}</div>}

						<form onSubmit={handleIdentitySubmit} class={styles.form}>
							<div class={styles.field}>
								<label class={styles.label} htmlFor="username">Username</label>
								<Text
									id="username"
									value={username}
									onInput={(e) => { setUsername((e.target as HTMLInputElement).value); if (error) setError(null); }}
									autoComplete="username"
									placeholder="username"
									required
								/>
								<span class={styles.hint}>3-30 characters, letters, numbers, and underscores</span>
							</div>

							<div class={styles.row}>
								<div class={styles.field}>
									<label class={styles.label} htmlFor="firstName">First Name</label>
									<Text
										id="firstName"
										value={firstName}
										onInput={(e) => setFirstName((e.target as HTMLInputElement).value)}
										autoComplete="given-name"
										required
									/>
								</div>
								<div class={styles.field}>
									<label class={styles.label} htmlFor="lastName">Last Name</label>
									<Text
										id="lastName"
										value={lastName}
										onInput={(e) => setLastName((e.target as HTMLInputElement).value)}
										autoComplete="family-name"
										required
									/>
								</div>
							</div>

							<Button type="submit" disabled={!identityValid || saving}>
								{saving ? 'Saving...' : 'Continue'}
							</Button>
						</form>
					</>
				) : step === 'password' ? (
					<>
						<h1 class={styles.title}>Create a password</h1>
						<p class={styles.subtitle}>
							Optional: you can always sign in with an emailed code instead.
						</p>

						{error && <div class={styles.error}>{error}</div>}

						<form onSubmit={handlePasswordSubmit} class={styles.form}>
							<div class={styles.field}>
								<label class={styles.label} htmlFor="newPassword">Password</label>
								<Text
									id="newPassword"
									type="password"
									value={newPassword}
									onInput={(e) => { setNewPassword((e.target as HTMLInputElement).value); if (error) setError(null); }}
									autoComplete="new-password"
									required
								/>
								<span class={styles.hint}>
									At least 12 characters with uppercase, lowercase, digit, and special character
								</span>
							</div>

							<div class={styles.field}>
								<label class={styles.label} htmlFor="confirmPassword">Confirm Password</label>
								<Text
									id="confirmPassword"
									type="password"
									value={confirmPassword}
									onInput={(e) => setConfirmPassword((e.target as HTMLInputElement).value)}
									autoComplete="new-password"
									required
								/>
							</div>

							<Button type="submit" disabled={!passwordValid || saving}>
								{saving ? 'Saving...' : 'Create Password'}
							</Button>

							<button type="button" class={styles.skipLink} onClick={goToPasskeyOrFinish}>
								Skip for now
							</button>
						</form>
					</>
				) : (
					<>
						<h1 class={styles.title}>Add a passkey</h1>
						<p class={styles.subtitle}>
							Optional: sign in with your fingerprint, face, or device PIN instead of a password.
						</p>

						{error && <div class={styles.error}>{error}</div>}

						<div class={styles.form}>
							<Button type="button" disabled={saving} onClick={handleAddPasskey}>
								{saving ? 'Follow your browser...' : 'Add a passkey'}
							</Button>
							<button type="button" class={styles.skipLink} onClick={finish}>
								Skip for now
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
