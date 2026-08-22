/**
 * Verify a WebAuthn authentication (assertion) response — spec §7.2.
 */

import { createHash } from 'node:crypto';
import { fromBase64url } from './base64url.ts';
import { verifyClientData } from './client-data.ts';
import { parseAuthenticatorData } from './authenticator-data.ts';
import { verifyCoseSignature } from './cose.ts';

export interface AuthenticationResponse {
	clientDataJSON: string; // base64url
	authenticatorData: string; // base64url
	signature: string; // base64url
	userHandle?: string | null; // base64url, optional
}

export interface VerifyAuthenticationOptions {
	response: AuthenticationResponse;
	expectedChallenge: string; // base64url
	expectedOrigin: string;
	rpId: string;
	storedPublicKeyCose: Uint8Array;
	storedCounter: number;
	requireUserVerification: boolean;
}

export interface VerifiedAuthentication {
	newCounter: number;
	userVerified: boolean;
}

export function verifyAuthentication(opts: VerifyAuthenticationOptions): VerifiedAuthentication {
	const {
		response, expectedChallenge, expectedOrigin, rpId,
		storedPublicKeyCose, storedCounter, requireUserVerification,
	} = opts;

	// §7.2 steps 11-15: clientDataJSON type/challenge/origin.
	const clientDataBytes = verifyClientData(
		response.clientDataJSON, 'webauthn.get', expectedChallenge, expectedOrigin
	);

	const authData = fromBase64url(response.authenticatorData);
	const parsed = parseAuthenticatorData(authData);

	// §7.2 step 16: rpIdHash must equal SHA-256(rpId).
	const expectedRpIdHash = createHash('sha256').update(rpId).digest();
	if (!Buffer.from(parsed.rpIdHash).equals(expectedRpIdHash)) {
		throw new Error('rpIdHash mismatch');
	}

	// §7.2 steps 17-18: user present, and user verified when required.
	if (!parsed.flags.userPresent) throw new Error('user not present');
	if (requireUserVerification && !parsed.flags.userVerified) {
		throw new Error('user verification required but flag not set');
	}

	// §7.2 step 23: signature over authenticatorData ‖ SHA-256(clientDataJSON).
	const clientDataHash = createHash('sha256').update(clientDataBytes).digest();
	const signedData = Buffer.concat([authData, clientDataHash]);
	const signature = fromBase64url(response.signature);
	if (!verifyCoseSignature(storedPublicKeyCose, signedData, signature)) {
		throw new Error('signature verification failed');
	}

	// §7.2 step 21: clone detection. A regressed counter means a cloned
	// authenticator. Both-zero is allowed (many platform authenticators, e.g.
	// Apple, always report 0).
	const newCounter = parsed.signCount;
	if (storedCounter > 0 && newCounter <= storedCounter) {
		throw new Error('signature counter did not increase (possible cloned authenticator)');
	}

	return { newCounter, userVerified: parsed.flags.userVerified };
}
