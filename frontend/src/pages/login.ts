/**
 * Server-rendered login page
 * Pure HTML/CSS/JS - no dependencies
 */

export interface LoginPageOptions {
	error?: string;
	email?: string;
}

export function renderLoginPage(options: LoginPageOptions = {}): string {
	const { error, email = '' } = options;

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Login - Doc Platform</title>
	<style>
		* {
			box-sizing: border-box;
			margin: 0;
			padding: 0;
		}

		body {
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
			background: #f5f5f5;
			min-height: 100vh;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 1rem;
		}

		.login-container {
			background: white;
			border-radius: 8px;
			box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
			padding: 2rem;
			width: 100%;
			max-width: 400px;
		}

		h1 {
			font-size: 1.5rem;
			font-weight: 600;
			margin-bottom: 1.5rem;
			text-align: center;
			color: #333;
		}

		.form-group {
			margin-bottom: 1rem;
		}

		label {
			display: block;
			font-size: 0.875rem;
			font-weight: 500;
			margin-bottom: 0.5rem;
			color: #555;
		}

		input {
			width: 100%;
			padding: 0.75rem;
			font-size: 1rem;
			border: 1px solid #ddd;
			border-radius: 4px;
			transition: border-color 0.15s;
		}

		input:focus {
			outline: none;
			border-color: #0066cc;
		}

		button {
			width: 100%;
			padding: 0.75rem;
			font-size: 1rem;
			font-weight: 500;
			color: white;
			background: #0066cc;
			border: none;
			border-radius: 4px;
			cursor: pointer;
			transition: background 0.15s;
		}

		button:hover {
			background: #0052a3;
		}

		button:disabled {
			background: #999;
			cursor: not-allowed;
		}

		.error {
			background: #fee;
			border: 1px solid #fcc;
			color: #c00;
			padding: 0.75rem;
			border-radius: 4px;
			margin-bottom: 1rem;
			font-size: 0.875rem;
		}

		.error.hidden {
			display: none;
		}
	</style>
</head>
<body>
	<div class="login-container">
		<h1>Sign In</h1>

		<div id="error" class="error${error ? '' : ' hidden'}">${error ? escapeHtml(error) : ''}</div>

		<form id="login-form">
			<div class="form-group">
				<label for="email">Email</label>
				<input
					type="email"
					id="email"
					name="email"
					value="${escapeHtml(email)}"
					required
					autocomplete="email"
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

				var email = document.getElementById('email').value;
				var password = document.getElementById('password').value;

				submitBtn.disabled = true;
				submitBtn.textContent = 'Signing in...';

				fetch('/api/auth/login', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ email: email, password: password }),
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
