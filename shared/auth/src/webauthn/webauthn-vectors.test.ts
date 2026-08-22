/**
 * Known-good WebAuthn test vectors from independent sources.
 *
 * These validate the verifier against real-device output and spec examples,
 * complementing the emulator-driven conformance suite in webauthn.test.ts.
 *
 * Attribution:
 * - ES256 assertion vector: duo-labs/webauthn protocol/assertion_test.go
 *   (real webauthn.io / macOS Touch ID data), BSD-3-Clause.
 * - EC2 P-256 COSE key: W3C WebAuthn L2 §6.5.1.1 encoded-credPubKey example
 *   (== RFC 9052 App. C.7.1 "meriadoc" key), W3C Software and Document License.
 */

import { describe, it, expect } from 'vitest';
import { verifyRegistration } from './register.ts';
import { verifyAuthentication } from './authenticate.ts';
import { importCoseKey, ALG_ES256 } from './cose.ts';
import { fromBase64url } from './base64url.ts';

/** Strip base64 padding that some fixtures carry (real browser output is unpadded). */
function noPad(s: string): string {
	return s.replace(/=+$/, '');
}

// --- Real ES256 assertion (macOS Touch ID via webauthn.io) ---
// The challenge and origin below are the ones embedded in this fixture's
// clientDataJSON; rpId is webauthn.io (its SHA-256 is the authData rpIdHash).
const ASSERTION = {
	credentialPublicKey:
		'pQMmIAEhWCAoCF-x0dwEhzQo-ABxHIAgr_5WL6cJceREc81oIwFn7iJYIHEHx8ZhBIE42L26-rSC_3l0ZaWEmsHAKyP9rgslApUdAQI',
	clientDataJSON:
		'eyJjaGFsbGVuZ2UiOiJFNFBUY0lIX0hmWDFwQzZTaWdrMVNDOU5BbGdlenROMDQzOXZpOHpfYzlrIiwibmV3X2tleXNfbWF5X2JlX2FkZGVkX2hlcmUiOiJkbyBub3QgY29tcGFyZSBjbGllbnREYXRhSlNPTiBhZ2FpbnN0IGEgdGVtcGxhdGUuIFNlZSBodHRwczovL2dvby5nbC95YWJQZXgiLCJvcmlnaW4iOiJodHRwczovL3dlYmF1dGhuLmlvIiwidHlwZSI6IndlYmF1dGhuLmdldCJ9',
	authenticatorData:
		'dKbqkhPJnC90siSSsyDPQCYqlMGpUKA5fyklC2CEHvBFXJJiGa3OAAI1vMYKZIsLJfHwVQMANwCOw-atj9C0vhWpfWU-whzNjeQS21Lpxfdk_G-omAtffWztpGoErlNOfuXWRqm9Uj9ANJck1p6lAQIDJiABIVggKAhfsdHcBIc0KPgAcRyAIK_-Vi-nCXHkRHPNaCMBZ-4iWCBxB8fGYQSBONi9uvq0gv95dGWlhJrBwCsj_a4LJQKVHQ',
	signature:
		'MEUCIBtIVOQxzFYdyWQyxaLR0tik1TnuPhGVhXVSNgFwLmN5AiEAnxXdCq0UeAVGWxOaFcjBZ_mEZoXqNboY5IkQDdlWZYc',
	challenge: 'E4PTcIH_HfX1pC6Sigk1SC9NAlgeztN0439vi8z_c9k',
	origin: 'https://webauthn.io',
	rpId: 'webauthn.io',
	signCount: 1553097241,
};

function coseBytes(): Uint8Array {
	return fromBase64url(ASSERTION.credentialPublicKey);
}

