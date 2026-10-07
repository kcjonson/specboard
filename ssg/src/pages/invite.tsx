/**
 * Project invitation landing page, opened from the invite email (/invite?token=...).
 *
 * Built on the magic-link pattern: the page itself is static and an inline script reads
 * the token. Looking the invite up is a GET with no side effects, and accepting or
 * declining are POSTs from a click, so a mail scanner prefetching the link changes
 * nothing.
 *
 * What it shows depends on the visitor (docs/specs/multi-user-collaboration.md,
 * Accepting): signed in as the invited address, Accept and Decline; signed in as
 * someone else, the masked address and Switch account; signed out, Sign in and Create
 * account side by side, since telling a signed-out visitor whether the address has an
 * account would leak it, and both flows land back here; and for an invite that is
 * expired, revoked or used, which of those it is. A signed-in account that hasn't
 * finished onboarding is sent there first, with this page as its next stop.
 */
import type { JSX } from 'preact';
import { BrandLogo } from '../components/logo';

export function InviteContent(): JSX.Element {
	return (
		<div class="auth-container invite-container">
			<div class="auth-brand">
				<BrandLogo size={40} href="/" />
			</div>

			<h1 id="title">Opening your invite...</h1>

			<div id="loading" class="loading-state">
				<p>Just a moment.</p>
			</div>

			<div id="card" class="invite-card hidden">
				<p id="summary" class="invite-summary" />
				<p id="owner" class="invite-owner hidden" />
			</div>

			<div id="error" class="message-box error hidden" role="alert" />

			<div id="answer" class="invite-actions hidden">
				<button type="button" id="accept-btn">Accept</button>
				<button type="button" id="decline-btn" class="secondary">Decline</button>
			</div>

			<div id="signed-out" class="invite-actions hidden">
				<a id="signin-link" class="btn" href="/login">Sign in to accept</a>
				<a id="signup-link" class="btn secondary" href="/signup">Create account</a>
				<p class="note">
					New to Specboard? Create an account with the address the invite was
					sent to, <span id="signed-out-email" />.
				</p>
			</div>

			<div id="wrong-account" class="invite-actions hidden">
				<p id="wrong-account-text" class="description" />
				<button type="button" id="switch-btn">Switch account</button>
			</div>

			<div id="closed" class="result-state hidden">
				<p id="closed-text" />
				<p id="closed-hint" class="redirect-note" />
			</div>

			<div id="declined" class="result-state hidden">
				<p>You declined the invite. Nothing was added to your account.</p>
				<a href="/" class="btn">Go to Specboard</a>
			</div>

			<div id="invalid" class="result-state hidden">
				<p>This invite link isn't valid.</p>
				<p class="redirect-note">Check that you opened the whole link from the email, or ask for a new invite.</p>
			</div>
		</div>
	);
}

