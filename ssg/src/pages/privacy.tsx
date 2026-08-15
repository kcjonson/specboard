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
				<a href="https://specboard.io">specboard.io</a>. Specboard is the data
				controller for the personal data described here; you can reach us at{' '}
				<a href="mailto:admin@specboard.io">admin@specboard.io</a>. Wherever you are
				located, we apply the standards of the EU General Data Protection Regulation
				(GDPR) to your personal data.
			</p>

			<h2>What we collect</h2>
			<p>
				Account data: your name, username, email address, and a password stored only as
				a salted hash. Content: the documents, projects, and planning items you create.
				If you connect a GitHub account, the authorization token needed to sync your
				repositories. Server logs: IP address, browser user agent, and request paths.
				One session cookie to keep you signed in.
			</p>

			<h2>Why we process it, and on what legal basis</h2>
			<p>
				Account data, your content, and transactional email (account verification and
				password reset messages) are processed because they are necessary to provide the
				service you signed up for (GDPR Article 6(1)(b), performance of a contract).
				The GitHub connection works the same way: it exists only if you initiate it, to
				provide the sync feature you requested. Server logs are processed for our
				legitimate interest in security, abuse prevention, and debugging (Article
				6(1)(f)). We send no marketing email, run no analytics, and make no automated
				decisions about you.
			</p>

			<h2>Who we share it with</h2>
			<p>
				We do not sell, rent, or trade your personal information, and we do not share it
				with third parties for their own purposes. We use a small number of
				infrastructure providers who process data on our behalf and under our
				instructions: Amazon Web Services (hosting and storage) and Amazon SES
				(transactional email delivery). These providers are contractually bound as data
				processors and may not use your data for anything else. We have no other
				third-party data agreements and don't plan to add any; if that ever changes,
				this policy changes first (see "Changes" below).
			</p>

			<h2>Where your data lives</h2>
			<p>
				Specboard is operated from the United States and data is stored on Amazon Web
				Services in the US (Oregon, us-west-2). If you access the service from the
				EU/EEA, UK, or Switzerland, your data is transferred to the US. AWS participates
				in the EU-US Data Privacy Framework and processes data under a Data Processing
				Addendum incorporating the EU Standard Contractual Clauses. Data is encrypted in
				transit and at rest.
			</p>

			<h2>How long we keep it</h2>
			<p>
				Account data and content are kept until you delete your account. Standard server
				logs are deleted after 30 days; error logs are kept for up to one year for
				security and debugging. Database backups are retained for a few days and then
				expire automatically.
			</p>

			<h2>Your rights</h2>
			<p>
				You can ask us for access to the personal data we hold about you, correction,
				deletion, a portable copy, restriction of processing, or object to processing
				based on legitimate interest. Where processing rests on consent, you can
				withdraw it at any time. Email{' '}
				<a href="mailto:admin@specboard.io">admin@specboard.io</a> and we will respond
				within a month. If you are in the EU/EEA or UK, you also have the right to
				lodge a complaint with your data protection supervisory authority.
			</p>

			<h2>Cookies</h2>
			<p>
				We set one strictly necessary session cookie so you stay signed in. There are no
				advertising, analytics, or cross-site tracking cookies, which is why you don't
				see a cookie banner.
			</p>

			<h2>Deleting your account</h2>
			<p>
				Deleting your account stops all email and removes your access, and your data is
				removed on the schedule above. You can also request deletion by emailing{' '}
				<a href="mailto:admin@specboard.io">admin@specboard.io</a>.
			</p>

			<h2>Changes</h2>
			<p>
				We may update this policy. The date at the top reflects the current version. For
				material changes (new categories of data, new purposes, or new recipients), we
				will notify account holders by email at least 30 days before the change takes
				effect. Where a change requires your consent under applicable law, we will ask
				for it rather than assume it.
			</p>

			<p class="privacy-home-link">
				<a href="/">Back to Specboard</a>
			</p>
		</div>
	);
}