describe('real ES256 assertion vector (duo-labs / macOS Touch ID)', () => {
	it('verifies a genuine assertion end-to-end', () => {
		const result = verifyAuthentication({
			response: {
				clientDataJSON: ASSERTION.clientDataJSON,
				authenticatorData: ASSERTION.authenticatorData,
				signature: ASSERTION.signature,
			},
			expectedChallenge: ASSERTION.challenge,
			expectedOrigin: ASSERTION.origin,
			rpId: ASSERTION.rpId,
			storedPublicKeyCose: coseBytes(),
			storedCounter: 0,
			requireUserVerification: true,
		});
		expect(result.newCounter).toBe(ASSERTION.signCount);
		expect(result.userVerified).toBe(true);
	});

	it('rejects the same assertion under a wrong challenge', () => {
		expect(() => verifyAuthentication({
			response: {
				clientDataJSON: ASSERTION.clientDataJSON,
				authenticatorData: ASSERTION.authenticatorData,
				signature: ASSERTION.signature,
			},
			expectedChallenge: 'Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9v',
			expectedOrigin: ASSERTION.origin,
			rpId: ASSERTION.rpId,
			storedPublicKeyCose: coseBytes(),
			storedCounter: 0,
			requireUserVerification: true,
		})).toThrow(/challenge mismatch/);
	});

	it('rejects the same assertion under a wrong origin', () => {
		expect(() => verifyAuthentication({
			response: {
				clientDataJSON: ASSERTION.clientDataJSON,
				authenticatorData: ASSERTION.authenticatorData,
				signature: ASSERTION.signature,
			},
			expectedChallenge: ASSERTION.challenge,
			expectedOrigin: 'https://evil.example.com',
			rpId: ASSERTION.rpId,
			storedPublicKeyCose: coseBytes(),
			storedCounter: 0,
			requireUserVerification: true,
		})).toThrow(/origin mismatch/);
	});

	it('rejects a tampered signature (last byte flipped)', () => {
		const sig = fromBase64url(ASSERTION.signature);
		sig[sig.length - 1] = (sig[sig.length - 1] ?? 0) ^ 0xff;
		expect(() => verifyAuthentication({
			response: {
				clientDataJSON: ASSERTION.clientDataJSON,
				authenticatorData: ASSERTION.authenticatorData,
				signature: Buffer.from(sig).toString('base64url'),
			},
			expectedChallenge: ASSERTION.challenge,
			expectedOrigin: ASSERTION.origin,
			rpId: ASSERTION.rpId,
			storedPublicKeyCose: coseBytes(),
			storedCounter: 0,
			requireUserVerification: true,
		})).toThrow(/signature verification failed/);
	});

	it('rejects a counter regression against this device', () => {
		expect(() => verifyAuthentication({
			response: {
				clientDataJSON: ASSERTION.clientDataJSON,
				authenticatorData: ASSERTION.authenticatorData,
				signature: ASSERTION.signature,
			},
			expectedChallenge: ASSERTION.challenge,
			expectedOrigin: ASSERTION.origin,
			rpId: ASSERTION.rpId,
			storedPublicKeyCose: coseBytes(),
			storedCounter: ASSERTION.signCount + 1,
			requireUserVerification: true,
		})).toThrow(/counter/);
	});
});

// --- SimpleWebAuthn real-device fixtures (MIT, Copyright (c) 2020 Matthew Miller) ---
// github.com/MasterKale/SimpleWebAuthn packages/server/src/{registration,authentication}
// Ported verbatim. We call with requireUserVerification:false because these
// demo/test authenticators are UP-only; UV enforcement is covered by the
// emulator suite. Registration accepts any fmt (packed/fido-u2f/none) since we
// never verify attestation.

interface RegFixture {
	label: string;
	challenge: string;
	origin: string;
	rpId: string;
	credentialId: string;
	attestationObject: string;
	clientDataJSON: string;
}

