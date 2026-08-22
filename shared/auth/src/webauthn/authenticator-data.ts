/**
 * Parse WebAuthn authenticator data (spec §6.1).
 *
 * Layout:
 *   rpIdHash        32 bytes
 *   flags            1 byte   (UP=0x01 UV=0x04 BE=0x08 BS=0x10 AT=0x40 ED=0x80)
 *   signCount        4 bytes  big-endian
 *   [attestedCredentialData]  present iff AT:
 *       aaguid          16 bytes
 *       credIdLength     2 bytes big-endian
 *       credentialId     credIdLength bytes
 *       credentialPublicKey  COSE_Key (CBOR, variable length)
 *   [extensions]              present iff ED: a CBOR map
 */

import { decodeFirst } from './cbor.ts';
import { toBase64url } from './base64url.ts';

const RP_ID_HASH_LEN = 32;
const FLAGS_LEN = 1;
const SIGN_COUNT_LEN = 4;
const AAGUID_LEN = 16;
const CRED_ID_LEN_BYTES = 2;
// Spec caps credentialIdLength at 1023.
const MAX_CRED_ID_LEN = 1023;

export interface AuthenticatorFlags {
	userPresent: boolean;
	userVerified: boolean;
	backupEligible: boolean;
	backupState: boolean;
	attestedCredentialData: boolean;
	extensionData: boolean;
}

export interface ParsedAuthenticatorData {
	rpIdHash: Uint8Array;
	flags: AuthenticatorFlags;
	signCount: number;
	aaguid?: Uint8Array;
	credentialId?: Uint8Array;
	/** Raw COSE_Key bytes, as stored for later verification. */
	credentialPublicKey?: Uint8Array;
}

function parseFlags(byte: number): AuthenticatorFlags {
	return {
		userPresent: (byte & 0x01) !== 0,
		userVerified: (byte & 0x04) !== 0,
		backupEligible: (byte & 0x08) !== 0,
		backupState: (byte & 0x10) !== 0,
		attestedCredentialData: (byte & 0x40) !== 0,
		extensionData: (byte & 0x80) !== 0,
	};
}

export function parseAuthenticatorData(authData: Uint8Array): ParsedAuthenticatorData {
	let offset = 0;
	const need = (n: number): void => {
		if (offset + n > authData.length) throw new Error('authData: truncated');
	};

	need(RP_ID_HASH_LEN + FLAGS_LEN + SIGN_COUNT_LEN);
	const rpIdHash = authData.subarray(0, RP_ID_HASH_LEN);
	offset += RP_ID_HASH_LEN;

	const flags = parseFlags(authData[offset]!);
	offset += FLAGS_LEN;

	const view = new DataView(authData.buffer, authData.byteOffset, authData.byteLength);
	const signCount = view.getUint32(offset);
	offset += SIGN_COUNT_LEN;

	const result: ParsedAuthenticatorData = { rpIdHash, flags, signCount };

	if (flags.attestedCredentialData) {
		need(AAGUID_LEN + CRED_ID_LEN_BYTES);
		result.aaguid = authData.subarray(offset, offset + AAGUID_LEN);
		offset += AAGUID_LEN;

		const credIdLen = view.getUint16(offset);
		offset += CRED_ID_LEN_BYTES;
		if (credIdLen > MAX_CRED_ID_LEN) throw new Error('authData: credentialId too long');
		need(credIdLen);
		result.credentialId = authData.subarray(offset, offset + credIdLen);
		offset += credIdLen;

		// The COSE key is variable-length; decode it to learn where it ends,
		// then keep its raw bytes for storage.
		const { offset: afterKey } = decodeFirst(authData, offset);
		result.credentialPublicKey = authData.subarray(offset, afterKey);
		offset = afterKey;
	}

	if (flags.extensionData) {
		// Present but ignored (we request no extensions). Per §6.1 it must be a
		// CBOR map; validate the type, not merely that it parses.
		const { value: extensions, offset: afterExt } = decodeFirst(authData, offset);
		if (!(extensions instanceof Map)) {
			throw new Error('authData: extensions must be a CBOR map');
		}
		offset = afterExt;
	}

	if (offset !== authData.length) {
		throw new Error('authData: trailing bytes');
	}

	return result;
}

export function aaguidToUuid(aaguid: Uint8Array): string | null {
	if (aaguid.length !== 16) return null;
	const hex = Buffer.from(aaguid).toString('hex');
	if (/^0+$/.test(hex)) return null; // all-zero AAGUID = no attestation info
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export { toBase64url };
