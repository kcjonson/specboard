/**
 * WebAuthn verification tests — doubles as the FIDO conformance checklist.
 *
 * Each negative test injects exactly one violation of a numbered spec check
 * (§7.1 registration, §7.2 authentication) via the emulator and asserts the
 * verifier rejects it. Happy paths cover both supported algorithms.
 */

import { describe, it, expect } from 'vitest';
import { verifyRegistration } from './register.ts';
import { verifyAuthentication } from './authenticate.ts';
import { decode, decodeFirst } from './cbor.ts';
import { importCoseKey } from './cose.ts';
import { TestAuthenticator, randomChallenge, encodeCbor, type Alg } from './test-authenticator.ts';
import type { VerifiedRegistration } from './register.ts';
import type { VerifiedAuthentication } from './authenticate.ts';

const RP_ID = 'localhost';
const ORIGIN = 'http://localhost';

function register(auth: TestAuthenticator, challenge: string, over = {}): VerifiedRegistration {
	return verifyRegistration({
		response: auth.register(challenge, over),
		expectedChallenge: challenge,
		expectedOrigin: ORIGIN,
		rpId: RP_ID,
		requireUserVerification: true,
	});
}

describe('verifyRegistration — happy paths', () => {
	it.each(['ES256', 'RS256'] as Alg[])('accepts a valid %s registration', (alg) => {
		const auth = new TestAuthenticator({ alg });
		const challenge = randomChallenge();
		const result = register(auth, challenge);
		expect(result.credentialId).toBe(Buffer.from(auth.credentialId).toString('base64url'));
		expect(result.publicKeyCose.length).toBeGreaterThan(0);
		expect(result.counter).toBe(0);
		// The extracted COSE key must be importable.
		expect(() => importCoseKey(result.publicKeyCose)).not.toThrow();
	});

	it('reports backup eligibility / state as device type', () => {
		const auth = new TestAuthenticator();
		const result = register(auth, randomChallenge(), { flags: { be: true, bs: true } });
		expect(result.deviceType).toBe('multiDevice');
		expect(result.backedUp).toBe(true);
	});
});

describe('verifyRegistration — §7.1 conformance checks (each rejects one violation)', () => {
	const auth = new TestAuthenticator();

	it('rejects wrong clientData.type', () => {
		const challenge = randomChallenge();
		expect(() => register(auth, challenge, { type: 'webauthn.get' })).toThrow(/type mismatch/);
	});

	it('rejects a challenge mismatch', () => {
		const resp = auth.register(randomChallenge());
		expect(() => verifyRegistration({
			response: resp, expectedChallenge: randomChallenge(),
			expectedOrigin: ORIGIN, rpId: RP_ID, requireUserVerification: true,
		})).toThrow(/challenge mismatch/);
	});

	it('rejects an origin mismatch', () => {
		const challenge = randomChallenge();
		expect(() => register(auth, challenge, { origin: 'https://evil.example.com' })).toThrow(/origin mismatch/);
	});

	it('rejects an rpIdHash mismatch', () => {
		const challenge = randomChallenge();
		expect(() => register(auth, challenge, { rpId: 'evil.example.com' })).toThrow(/rpIdHash mismatch/);
	});

	it('rejects when user-present flag is clear', () => {
		const challenge = randomChallenge();
		expect(() => register(auth, challenge, { flags: { up: false } })).toThrow(/user not present/);
	});

	it('rejects when user-verification required but flag clear', () => {
		const challenge = randomChallenge();
		expect(() => register(auth, challenge, { flags: { uv: false } })).toThrow(/user verification/);
	});

	it('rejects when attested credential data is absent', () => {
		const challenge = randomChallenge();
		expect(() => register(auth, challenge, { includeAttestedData: false })).toThrow(/attested credential data/);
	});

	it('rejects an unsupported COSE algorithm (EdDSA)', () => {
		const challenge = randomChallenge();
		// Re-label the ES256 key as alg -8 (EdDSA); import must reject it.
		const badKey = auth.coseKey(-8);
		expect(() => register(auth, challenge, { coseKeyOverride: badKey })).toThrow(/unsupported algorithm|EC2/);
	});
});

describe('verifyAuthentication — happy paths', () => {
	it.each(['ES256', 'RS256'] as Alg[])('round-trips a valid %s assertion', (alg) => {
		const auth = new TestAuthenticator({ alg });
		const reg = register(auth, randomChallenge());
		const challenge = randomChallenge();
		const result = verifyAuthentication({
			response: auth.authenticate(challenge, { signCount: 5 }),
			expectedChallenge: challenge, expectedOrigin: ORIGIN, rpId: RP_ID,
			storedPublicKeyCose: reg.publicKeyCose, storedCounter: 0, requireUserVerification: true,
		});
		expect(result.newCounter).toBe(5);
		expect(result.userVerified).toBe(true);
	});

	it('allows a zero counter when stored is also zero (Apple-style)', () => {
		const auth = new TestAuthenticator();
		const reg = register(auth, randomChallenge());
		const challenge = randomChallenge();
		const result = verifyAuthentication({
			response: auth.authenticate(challenge, { signCount: 0 }),
			expectedChallenge: challenge, expectedOrigin: ORIGIN, rpId: RP_ID,
			storedPublicKeyCose: reg.publicKeyCose, storedCounter: 0, requireUserVerification: true,
		});
		expect(result.newCounter).toBe(0);
	});
});

