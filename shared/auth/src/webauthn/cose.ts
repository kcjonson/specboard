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

/** Big-endian bytes → BigInt (0 for empty). */
function bytesToBigInt(bytes: Uint8Array): bigint {
	let value = 0n;
	for (const byte of bytes) value = (value << 8n) | BigInt(byte);
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
		// Reject weak RSA moduli (2048-bit = 256 bytes) and absurdly large ones.
		if (n.length < 256) throw new Error('COSE: RSA modulus too small (<2048 bits)');
		if (n.length > 512) throw new Error('COSE: RSA modulus too large (>4096 bits)');
		// Reject degenerate public exponents. e=1 makes RSA verification the
		// identity (sig^1 mod n == padded hash), forgeable with no private key;
		// e must be an odd integer >= 3. Real authenticators use 65537.
		const eValue = bytesToBigInt(e);
		if (eValue < 3n || (eValue & 1n) === 0n) {
			throw new Error('COSE: invalid RSA public exponent');
		}
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
	const { alg, key } = importCoseKey(coseBytes);
	// Derive the digest from alg explicitly rather than inferring from the key
	// type, so adding an alg later can't silently reuse the wrong hash.
	const digest = alg === ALG_ES256 || alg === ALG_RS256 ? 'sha256' : null;
	if (!digest) throw new Error(`COSE: no digest for algorithm ${alg}`);
	return cryptoVerify(digest, signedData, key, signature);
}
