/**
 * Project invitation landing page, opened from the invite email (/invite?token=...).
 *
 * Built on the magic-link pattern: the page itself is static and an inline script reads
 * the token. Looking the invite up is a GET with no side effects, and accepting or
 * declining are POSTs from a click, so a mail scanner prefetching the link changes
 * nothing.
 *
 * The token only finds the invitation. Every hop after that (sign in, sign up,
 * onboarding) comes back as /invite?id=<invitation id>, which the page reads through
 * the session, and answering goes by id too, so the raw token is never stored as
 * anyone's next path. Once the lookup says the invite is the signed-in account's, the
 * token is dropped from the address bar as well.
 *
 * What it shows depends on the visitor (docs/specs/multi-user-collaboration.md,
 * Accepting): signed in as the invited address, Accept and Decline; signed in as
 * someone else, the masked address and Switch account; signed out, Sign in and Create
 * account side by side, since telling a signed-out visitor whether the address has an
 * account would leak it, and both flows land back here; and for an invite that is
 * expired, revoked or used, which of those it is. Its own recipient instead gets a link
 * to the project they joined, or is sent on to the open invite that replaced a revoked
 * or expired one. A signed-in account that hasn't finished onboarding is sent there
 * first, with this page as its next stop.
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
				<a id="closed-link" class="btn hidden" href="/">Open project</a>
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
	var id = params.get('id');
	var current = null;

	function el(id) { return document.getElementById(id); }
	function show(id) { el(id).classList.remove('hidden'); }
	function hide(id) { el(id).classList.add('hidden'); }

	var CLOSED_TEXT = {
		expired: 'This invite has expired.',
		revoked: 'This invite was revoked.',
		accepted: 'This invite has already been used.',
		declined: 'This invite was declined.'
	};

	function invitePath(inviteId) { return '/invite?id=' + encodeURIComponent(inviteId); }

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

	function post(path) {
		return fetch(path, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
			body: '{}',
			credentials: 'same-origin'
		}).then(parseJson);
	}

	function toOnboarding(inviteId) {
		window.location.replace('/onboarding?next=' + encodeURIComponent(invitePath(inviteId)));
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

	function showWrongAccount(text) {
		hide('loading');
		setTitle('Wrong account');
		el('wrong-account-text').textContent = text;
		show('wrong-account');
	}

	function render(invite, user) {
		current = invite;
		hide('loading');

		// The token has done its job once the invite is known to be this account's.
		if (token && invite.addressedToYou) {
			window.history.replaceState(null, '', invitePath(invite.id));
		}

		if (invite.state !== 'open') {
			if (invite.addressedToYou && invite.openInvitationId) {
				window.location.replace(invitePath(invite.openInvitationId));
				return;
			}
			setTitle('This invite can\\'t be used');
			el('closed-text').textContent = CLOSED_TEXT[invite.state] || 'This invite is no longer open.';
			if (invite.addressedToYou && invite.state === 'accepted') {
				el('closed-hint').textContent = 'You accepted it, so ' + invite.projectName + ' is in your projects.';
				el('closed-link').href = '/projects/' + invite.project.ref + '/planning';
				show('closed-link');
			} else {
				el('closed-hint').textContent = 'Ask ' + invite.inviterName + ' to send a new invite.';
			}
			show('closed');
			return;
		}

		setTitle('You\\'re invited');
		showCard(invite);

		if (!user) {
			el('signin-link').href = '/login?next=' + encodeURIComponent(invitePath(invite.id));
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
			toOnboarding(invite.id);
			return;
		}

		show('answer');
	}

	el('accept-btn').addEventListener('click', function() {
		hide('error');
		setBusy(true);
		post('/api/invitations/' + encodeURIComponent(current.id) + '/accept').then(function(result) {
			if (result.ok) {
				window.location.href = '/projects/' + result.data.project.ref + '/planning';
				return;
			}
			if (result.data.code === 'ONBOARDING_REQUIRED') {
				toOnboarding(current.id);
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
		post('/api/invitations/' + encodeURIComponent(current.id) + '/decline').then(function(result) {
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

	function load(lookupUrl, onLoaded) {
		Promise.all([
			fetch(lookupUrl, { credentials: 'same-origin' }).then(parseJson),
			fetch('/api/auth/me', { credentials: 'same-origin' }).then(parseJson)
		]).then(function(results) {
			onLoaded(results[0], results[1].ok ? results[1].data.user : null);
		}).catch(function() {
			hide('loading');
			showError('Network error. Please reload the page.');
		});
	}

	function failedLookup(lookup) {
		hide('loading');
		showError(lookup.data.error || 'Could not load the invite. Please reload the page.');
	}

	if (id && /^[0-9a-f-]{36}$/i.test(id)) {
		// Back from sign-in, signup or onboarding: the invite is read through the session.
		load('/api/invitations/' + encodeURIComponent(id), function(lookup, user) {
			if (!user) {
				window.location.replace('/login?next=' + encodeURIComponent(invitePath(id)));
				return;
			}
			if (lookup.status === 404) {
				showWrongAccount('This invite isn\\'t addressed to ' + user.email + ', or it no longer exists.');
				return;
			}
			if (!lookup.ok) {
				failedLookup(lookup);
				return;
			}
			render(lookup.data, user);
		});
	} else if (token) {
		load('/api/invite?token=' + encodeURIComponent(token), function(lookup, user) {
			if (lookup.status === 404) {
				showInvalid();
				return;
			}
			if (!lookup.ok) {
				failedLookup(lookup);
				return;
			}
			render(lookup.data, user);
		});
	} else {
		showInvalid();
	}
})();`;
