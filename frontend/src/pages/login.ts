/**
 * Server-rendered login page
 * Pure HTML/CSS/JS - no dependencies
 */

export interface LoginPageOptions {
	error?: string;
	identifier?: string;
	sharedCssPath?: string;
	loginCssPath?: string;
}

export function renderLoginPage(options: LoginPageOptions = {}): string {
	const { error, identifier = '', sharedCssPath, loginCssPath } = options;

	// Build CSS links from manifest paths
	const cssLinks = [sharedCssPath, loginCssPath]
		.filter(Boolean)
		.map(path => `<link rel="stylesheet" href="${path}">`)
		.join('\n\t');

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Login - Doc Platform</title>
	${cssLinks}
</head>
<body>
	<div class="login-container">
		<h1>Sign In</h1>

		<div id="error" class="error-message${error ? '' : ' hidden'}">${error ? escapeHtml(error) : ''}</div>

		<form id="login-form">
			<div class="form-group">
				<label for="identifier">Username or Email</label>
				<input
					type="text"
					id="identifier"
					name="identifier"
					value="${escapeHtml(identifier)}"
					required
					autocomplete="username"
				>
			</div>

			<div class="form-group">
				<label for="password">Password</label>
				<input
					type="password"
					id="password"
					name="password"
					required
					autocomplete="current-password"
				>
			</div>

			<button type="submit" id="submit-btn">Sign In</button>
		</form>

		<div class="signup-link">
			Don't have an account? <a href="/signup">Create one</a>
		</div>

	</div>

	<script>
		(function() {
			var form = document.getElementById('login-form');
			var errorEl = document.getElementById('error');
			var submitBtn = document.getElementById('submit-btn');

			function showError(message) {
				errorEl.textContent = message;
				errorEl.classList.remove('hidden');
			}

			function hideError() {
				errorEl.classList.add('hidden');
			}

			form.addEventListener('submit', function(e) {
				e.preventDefault();
				hideError();

				var identifier = document.getElementById('identifier').value;
				var password = document.getElementById('password').value;

				submitBtn.disabled = true;
				submitBtn.textContent = 'Signing in...';

				fetch('/api/auth/login', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ identifier: identifier, password: password }),
					credentials: 'same-origin'
				})
				.then(function(res) {
					return res.json().then(function(data) {
						return { ok: res.ok, data: data };
					});
				})
				.then(function(result) {
					if (result.ok) {
						window.location.href = '/';
					} else {
						showError(result.data.error || 'Login failed');
						submitBtn.disabled = false;
						submitBtn.textContent = 'Sign In';
					}
				})
				.catch(function() {
					showError('Network error. Please try again.');
					submitBtn.disabled = false;
					submitBtn.textContent = 'Sign In';
				});
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
