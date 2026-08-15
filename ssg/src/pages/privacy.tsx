/**
 * Privacy policy page content component
 */
import type { JSX } from 'preact';

export function PrivacyContent(): JSX.Element {
	return (
		<div class="privacy-container">
			<h1>Privacy Policy</h1>
			<p class="privacy-updated">Last updated: August 15, 2026</p>

			<p>
				Specboard is a documentation and project planning service operated at{' '}
				<a href="https://specboard.io">specboard.io</a>. This policy describes what
				information we collect and how we use it.
			</p>

			<h2>What we collect</h2>
			<p>
				When you create an account we collect your name, username, email address, and a
				password (stored only as a salted hash). The documents, projects, and planning
				items you create are stored so the service can show them back to you. If you
				connect a GitHub account, we store the authorization token needed to sync your
				repositories. Our servers keep standard operational logs (IP address, browser
				user agent, request paths) for security and debugging.
			</p>

			<h2>How we use it</h2>
			<p>
				Your information is used to operate Specboard: signing you in, storing your
				content, syncing with services you connect, and sending transactional email such
				as account verification and password reset messages. We do not send marketing
				email. We do not sell your data or share it with third parties for advertising.
			</p>

			<h2>Where it lives</h2>
			<p>
				Specboard runs on Amazon Web Services in the United States. Data is encrypted in
				transit, and stored with access limited to what the service needs to function.
			</p>

			<h2>Cookies</h2>
			<p>
				We use a session cookie to keep you signed in. There are no advertising or
				cross-site tracking cookies.
			</p>

			<h2>Your data, your call</h2>
			<p>
				You can delete your account at any time, which stops all email and removes your
				access. To request deletion of your data or ask anything about this policy,
				email <a href="mailto:admin@specboard.io">admin@specboard.io</a>.
			</p>

			<h2>Changes</h2>
			<p>
				If this policy changes in a way that matters, we will update this page and the
				date above.
			</p>

			<p class="privacy-home-link">
				<a href="/">Back to Specboard</a>
			</p>
		</div>
	);
}
