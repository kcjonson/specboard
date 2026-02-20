import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Dialog, Button, Text } from '@specboard/ui';
import { fetchClient } from '@specboard/fetch';
import styles from './ChangePasswordDialog.module.css';

interface SetPasswordDialogProps {
	open: boolean;
	onClose: () => void;
	userId: string;
	userName: string;
}

export function SetPasswordDialog({ open, onClose, userId, userName }: SetPasswordDialogProps): JSX.Element | null {
	const [newPassword, setNewPassword] = useState('');
	const [confirmPassword, setConfirmPassword] = useState('');
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

	const resetForm = (): void => {
		setNewPassword('');
		setConfirmPassword('');
		setMessage(null);
	};

	const handleClose = (): void => {
		resetForm();
		onClose();
	};

	// Validate password complexity to match backend requirements
	const hasUppercase = /[A-Z]/.test(newPassword);
	const hasLowercase = /[a-z]/.test(newPassword);
	const hasDigit = /\d/.test(newPassword);
	const hasSpecialChar = /[^A-Za-z0-9]/.test(newPassword);
	const meetsComplexity = newPassword.length >= 12 && hasUppercase && hasLowercase && hasDigit && hasSpecialChar;

	const handleSubmit = async (e: Event): Promise<void> => {
		e.preventDefault();
		setMessage(null);

		// Validate passwords match
		if (newPassword !== confirmPassword) {
			setMessage({ type: 'error', text: 'Passwords do not match' });
			return;
		}

		// Validate password complexity
		if (!meetsComplexity) {
			setMessage({ type: 'error', text: 'Password must be at least 12 characters with uppercase, lowercase, digit, and special character' });
			return;
		}

		setSaving(true);

		try {
			await fetchClient.put(`/api/users/${userId}`, {
				password: newPassword,
			});

			setMessage({ type: 'success', text: 'Password set successfully. User will need to log in again.' });

			// Close dialog after a short delay
			setTimeout(() => {
				handleClose();
			}, 2000);
		} catch (err: unknown) {
			const errorMessage = err instanceof Error ? err.message : 'Failed to set password';
			setMessage({ type: 'error', text: errorMessage });
		} finally {
			setSaving(false);
		}
	};

	const isValid = meetsComplexity &&
		confirmPassword.length > 0 &&
		newPassword === confirmPassword;

	return (
		<Dialog
			open={open}
			onClose={handleClose}
			title={`Set Password for ${userName}`}
			maxWidth="sm"
		>
			<form onSubmit={handleSubmit} class={styles.form}>
				{message && (
					<div class={`${styles.message} ${styles[message.type]}`}>
						{message.text}
					</div>
				)}

				<div class={styles.field}>
					<label class={styles.label} htmlFor="newPassword">
						New Password
					</label>
					<Text
						id="newPassword"
						type="password"
						value={newPassword}
						onInput={(e) => setNewPassword((e.target as HTMLInputElement).value)}
						autoComplete="new-password"
						required
					/>
					<span class={styles.hint}>
						At least 12 characters with uppercase, lowercase, digit, and special character
					</span>
				</div>

				<div class={styles.field}>
					<label class={styles.label} htmlFor="confirmPassword">
						Confirm Password
					</label>
					<Text
						id="confirmPassword"
						type="password"
						value={confirmPassword}
						onInput={(e) => setConfirmPassword((e.target as HTMLInputElement).value)}
						autoComplete="new-password"
						required
					/>
				</div>

				<div class={styles.actions}>
					<Button type="button" variant="secondary" onClick={handleClose}>
						Cancel
					</Button>
					<Button type="submit" disabled={!isValid || saving}>
						{saving ? 'Setting...' : 'Set Password'}
					</Button>
				</div>
			</form>
		</Dialog>
	);
}
