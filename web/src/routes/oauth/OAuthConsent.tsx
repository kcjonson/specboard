import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@doc-platform/router';
import { Button } from '@doc-platform/ui';
import { useAuth, getCsrfToken } from '@shared/planning';
import styles from './OAuthConsent.module.css';

// Scope descriptions for display
const SCOPE_DESCRIPTIONS: Record<string, string> = {
	'docs:read': 'Read your documents',
	'docs:write': 'Create and modify documents',
	'tasks:read': 'Read your tasks and epics',
	'tasks:write': 'Create and update tasks',
};

// Client display names
const CLIENT_NAMES: Record<string, string> = {
	'claude-code': 'Claude Code',
	'doc-platform-cli': 'Doc Platform CLI',
};

export function OAuthConsent(_props: RouteProps): JSX.Element {
	const [deviceName, setDeviceName] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Use auth hook to fetch CSRF token (required for form submission)
	const { loading: authLoading } = useAuth();

	// Parse OAuth params from URL
	const params = new URLSearchParams(window.location.search);
	const clientId = params.get('client_id') || '';
	const redirectUri = params.get('redirect_uri') || '';
	const scope = params.get('scope') || '';
	const state = params.get('state') || '';
	const codeChallenge = params.get('code_challenge') || '';
	const codeChallengeMethod = params.get('code_challenge_method') || '';

	const clientName = CLIENT_NAMES[clientId] || clientId;
	const scopes = scope.split(' ').filter(Boolean);

	// Show loading while fetching auth/CSRF token
	if (authLoading) {
		return (
			<div class={styles.container}>
				<div class={styles.card}>
					<div class={styles.loading}>Loading...</div>
				</div>
			</div>
		);
	}

	// Validate required params
	if (!clientId || !redirectUri || !codeChallenge) {
		return (
			<div class={styles.container}>
				<div class={styles.card}>
					<div class={styles.error}>
						Invalid authorization request. Missing required parameters.
					</div>
				</div>
			</div>
		);
	}

	const handleSubmit = async (action: 'approve' | 'deny'): Promise<void> => {
		if (action === 'approve' && !deviceName.trim()) {
			setError('Please enter a device name');
			return;
		}

		setSubmitting(true);
		setError(null);

		try {
			const formData = new URLSearchParams({
				client_id: clientId,
				redirect_uri: redirectUri,
				scope,
				state,
				code_challenge: codeChallenge,
				code_challenge_method: codeChallengeMethod,
				device_name: deviceName.trim(),
				action,
			});

			// Build headers with CSRF token
			const headers: Record<string, string> = {
				'Content-Type': 'application/x-www-form-urlencoded',
			};
			const csrfToken = getCsrfToken();
			if (csrfToken) {
				headers['X-CSRF-Token'] = csrfToken;
			}

			const response = await fetch('/oauth/authorize', {
				method: 'POST',
				headers,
				body: formData.toString(),
				credentials: 'same-origin',
				redirect: 'manual',
			});

			// Handle redirect response (3xx status with Location header)
			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.get('Location');
				if (location) {
					window.location.href = location;
					return;
				}
			}

			// Handle opaqueredirect (shouldn't happen with redirect: 'manual', but be defensive)
			if (response.type === 'opaqueredirect') {
				// Cannot access redirect URL from opaqueredirect, show error
				setError('Redirect failed. Please try again.');
				return;
			}

			// Handle error response
			if (!response.ok) {
				let errorMessage = 'Authorization failed';
				try {
					const data = await response.json();
					errorMessage = data.error_description || data.error || errorMessage;
				} catch {
					// Response wasn't JSON, use default message
				}
				setError(errorMessage);
			}
		} catch {
			setError('Network error. Please try again.');
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div class={styles.container}>
			<div class={styles.card}>
				<div class={styles.header}>
					<h1 class={styles.title}>Authorize Application</h1>
				</div>

				{error && <div class={styles.error}>{error}</div>}

				<div class={styles.clientInfo}>
					<span class={styles.clientIcon}>🤖</span>
					<div>
						<div class={styles.clientName}>{clientName}</div>
						<div class={styles.clientDesc}>wants access to your account</div>
					</div>
				</div>

				<div class={styles.formGroup}>
					<label class={styles.label} htmlFor="device_name">Device Name</label>
					<input
						type="text"
						id="device_name"
						class={styles.input}
						placeholder="e.g., Work MacBook Pro"
						value={deviceName}
						onInput={(e) => setDeviceName((e.target as HTMLInputElement).value)}
						maxLength={255}
						autoComplete="off"
						autoFocus
					/>
					<div class={styles.hint}>Give this device a name so you can identify it later</div>
				</div>

				<div class={styles.permissions}>
					<h2 class={styles.permissionsTitle}>This will allow {clientName} to:</h2>
					<ul class={styles.permissionsList}>
						{scopes.map((s) => (
							<li key={s} class={styles.permissionItem}>
								{SCOPE_DESCRIPTIONS[s] || s}
							</li>
						))}
					</ul>
				</div>

				<div class={styles.buttonGroup}>
					<Button
						onClick={() => handleSubmit('deny')}
						class={styles.denyButton}
						disabled={submitting}
					>
						Deny
					</Button>
					<Button
						onClick={() => handleSubmit('approve')}
						class={styles.approveButton}
						disabled={submitting}
					>
						{submitting ? 'Authorizing...' : 'Approve'}
					</Button>
				</div>
			</div>
		</div>
	);
}
