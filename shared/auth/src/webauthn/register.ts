/**
 * Verify a WebAuthn registration (attestation) response — spec §7.1.
 *
 * Scope: we request attestation 'none', so the attestation statement is NOT
 * verified (no device provenance) — we parse the attestationObject only to
 * reach authData and the credential public key. Key algorithm is constrained
 * to ES256/RS256 by importCoseKey.
 */

import { createHash } from 'node:crypto';
import { decode, asMap, type CborValue } from './cbor.ts';
import { fromBase64url, toBase64url } from './base64url.ts';
import { verifyClientData } from './client-data.ts';
import { parseAuthenticatorData, aaguidToUuid } from './authenticator-data.ts';
import { importCoseKey } from './cose.ts';

export interface RegistrationResponse {
	clientDataJSON: string; // base64url
	attestationObject: string; // base64url
}

export interface VerifyRegistrationOptions {
	response: RegistrationResponse;
	expectedChallenge: string; // base64url
	expectedOrigin: string;
	rpId: string;
	requireUserVerification: boolean;
}

export interface VerifiedRegistration {
	credentialId: string; // base64url
	publicKeyCose: Uint8Array; // raw COSE bytes to store
	counter: number;
	aaguid: string | null;
	deviceType: 'singleDevice' | 'multiDevice';
	backedUp: boolean;
}

export function verifyRegistration(opts: VerifyRegistrationOptions): VerifiedRegistration {
	const { response, expectedChallenge, expectedOrigin, rpId, requireUserVerification } = opts;

	// §7.1 steps 5-11: clientDataJSON type/challenge/origin.
	verifyClientData(response.clientDataJSON, 'webauthn.create', expectedChallenge, expectedOrigin);

	// Decode the attestation object; we only need authData from it. We
	// deliberately accept ANY fmt and never verify the attestation statement
	// (attestation 'none' policy — no device provenance). Requiring fmt==='none'
	// would reject legitimate registrations: real authenticators return packed,
	// fido-u2f, tpm, and android-key formats even under a 'none' request
	// (confirmed against SimpleWebAuthn's real-device fixtures), and browsers
	// don't reliably anonymize. The credential key and the full ceremony are
	// verified from authData regardless of fmt, so ignoring attStmt is not a
	// downgrade — nothing we act on ever comes from it.
	const attestation = asMap(decode(fromBase64url(response.attestationObject)));
	const authDataValue: CborValue | undefined = attestation.get('authData');
	if (!(authDataValue instanceof Uint8Array)) {
		throw new Error('attestationObject missing authData');
	}
	const parsed = parseAuthenticatorData(authDataValue);

	// §7.1 step 13: rpIdHash must equal SHA-256(rpId).
	const expectedRpIdHash = createHash('sha256').update(rpId).digest();
	if (!Buffer.from(parsed.rpIdHash).equals(expectedRpIdHash)) {
		throw new Error('rpIdHash mismatch');
	}

	// §7.1 steps 14-15: user present, and user verified when required.
	if (!parsed.flags.userPresent) throw new Error('user not present');
	if (requireUserVerification && !parsed.flags.userVerified) {
		throw new Error('user verification required but flag not set');
	}
	// Backup state set without backup eligibility is an illegal flag
	// combination (WebAuthn L3 §6.1). Matches go-webauthn.
	if (parsed.flags.backupState && !parsed.flags.backupEligible) {
		throw new Error('invalid backup flags: BS set without BE');
	}

	if (!parsed.flags.attestedCredentialData || !parsed.credentialId || !parsed.credentialPublicKey) {
		throw new Error('no attested credential data');
	}

	// Reject any key we couldn't verify against later (alg/type check).
	importCoseKey(parsed.credentialPublicKey);

	return {
		credentialId: toBase64url(parsed.credentialId),
		publicKeyCose: parsed.credentialPublicKey,
		counter: parsed.signCount,
		aaguid: parsed.aaguid ? aaguidToUuid(parsed.aaguid) : null,
		deviceType: parsed.flags.backupEligible ? 'multiDevice' : 'singleDevice',
		backedUp: parsed.flags.backupState,
	};
}