export const inviteScript = `(function() {
	var params = new URLSearchParams(window.location.search);
	var token = params.get('token');
	var invitePath = '/invite?token=' + encodeURIComponent(token || '');

	function el(id) { return document.getElementById(id); }
	function show(id) { el(id).classList.remove('hidden'); }
	function hide(id) { el(id).classList.add('hidden'); }

	var CLOSED_TEXT = {
		expired: 'This invite has expired.',
		revoked: 'This invite was revoked.',
		accepted: 'This invite has already been used.',
		declined: 'This invite was declined.'
	};

	function setTitle(text) { el('title').textContent = text; }

	function showError(message) {
		el('error').textContent = message;
		show('error');
	}

	function showInvalid() {
		hide('loading');
		setTitle('Invite not found');
		show('invalid');
	}

	function csrfToken() {
		var match = document.cookie.match(/(?:^|; )csrf_token=([^;]*)/);
		return match ? decodeURIComponent(match[1]) : '';
	}

	function parseJson(res) {
		return res.json().then(function(data) {
			return { ok: res.ok, status: res.status, data: data };
		}, function() {
			return { ok: false, status: res.status, data: {} };
		});
	}

	function post(path, body) {
		return fetch(path, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
			body: JSON.stringify(body),
			credentials: 'same-origin'
		}).then(parseJson);
	}

	function toOnboarding() {
		window.location.replace('/onboarding?next=' + encodeURIComponent(invitePath));
	}

	function showCard(invite) {
		var asRole = invite.role === 'editor' ? 'as an editor' : 'as a viewer';
		el('summary').textContent = invite.inviterName + ' invited you to ' + invite.projectName + ' ' + asRole + '.';
		if (invite.ownerName !== invite.inviterName) {
			el('owner').textContent = invite.projectName + ' belongs to ' + invite.ownerName + '.';
			show('owner');
		}
		show('card');
	}

	function setBusy(busy) {
		el('accept-btn').disabled = busy;
		el('decline-btn').disabled = busy;
	}

	function render(invite, user) {
		hide('loading');

		if (invite.state !== 'open') {
			setTitle('This invite can\\'t be used');
			el('closed-text').textContent = CLOSED_TEXT[invite.state] || 'This invite is no longer open.';
			el('closed-hint').textContent = 'Ask ' + invite.inviterName + ' to send a new invite.';
			show('closed');
			return;
		}

		setTitle('You\\'re invited');
		showCard(invite);

		if (!user) {
			el('signin-link').href = '/login?next=' + encodeURIComponent(invitePath);
			el('signup-link').href = '/signup?invite=' + encodeURIComponent(token);
			el('signed-out-email').textContent = invite.email;
			show('signed-out');
			return;
		}

		if (!invite.addressedToYou) {
			el('wrong-account-text').textContent = 'This invite was sent to ' + invite.email +
				'. You\\'re signed in as ' + user.email + '.';
			show('wrong-account');
			return;
		}

		if (!user.profile_complete) {
			toOnboarding();
			return;
		}

		show('answer');
	}

	if (!token) {
		showInvalid();
		return;
	}

	el('accept-btn').addEventListener('click', function() {
		hide('error');
		setBusy(true);
		post('/api/invite/accept', { token: token }).then(function(result) {
			if (result.ok) {
				window.location.href = '/projects/' + result.data.project.ref + '/planning';
				return;
			}
			if (result.data.code === 'ONBOARDING_REQUIRED') {
				toOnboarding();
				return;
			}
			setBusy(false);
			showError(result.data.error || 'Could not accept the invite. Please try again.');
		}).catch(function() {
			setBusy(false);
			showError('Network error. Please try again.');
		});
	});

	el('decline-btn').addEventListener('click', function() {
		hide('error');
		setBusy(true);
		post('/api/invite/decline', { token: token }).then(function(result) {
			if (result.ok) {
				hide('card');
				hide('answer');
				setTitle('Invite declined');
				show('declined');
				return;
			}
			setBusy(false);
			showError(result.data.error || 'Could not decline the invite. Please try again.');
		}).catch(function() {
			setBusy(false);
			showError('Network error. Please try again.');
		});
	});

	// Signing out returns here, signed out, to sign in as the invited address.
	el('switch-btn').addEventListener('click', function() {
		el('switch-btn').disabled = true;
		fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
		.then(function() { window.location.reload(); })
		.catch(function() {
			el('switch-btn').disabled = false;
			showError('Network error. Please try again.');
		});
	});

	Promise.all([
		fetch('/api/invite?token=' + encodeURIComponent(token), { credentials: 'same-origin' }).then(parseJson),
		fetch('/api/auth/me', { credentials: 'same-origin' }).then(parseJson)
	]).then(function(results) {
		var lookup = results[0];
		var me = results[1];
		if (lookup.status === 404) {
			showInvalid();
			return;
		}
		if (!lookup.ok) {
			hide('loading');
			showError(lookup.data.error || 'Could not load the invite. Please reload the page.');
			return;
		}
		render(lookup.data, me.ok ? me.data.user : null);
	}).catch(function() {
		hide('loading');
		showError('Network error. Please reload the page.');
	});
})();`;