const REG_FIXTURES: RegFixture[] = [
	{
		label: 'None attestation, ES256 (Firefox/Android)',
		challenge: 'aEVjY1BXdXppUDAwSDBwNWd4aDJfdTVfUEM0TmVZZ2Q',
		origin: 'https://dev.dontneeda.pw',
		rpId: 'dev.dontneeda.pw',
		credentialId: 'AdKXJEch1aV5Wo7bj7qLHskVY4OoNaj9qu8TPdJ7kSAgUeRxWNngXlcNIGt4gexZGKVGcqZpqqWordXb_he1izY',
		attestationObject: 'o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVjFPdxHEOnAiLIp26idVjIguzn3Ipr_RlsKZWsa-5qK-KBFAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQHSlyRHIdWleVqO24-6ix7JFWODqDWo_arvEz3Se5EgIFHkcVjZ4F5XDSBreIHsWRilRnKmaaqlqK3V2_4XtYs2pQECAyYgASFYID5PQTZQQg6haZFQWFzqfAOyQ_ENsMH8xxQ4GRiNPsqrIlggU8IVUOV8qpgk_Jh-OTaLuZL52KdX1fTht07X4DiQPow',
		clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiYUVWalkxQlhkWHBwVURBd1NEQndOV2Q0YURKZmRUVmZVRU0wVG1WWloyUSIsIm9yaWdpbiI6Imh0dHBzOlwvXC9kZXYuZG9udG5lZWRhLnB3IiwiYW5kcm9pZFBhY2thZ2VOYW1lIjoib3JnLm1vemlsbGEuZmlyZWZveCJ9',
	},
	{
		label: 'None attestation, RS256',
		challenge: 'pYZ3VX2yb8dS9yplNxJChiXhPGBk8gZzTAyJ2iU5x1k',
		origin: 'https://dev.dontneeda.pw',
		rpId: 'dev.dontneeda.pw',
		credentialId: 'kGXv4RJWLeXRw8Yf3T22K3Gq_GGeDv9OKYmAHLm0Ylo',
		attestationObject: 'o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVkBZz3cRxDpwIiyKduonVYyILs59yKa_0ZbCmVrGvuaivigRQAAAABgKLAXsdRMArSzr82vyWuyACCQZe_hElYt5dHDxh_dPbYrcar8YZ4O_04piYAcubRiWqQBAwM5AQAgWQEA8X6V649G2vwB99CSf_luwR0jj7oDg_GhA3TQSnNYIwfQJldxT5dmi9H8IjjCrTP28iNuKl29hc3Mowux1FZB0bc5AEJ2oV3JCOMGP9NZKGmOosF7iBN2GtGY7Nomcs-ruBv2mxp1nTm6mv5B8XNwh0e18uTA5AJCsl-k6lNLYB2XBIQ3fy2-TjSQ8IOMLypWQbWWBJXzLmepaJ6EWe6kf_NaxpA2chWsaekZcr8xG6OIo3iGh0Mpags_qBZtN4n2TDn0R2LheLk4yQ0R_oOAVtX963Yuw0x5NYSZyMNSMi_1RSEPTYn5AILmIzQskglDaWJYtnjKz4QLuXWCRRYyDSFDAQAB',
		clientDataJSON: 'eyJjaGFsbGVuZ2UiOiJwWVozVlgyeWI4ZFM5eXBsTnhKQ2hpWGhQR0JrOGdaelRBeUoyaVU1eDFrIiwiY2xpZW50RXh0ZW5zaW9ucyI6e30sImhhc2hBbGdvcml0aG0iOiJTSEEtMjU2Iiwib3JpZ2luIjoiaHR0cHM6Ly9kZXYuZG9udG5lZWRhLnB3IiwidHlwZSI6IndlYmF1dGhuLmNyZWF0ZSJ9',
	},
];

describe('SimpleWebAuthn registration fixtures (real devices, multiple formats)', () => {
	it.each(REG_FIXTURES)('parses & verifies: $label', (f) => {
		const result = verifyRegistration({
			response: { clientDataJSON: f.clientDataJSON, attestationObject: f.attestationObject },
			expectedChallenge: f.challenge,
			expectedOrigin: f.origin,
			rpId: f.rpId,
			requireUserVerification: false,
		});
		// Exact credentialId proves authData/attested-cred-data parsing is correct.
		expect(result.credentialId).toBe(f.credentialId);
		// Extracted COSE key must import.
		expect(() => importCoseKey(result.publicKeyCose)).not.toThrow();
	});
});

interface AuthFixture {
	label: string;
	challenge: string;
	origin: string;
	rpId: string;
	credentialPublicKey: string;
	authenticatorData: string;
	clientDataJSON: string;
	signature: string;
	prevCounter: number;
	newCounter: number;
}

