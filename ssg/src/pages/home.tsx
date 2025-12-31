/**
 * Marketing home page content component
 */
import type { JSX } from 'preact';

/**
 * Script to update Sign In link when user is already logged in.
 * Checks for session_id cookie and changes link to "Open App" pointing to root.
 * Link starts hidden to prevent flash of wrong text.
 */
export const homeScript = `
(function() {
	var link = document.getElementById('auth-link');
	if (!link) return;
	var cookies = document.cookie ? document.cookie.split('; ') : [];
	var hasSession = cookies.some(function(c) { return c.indexOf('session_id=') === 0; });
	if (hasSession) {
		link.href = '/';
		link.textContent = 'Open App';
	}
	link.style.visibility = 'visible';
})();
`;

export function HomeContent(): JSX.Element {
	return (
		<div class="home-container">
			<header class="home-header">
				<a href="/" class="logo" aria-label="Doc Platform home">Doc Platform</a>
				<nav class="home-nav" aria-label="Main navigation">
					<a id="auth-link" href="/login" style="visibility: hidden">Sign In</a>
					<a href="/signup" class="btn-primary">Get Started</a>
				</nav>
			</header>

			<section class="hero">
				<h1>Documentation that works for your team</h1>
				<p class="hero-subtitle">
					A Git-backed markdown editor with real-time collaboration,
					inline comments, and AI-powered assistance.
				</p>
				<div class="hero-cta">
					<a href="/signup" class="btn-primary btn-large">Start for Free</a>
					<a href="#features" class="btn-secondary btn-large">Learn More</a>
				</div>
			</section>

			<section id="features" class="features">
				<h2>Everything you need</h2>
				<div class="feature-grid">
					<div class="feature-card">
						<h3>Git-Backed</h3>
						<p>Your docs live in your repository. Version control, branching, and PRs - just like your code.</p>
					</div>
					<div class="feature-card">
						<h3>WYSIWYG & Raw Mode</h3>
						<p>Switch between rich editing and raw markdown. Work the way that suits you best.</p>
					</div>
					<div class="feature-card">
						<h3>Inline Comments</h3>
						<p>Review and discuss documentation changes with Google Docs-style inline comments.</p>
					</div>
					<div class="feature-card">
						<h3>AI Assistance</h3>
						<p>Get writing suggestions, improvements, and answers powered by Claude.</p>
					</div>
				</div>
			</section>

			<footer class="home-footer">
				<p>&copy; 2024 Doc Platform. All rights reserved.</p>
			</footer>
		</div>
	);
}
