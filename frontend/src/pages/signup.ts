/**
 * Server-rendered signup page
 * Pure HTML/CSS/JS - no dependencies
 */

export interface SignupPageOptions {
	error?: string;
	email?: string;
	name?: string;
}

export function renderSignupPage(options: SignupPageOptions = {}): string {
	const { error, email = '', name = '' } = options;

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Sign Up - Doc Platform</title>
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

		.signup-container {
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

		.password-hint {
			font-size: 0.75rem;
			color: #888;
			margin-top: 0.25rem;
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

		.success {
			background: #efe;
			border: 1px solid #cfc;
			color: #060;
			padding: 0.75rem;
			border-radius: 4px;
			margin-bottom: 1rem;
			font-size: 0.875rem;
		}

		.message.hidden {
			display: none;
		}

		.login-link {
			text-align: center;
			margin-top: 1.5rem;
			font-size: 0.875rem;
			color: #666;
		}

		.login-link a {
			color: #0066cc;
			text-decoration: none;
		}

		.login-link a:hover {
			text-decoration: underline;
		}
	</style>
</head>
<body>
	<div class="signup-container">
		<h1>Create Account</h1>

		<div id="error" class="error message${error ? '' : ' hidden'}">${error || ''}</div>
		<div id="success" class="success message hidden"></div>

		<form id="signup-form">
			<div class="form-group">
				<label for="name">Name</label>
				<input
					type="text"
					id="name"
					name="name"
					value="${escapeHtml(name)}"
					required
					autocomplete="name"
				>
			</div>

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
					autocomplete="new-password"
					minlength="8"
				>
				<div class="password-hint">Min 8 characters, with upper, lower, and digit</div>
			</div>

			<button type="submit" id="submit-btn">Create Account</button>
		</form>

		<div class="login-link">
			Already have an account? <a href="/login">Sign in</a>
		</div>
	</div>

	<script>
		(function() {
			var form = document.getElementById('signup-form');
			var errorEl = document.getElementById('error');
			var successEl = document.getElementById('success');
			var submitBtn = document.getElementById('submit-btn');

			function showError(message) {
				errorEl.textContent = message;
				errorEl.classList.remove('hidden');
				successEl.classList.add('hidden');
			}

			function showSuccess(message) {
				successEl.textContent = message;
				successEl.classList.remove('hidden');
				errorEl.classList.add('hidden');
			}

			function hideMessages() {
				errorEl.classList.add('hidden');
				successEl.classList.add('hidden');
			}

			form.addEventListener('submit', function(e) {
				e.preventDefault();
				hideMessages();

				var name = document.getElementById('name').value;
				var email = document.getElementById('email').value;
				var password = document.getElementById('password').value;

				submitBtn.disabled = true;
				submitBtn.textContent = 'Creating account...';

				fetch('/auth/signup', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name: name, email: email, password: password }),
					credentials: 'same-origin'
				})
				.then(function(res) {
					return res.json().then(function(data) {
						return { ok: res.ok, data: data };
					});
				})
				.then(function(result) {
					if (result.ok) {
						showSuccess('Account created! Check your email to verify.');
						form.reset();
						submitBtn.disabled = false;
						submitBtn.textContent = 'Create Account';
					} else {
						showError(result.data.error || 'Signup failed');
						submitBtn.disabled = false;
						submitBtn.textContent = 'Create Account';
					}
				})
				.catch(function() {
					showError('Network error. Please try again.');
					submitBtn.disabled = false;
					submitBtn.textContent = 'Create Account';
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
