/**
 * Specboard marketing home page
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
				<a href="/" class="logo" aria-label="Specboard home">
					<span class="logo-text">Specboard</span>
				</a>
				<nav class="home-nav" aria-label="Main navigation">
					<a id="auth-link" href="/login" style="visibility: hidden">Sign In</a>
					<a href="/signup" class="btn-primary">Get Started</a>
				</nav>
			</header>

			<section class="hero">
				<span class="hero-badge">Workflow tools for AI assisted product development</span>
				<h1>Build better software with AI</h1>
				<p class="hero-subtitle">
					Specs, planning, and context management for developers working with AI coding agents.
					Give your AI the structure it needs to ship quality code.
				</p>
				<div class="hero-cta">
					<a href="/signup" class="btn-primary btn-large">Get Started Free</a>
					<a href="#features" class="btn-secondary btn-large">See How It Works</a>
				</div>
			</section>

			<section id="features" class="features">
				<h2>Two tools. One workflow.</h2>
				<p class="features-subtitle">
					Everything you need to define, plan, and build software with AI assistance.
				</p>
				<div class="feature-grid">
					<div class="feature-card">
						<div class="feature-icon">
							<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
								<polyline points="14 2 14 8 20 8"></polyline>
								<line x1="16" y1="13" x2="8" y2="13"></line>
								<line x1="16" y1="17" x2="8" y2="17"></line>
								<polyline points="10 9 9 9 8 9"></polyline>
							</svg>
						</div>
						<h3>Specs & Docs</h3>
						<p class="feature-tagline">Give your AI agent the context it needs</p>
						<ul class="feature-list">
							<li>Git-backed markdown with version control</li>
							<li>WYSIWYG and raw editing modes</li>
							<li>Inline comments for collaboration</li>
							<li>AI-powered writing assistance</li>
						</ul>
					</div>
					<div class="feature-card">
						<div class="feature-icon">
							<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<rect x="3" y="3" width="7" height="7"></rect>
								<rect x="14" y="3" width="7" height="7"></rect>
								<rect x="14" y="14" width="7" height="7"></rect>
								<rect x="3" y="14" width="7" height="7"></rect>
							</svg>
						</div>
						<h3>Planning</h3>
						<p class="feature-tagline">Track what you're building, what's for the AI</p>
						<ul class="feature-list">
							<li>Epic and task hierarchy</li>
							<li>Keyboard-first interface</li>
							<li>Lightweight and fast</li>
							<li>Link tasks to specs</li>
						</ul>
					</div>
				</div>
			</section>

			<section class="integrations">
				<h2>Built for AI workflows</h2>
				<div class="integration-grid">
					<div class="integration-card">
						<div class="integration-icon">
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M12 2L2 7l10 5 10-5-10-5z"></path>
								<path d="M2 17l10 5 10-5"></path>
								<path d="M2 12l10 5 10-5"></path>
							</svg>
						</div>
						<div class="integration-content">
							<h3>MCP Server</h3>
							<p>Connect your AI agent directly to Specboard via Model Context Protocol. Your agent can read specs, update tasks, and stay in sync.</p>
						</div>
					</div>
					<div class="integration-card">
						<div class="integration-icon">
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
								<path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
							</svg>
						</div>
						<div class="integration-content">
							<h3>OAuth Integration</h3>
							<p>Secure authentication for your AI agents. Grant scoped access to specific projects without sharing credentials.</p>
						</div>
					</div>
				</div>
			</section>

			<section class="how-it-works">
				<h2>How it works</h2>
				<div class="steps">
					<div class="step">
						<div class="step-number">1</div>
						<h3>Write your specs</h3>
						<p>Define requirements and context. Your AI agent references these to understand what you're building.</p>
					</div>
					<div class="step">
						<div class="step-number">2</div>
						<h3>Break into tasks</h3>
						<p>Organize work into epics and tasks. Link each task to the relevant specs for complete context.</p>
					</div>
					<div class="step">
						<div class="step-number">3</div>
						<h3>Build with AI</h3>
						<p>Hand off tasks to your AI coding agent with full context via MCP. Ship quality code faster.</p>
					</div>
				</div>
			</section>

			<section class="cta-section">
				<h2>Ready to build with AI?</h2>
				<p>Start organizing your development workflow today.</p>
				<a href="/signup" class="btn-primary btn-large">Get Started Free</a>
			</section>

			<footer class="home-footer">
				<p>&copy; 2025 Specboard. All rights reserved.</p>
			</footer>
		</div>
	);
}