describe('verifyAuthentication — §7.2 conformance checks (each rejects one violation)', () => {
	function setup(): { auth: TestAuthenticator; cose: Uint8Array } {
		const auth = new TestAuthenticator();
		const reg = register(auth, randomChallenge());
		return { auth, cose: reg.publicKeyCose };
	}
	function verify(_auth: TestAuthenticator, cose: Uint8Array, challenge: string, resp: ReturnType<TestAuthenticator['authenticate']>, storedCounter = 0): VerifiedAuthentication {
		return verifyAuthentication({
			response: resp, expectedChallenge: challenge, expectedOrigin: ORIGIN, rpId: RP_ID,
			storedPublicKeyCose: cose, storedCounter, requireUserVerification: true,
		});
	}

	it('rejects wrong clientData.type', () => {
		const { auth, cose } = setup();
		const c = randomChallenge();
		expect(() => verify(auth, cose, c, auth.authenticate(c, { type: 'webauthn.create' }))).toThrow(/type mismatch/);
	});

	it('rejects a challenge mismatch', () => {
		const { auth, cose } = setup();
		expect(() => verify(auth, cose, randomChallenge(), auth.authenticate(randomChallenge()))).toThrow(/challenge mismatch/);
	});

	it('rejects an origin mismatch', () => {
		const { auth, cose } = setup();
		const c = randomChallenge();
		expect(() => verify(auth, cose, c, auth.authenticate(c, { origin: 'https://evil.example.com' }))).toThrow(/origin mismatch/);
	});

	it('rejects an rpIdHash mismatch', () => {
		const { auth, cose } = setup();
		const c = randomChallenge();
		expect(() => verify(auth, cose, c, auth.authenticate(c, { rpId: 'evil.example.com' }))).toThrow(/rpIdHash mismatch/);
	});

	it('rejects when user-present flag is clear', () => {
		const { auth, cose } = setup();
		const c = randomChallenge();
		expect(() => verify(auth, cose, c, auth.authenticate(c, { flags: { up: false } }))).toThrow(/user not present/);
	});

	it('rejects when user-verification required but flag clear', () => {
		const { auth, cose } = setup();
		const c = randomChallenge();
		expect(() => verify(auth, cose, c, auth.authenticate(c, { flags: { uv: false } }))).toThrow(/user verification/);
	});

	it('rejects a tampered signature', () => {
		const { auth, cose } = setup();
		const c = randomChallenge();
		expect(() => verify(auth, cose, c, auth.authenticate(c, { tamperSignature: true }))).toThrow(/signature verification failed/);
	});

	it('rejects a signature verified against a different key', () => {
		const { auth } = setup();
		const other = new TestAuthenticator();
		const otherReg = register(other, randomChallenge());
		const c = randomChallenge();
		// auth's assertion checked against other's stored key
		expect(() => verify(auth, otherReg.publicKeyCose, c, auth.authenticate(c, { signCount: 1 }))).toThrow(/signature verification failed/);
	});

	it('rejects a regressed signature counter (cloned authenticator)', () => {
		const { auth, cose } = setup();
		const c = randomChallenge();
		expect(() => verify(auth, cose, c, auth.authenticate(c, { signCount: 3 }), 5)).toThrow(/counter/);
	});

	it('rejects an equal (non-increasing) counter when stored is nonzero', () => {
		const { auth, cose } = setup();
		const c = randomChallenge();
		expect(() => verify(auth, cose, c, auth.authenticate(c, { signCount: 5 }), 5)).toThrow(/counter/);
	});
});

describe('CBOR decoder — hostile input rejection', () => {
	it('decodes a simple map', () => {
		const bytes = encodeCbor({ map: [[1, 2], ['a', 3]] });
		const map = decode(bytes) as Map<number | string, unknown>;
		expect(map.get(1)).toBe(2);
		expect(map.get('a')).toBe(3);
	});

	it('rejects indefinite-length items', () => {
		// 0x5f = byte string, indefinite length
		expect(() => decode(Uint8Array.from([0x5f, 0x40, 0xff]))).toThrow(/additional info/);
	});

	it('rejects tags (major 6)', () => {
		expect(() => decode(Uint8Array.from([0xc0, 0x00]))).toThrow(/major type 6/);
	});

	it('rejects floats / simple values (major 7)', () => {
		expect(() => decode(Uint8Array.from([0xf9, 0x3c, 0x00]))).toThrow(/major type 7/);
	});

	it('rejects truncated input', () => {
		// byte string claiming 5 bytes but only 2 follow
		expect(() => decode(Uint8Array.from([0x45, 0x01, 0x02]))).toThrow(/unexpected end|length exceeds/);
	});

	it('rejects trailing data after a complete item', () => {
		expect(() => decode(Uint8Array.from([0x01, 0x02]))).toThrow(/trailing data/);
	});

	it('rejects over-deep nesting', () => {
		// 20 nested single-element arrays (0x81), exceeding MAX_DEPTH
		const nested = Uint8Array.from([...Array(20).fill(0x81), 0x00]);
		expect(() => decode(nested)).toThrow(/max depth/);
	});

	it('decodeFirst reports where an item ends (for mid-buffer COSE keys)', () => {
		const combined = Uint8Array.from([0x01, 0x02, 0x03]); // three tiny ints
		const first = decodeFirst(combined, 0);
		expect(first.value).toBe(1);
		expect(first.offset).toBe(1);
	});
});

describe('COSE — key/alg validation', () => {
	it('rejects an alg/kty mismatch (RS256 label on an EC2 key)', () => {
		const auth = new TestAuthenticator({ alg: 'ES256' });
		const badKey = auth.coseKey(-257); // claim RS256 on an EC2 key body
		expect(() => importCoseKey(badKey)).toThrow(/RS256 requires an RSA key/);
	});
});