const AUTH_FIXTURES: AuthFixture[] = [
	{
		label: 'ES256 assertion, counter 143 → 144',
		challenge: 'dG90YWxseVVuaXF1ZVZhbHVlRXZlcnlUaW1l',
		origin: 'https://dev.dontneeda.pw',
		rpId: 'dev.dontneeda.pw',
		credentialPublicKey: 'pQECAyYgASFYIIheFp-u6GvFT2LNGovf3ZrT0iFVBsA_76rRysxRG9A1Ilgg8WGeA6hPmnab0HAViUYVRkwTNcN77QBf_RR0dv3lIvQ',
		authenticatorData: 'PdxHEOnAiLIp26idVjIguzn3Ipr_RlsKZWsa-5qK-KABAAAAkA==',
		clientDataJSON: 'eyJjaGFsbGVuZ2UiOiJkRzkwWVd4c2VWVnVhWEYxWlZaaGJIVmxSWFpsY25sVWFXMWwiLCJjbGllbnRFeHRlbnNpb25zIjp7fSwiaGFzaEFsZ29yaXRobSI6IlNIQS0yNTYiLCJvcmlnaW4iOiJodHRwczovL2Rldi5kb250bmVlZGEucHciLCJ0eXBlIjoid2ViYXV0aG4uZ2V0In0=',
		signature: 'MEUCIQDYXBOpCWSWq2Ll4558GJKD2RoWg958lvJSB_GdeokxogIgWuEVQ7ee6AswQY0OsuQ6y8Ks6jhd45bDx92wjXKs900=',
		prevCounter: 143,
		newCounter: 144,
	},
	{
		label: 'ES256 assertion, both counters 0 (no comparison)',
		challenge: 'dG90YWxseVVuaXF1ZVZhbHVlRXZlcnlBc3NlcnRpb24',
		origin: 'https://dev.dontneeda.pw',
		rpId: 'dev.dontneeda.pw',
		credentialPublicKey: 'pQECAyYgASFYIGmaxR4mBbukc2QhtW2ldhAAd555r-ljlGQN8MbcTnPPIlgg9CyUlE-0AB2fbzZbNgBvJuRa7r6o2jPphOmtyNPR_kY',
		authenticatorData: 'PdxHEOnAiLIp26idVjIguzn3Ipr_RlsKZWsa-5qK-KABAAAAAA',
		clientDataJSON: 'eyJjaGFsbGVuZ2UiOiJkRzkwWVd4c2VWVnVhWEYxWlZaaGJIVmxSWFpsY25sQmMzTmxjblJwYjI0IiwiY2xpZW50RXh0ZW5zaW9ucyI6e30sImhhc2hBbGdvcml0aG0iOiJTSEEtMjU2Iiwib3JpZ2luIjoiaHR0cHM6Ly9kZXYuZG9udG5lZWRhLnB3IiwidHlwZSI6IndlYmF1dGhuLmdldCJ9',
		signature: 'MEQCIBu6M-DGzu1O8iocGHEj0UaAZm0HmxTeRIE6-nS3_CPjAiBDsmIzy5sacYwwzgpXqfwRt_2vl5yiQZ_OAqWJQBGVsQ',
		prevCounter: 0,
		newCounter: 0,
	},
];

describe('SimpleWebAuthn authentication fixtures (real ES256 assertions)', () => {
	it.each(AUTH_FIXTURES)('verifies: $label', (f) => {
		const result = verifyAuthentication({
			response: {
				clientDataJSON: noPad(f.clientDataJSON),
				authenticatorData: noPad(f.authenticatorData),
				signature: noPad(f.signature),
			},
			expectedChallenge: f.challenge,
			expectedOrigin: f.origin,
			rpId: f.rpId,
			storedPublicKeyCose: fromBase64url(noPad(f.credentialPublicKey)),
			storedCounter: f.prevCounter,
			requireUserVerification: false,
		});
		expect(result.newCounter).toBe(f.newCounter);
	});
});

describe('spec COSE key vector (W3C §6.5.1.1 / RFC 9052 C.7.1)', () => {
	// The canonical EC2 P-256 ES256 public key, verbatim from the spec.
	const SPEC_EC2_KEY_HEX =
		'a501020326200121582065eda5a12577c2bae829437fe338701a10aaa375e1bb5b5de108de439c08551d' +
		'2258201e52ed75701163f7f9e40ddf9f341b3dc9ba860af7e0ca7ca7e9eecd0084d19c';

	it('imports the spec EC2/P-256 key as ES256', () => {
		const bytes = new Uint8Array(Buffer.from(SPEC_EC2_KEY_HEX, 'hex'));
		const { alg, key } = importCoseKey(bytes);
		expect(alg).toBe(ALG_ES256);
		expect(key.asymmetricKeyType).toBe('ec');
	});
});
