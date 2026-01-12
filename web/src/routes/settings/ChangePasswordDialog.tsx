import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Dialog, Button, Text } from '@doc-platform/ui';
import { fetchClient } from '@doc-platform/fetch';
import styles from './ChangePasswordDialog.module.css';

interface ChangePasswordDialogProps {
	open: boolean;
	onClose: () => void;
}

export function ChangePasswordDialog({ open, onClose }: ChangePasswordDialogProps): JSX.Element | null {
	const [currentPassword, setCurrentPassword] = useState('');
	const [newPassword, setNewPassword] = useState('');
	const [confirmPassword, setConfirmPassword] = useState('');
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

	const resetForm = (): void => {
		setCurrentPassword('');
		setNewPassword('');
		setConfirmPassword('');
		setMessage(null);
	};

	const handleClose = (): void => {
		resetForm();
		onClose();
	};

	const handleSubmit = async (e: Event): Promise<void> => {
		e.preventDefault();
		setMessage(null);

		// Validate passwords match
		if (newPassword !== confirmPassword) {
			setMessage({ type: 'error', text: 'New passwords do not match' });
			return;
		}

		// Validate password length
		if (newPassword.length < 12) {
			setMessage({ type: 'error', text: 'Password must be at least 12 characters' });
			return;
		}

		setSaving(true);

		try {
			await fetchClient.put('/api/auth/change-password', {
				current_password: currentPassword,
				new_password: newPassword,
			});

			setMessage({ type: 'success', text: 'Password changed successfully' });

			// Close dialog after a short delay
			setTimeout(() => {
				handleClose();
			}, 1500);
		} catch (err: unknown) {
			const errorMessage = err instanceof Error ? err.message : 'Failed to change password';
			setMessage({ type: 'error', text: errorMessage });
		} finally {
			setSaving(false);
		}
	};

	const isValid = currentPassword.length > 0 &&
		newPassword.length >= 12 &&
		confirmPassword.length > 0 &&
		newPassword === confirmPassword;

	return (
		<Dialog
			open={open}
			onClose={handleClose}
			title="Change Password"
			maxWidth="sm"
		>
			<form onSubmit={handleSubmit} class={styles.form}>
				{message && (
					<div class={`${styles.message} ${styles[message.type]}`}>
						{message.text}
					</div>
				)}

				<div class={styles.field}>
					<label class={styles.label} htmlFor="currentPassword">
						Current Password
					</label>
					<Text
						id="currentPassword"
						type="password"
						value={currentPassword}
						onInput={(e) => setCurrentPassword((e.target as HTMLInputElement).value)}
						autoComplete="current-password"
						required
					/>
				</div>

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
						At least 12 characters
					</span>
				</div>

				<div class={styles.field}>
					<label class={styles.label} htmlFor="confirmPassword">
						Confirm New Password
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
						{saving ? 'Changing...' : 'Change Password'}
					</Button>
				</div>
			</form>
		</Dialog>
	);
}
