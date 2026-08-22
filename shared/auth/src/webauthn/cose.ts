/**
 * COSE_Key handling for WebAuthn.
 *
 * Scope is deliberately narrow: ES256 (EC2/P-256, alg -7) and RS256 (RSA,
 * alg -257). These cover the consumer authenticators we target (Apple, Google,
 * Windows Hello, 1Password/Bitwarden, YubiKeys). Anything else is rejected at
 * registration so we never store a key we can't verify against.
 *
 * Keys are stored as their raw COSE bytes and converted to a Node KeyObject
 * per verification via JWK import (no manual DER construction).
 */

import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import { decode, asMap, type CborValue } from './cbor.ts';
import { toBase64url } from './base64url.ts';

// COSE key common labels (RFC 9052)
const KTY = 1;
const ALG = 3;
// EC2 labels
const EC2_CRV = -1;
const EC2_X = -2;
const EC2_Y = -3;
// RSA labels
const RSA_N = -1;
const RSA_E = -2;

const KTY_EC2 = 2;
const KTY_RSA = 3;
const CRV_P256 = 1;

export const ALG_ES256 = -7;
export const ALG_RS256 = -257;
export const SUPPORTED_ALGS = [ALG_ES256, ALG_RS256] as const;

interface CoseKey {
	alg: number;
	key: KeyObject;
}

function requireBytes(value: CborValue | undefined, label: string): Uint8Array {
	if (!(value instanceof Uint8Array)) throw new Error(`COSE: ${label} must be a byte string`);
	return value;
}

function requireInt(value: CborValue | undefined, label: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value)) {
		throw new Error(`COSE: ${label} must be an integer`);
	}
	return value;
}

/**
 * Parse raw COSE_Key bytes into a verify-ready Node key.
 * Enforces alg ∈ {ES256, RS256} and that the key type matches the algorithm.
 */
export function importCoseKey(coseBytes: Uint8Array): CoseKey {
	const map = asMap(decode(coseBytes));
	const kty = requireInt(map.get(KTY), 'kty');
	const alg = requireInt(map.get(ALG), 'alg');

	if (alg === ALG_ES256) {
		if (kty !== KTY_EC2) throw new Error('COSE: ES256 requires an EC2 key');
		const crv = requireInt(map.get(EC2_CRV), 'crv');
		if (crv !== CRV_P256) throw new Error('COSE: ES256 requires curve P-256');
		const x = requireBytes(map.get(EC2_X), 'x');
		const y = requireBytes(map.get(EC2_Y), 'y');
		if (x.length !== 32 || y.length !== 32) throw new Error('COSE: bad P-256 coordinate length');
		const key = createPublicKey({
			key: { kty: 'EC', crv: 'P-256', x: toBase64url(x), y: toBase64url(y) },
			format: 'jwk',
		});
		return { alg, key };
	}

	if (alg === ALG_RS256) {
		if (kty !== KTY_RSA) throw new Error('COSE: RS256 requires an RSA key');
		const n = requireBytes(map.get(RSA_N), 'n');
		const e = requireBytes(map.get(RSA_E), 'e');
		// Reject weak RSA moduli; a 2048-bit modulus is 256 bytes.
		if (n.length < 256) throw new Error('COSE: RSA modulus too small (<2048 bits)');
		const key = createPublicKey({
			key: { kty: 'RSA', n: toBase64url(n), e: toBase64url(e) },
			format: 'jwk',
		});
		return { alg, key };
	}

	throw new Error(`COSE: unsupported algorithm ${alg}`);
}

/**
 * Verify a WebAuthn assertion signature over `signedData`.
 *
 * ES256 signatures arrive ASN.1/DER-encoded, which node:crypto's ECDSA verify
 * accepts natively (the raw r||s concatenation is a WebCrypto concern, not
 * ours). RS256 is RSASSA-PKCS1-v1_5, node:crypto's default RSA padding.
 */
export function verifyCoseSignature(
	coseBytes: Uint8Array,
	signedData: Uint8Array,
	signature: Uint8Array
): boolean {
	const { key } = importCoseKey(coseBytes);
	// Both supported algs hash with SHA-256.
	return cryptoVerify('sha256', signedData, key, signature);
}
