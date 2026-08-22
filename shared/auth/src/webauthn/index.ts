/**
 * Hand-rolled WebAuthn verification (no external deps).
 *
 * Scope, enforced throughout: ES256 + RS256 only; attestation 'none' (the
 * attestation statement is never verified); user verification required. See
 * docs/specs/authentication.md for the ordered verification-steps contract.
 */

export { verifyRegistration } from './register.ts';
export type {
	RegistrationResponse,
	VerifyRegistrationOptions,
	VerifiedRegistration,
} from './register.ts';

export { verifyAuthentication } from './authenticate.ts';
export type {
	AuthenticationResponse,
	VerifyAuthenticationOptions,
	VerifiedAuthentication,
} from './authenticate.ts';

export { parseAuthenticatorData, aaguidToUuid } from './authenticator-data.ts';
export type { ParsedAuthenticatorData, AuthenticatorFlags } from './authenticator-data.ts';

export { importCoseKey, verifyCoseSignature, ALG_ES256, ALG_RS256, SUPPORTED_ALGS } from './cose.ts';
export { fromBase64url, toBase64url } from './base64url.ts';
export { decode as decodeCbor, decodeFirst as decodeCborFirst } from './cbor.ts';
