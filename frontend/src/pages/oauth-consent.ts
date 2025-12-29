/**
 * Server-rendered OAuth consent page
 * Allows users to approve/deny MCP authorization and name their device
 */

export interface OAuthConsentPageOptions {
	clientId: string;
	redirectUri: string;
	scope: string;
	state: string;
	codeChallenge: string;
	codeChallengeMethod: string;
	userDisplayName: string;
	error?: string;
	sharedCssPath?: string;
	oauthConsentCssPath?: string;
}

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

export function renderOAuthConsentPage(options: OAuthConsentPageOptions): string {
	const {
		clientId,
		redirectUri,
		scope,
		state,
		codeChallenge,
		codeChallengeMethod,
		userDisplayName,
		error,
		sharedCssPath,
		oauthConsentCssPath,
	} = options;

	const clientName = CLIENT_NAMES[clientId] || clientId;
	const scopes = scope.split(' ').filter(Boolean);
	const scopeListHtml = scopes
		.map(s => `<li>${escapeHtml(SCOPE_DESCRIPTIONS[s] || s)}</li>`)
		.join('\n\t\t\t\t');

	// Build CSS links
	const cssLinks = [sharedCssPath, oauthConsentCssPath]
		.filter(Boolean)
		.map(path => `<link rel="stylesheet" href="${path}">`)
		.join('\n\t');

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Authorize ${escapeHtml(clientName)} - Doc Platform</title>
	${cssLinks}
	<style>
		* { box-sizing: border-box; margin: 0; padding: 0; }
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			background: var(--color-background, #f5f5f5);
			min-height: 100vh;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 1rem;
		}
		.consent-container {
			background: var(--color-surface, white);
			border-radius: 8px;
			box-shadow: 0 2px 8px rgba(0,0,0,0.1);
			max-width: 420px;
			width: 100%;
			padding: 2rem;
		}
		.consent-header {
			text-align: center;
			margin-bottom: 1.5rem;
		}
		.consent-header h1 {
			font-size: 1.25rem;
			color: var(--color-text, #333);
			margin-bottom: 0.5rem;
		}
		.consent-header .user-info {
			font-size: 0.875rem;
			color: var(--color-text-secondary, #666);
		}
		.client-info {
			display: flex;
			align-items: center;
			gap: 1rem;
			padding: 1rem;
			background: var(--color-background, #f5f5f5);
			border-radius: 6px;
			margin-bottom: 1.5rem;
		}
		.client-icon {
			font-size: 2rem;
		}
		.client-name {
			font-weight: 600;
			color: var(--color-text, #333);
		}
		.client-desc {
			font-size: 0.875rem;
			color: var(--color-text-secondary, #666);
		}
		.form-group {
			margin-bottom: 1.5rem;
		}
		.form-group label {
			display: block;
			font-weight: 500;
			margin-bottom: 0.5rem;
			color: var(--color-text, #333);
		}
		.form-group input {
			width: 100%;
			padding: 0.75rem;
			border: 1px solid var(--color-border, #ddd);
			border-radius: 6px;
			font-size: 1rem;
		}
		.form-group input:focus {
			outline: none;
			border-color: var(--color-primary, #0066cc);
			box-shadow: 0 0 0 2px rgba(0,102,204,0.2);
		}
		.form-group .hint {
			font-size: 0.75rem;
			color: var(--color-text-secondary, #666);
			margin-top: 0.25rem;
		}
		.permissions {
			margin-bottom: 1.5rem;
		}
		.permissions h2 {
			font-size: 0.875rem;
			font-weight: 500;
			color: var(--color-text-secondary, #666);
			margin-bottom: 0.75rem;
		}
		.permissions ul {
			list-style: none;
			padding: 0;
		}
		.permissions li {
			padding: 0.5rem 0;
			padding-left: 1.5rem;
			position: relative;
			color: var(--color-text, #333);
		}
		.permissions li::before {
			content: '✓';
			position: absolute;
			left: 0;
			color: var(--color-success, #22c55e);
			font-weight: bold;
		}
		.button-group {
			display: flex;
			gap: 0.75rem;
		}
		button {
			flex: 1;
			padding: 0.75rem 1rem;
			border-radius: 6px;
			font-size: 1rem;
			font-weight: 500;
			cursor: pointer;
			transition: background-color 0.15s;
		}
		button[type="submit"] {
			background: var(--color-primary, #0066cc);
			color: white;
			border: none;
		}
		button[type="submit"]:hover {
			background: var(--color-primary-hover, #0052a3);
		}
		button[name="action"][value="deny"] {
			background: transparent;
			border: 1px solid var(--color-border, #ddd);
			color: var(--color-text, #333);
		}
		button[name="action"][value="deny"]:hover {
			background: var(--color-background, #f5f5f5);
		}
		.error-message {
			background: var(--color-error-bg, #fef2f2);
			color: var(--color-error, #dc2626);
			padding: 0.75rem;
			border-radius: 6px;
			margin-bottom: 1rem;
			font-size: 0.875rem;
		}
		.error-message.hidden { display: none; }
	</style>
</head>
<body>
	<div class="consent-container">
		<div class="consent-header">
			<h1>Authorize Application</h1>
			<div class="user-info">Signed in as ${escapeHtml(userDisplayName)}</div>
		</div>

		<div id="error" class="error-message${error ? '' : ' hidden'}">${error ? escapeHtml(error) : ''}</div>

		<div class="client-info">
			<span class="client-icon">🤖</span>
			<div>
				<div class="client-name">${escapeHtml(clientName)}</div>
				<div class="client-desc">wants access to your account</div>
			</div>
		</div>

		<form id="consent-form" method="POST" action="/oauth/authorize">
			<input type="hidden" name="client_id" value="${escapeHtml(clientId)}">
			<input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
			<input type="hidden" name="scope" value="${escapeHtml(scope)}">
			<input type="hidden" name="state" value="${escapeHtml(state)}">
			<input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}">
			<input type="hidden" name="code_challenge_method" value="${escapeHtml(codeChallengeMethod)}">

			<div class="form-group">
				<label for="device_name">Device Name</label>
				<input
					type="text"
					id="device_name"
					name="device_name"
					placeholder="e.g., Work MacBook Pro"
					required
					maxlength="255"
					autocomplete="off"
				>
				<div class="hint">Give this device a name so you can identify it later</div>
			</div>

			<div class="permissions">
				<h2>This will allow ${escapeHtml(clientName)} to:</h2>
				<ul>
				${scopeListHtml}
				</ul>
			</div>

			<div class="button-group">
				<button type="submit" name="action" value="deny">Deny</button>
				<button type="submit" name="action" value="approve">Approve</button>
			</div>
		</form>
	</div>

	<script>
		(function() {
			var form = document.getElementById('consent-form');
			var deviceInput = document.getElementById('device_name');
			var errorEl = document.getElementById('error');

			// Focus device name input
			deviceInput.focus();

			// Client-side validation
			form.addEventListener('submit', function(e) {
				var action = e.submitter ? e.submitter.value : 'approve';

				// Skip validation for deny
				if (action === 'deny') return;

				var deviceName = deviceInput.value.trim();
				if (!deviceName) {
					e.preventDefault();
					errorEl.textContent = 'Please enter a device name';
					errorEl.classList.remove('hidden');
					deviceInput.focus();
				}
			});
		})();
	</script>
</body>
</html>`;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}
