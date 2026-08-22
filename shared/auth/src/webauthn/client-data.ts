/**
 * Parse and verify collectedClientData (spec §5.8.1 / §7.1 steps 7-11,
 * §7.2 steps 11-15): the JSON the browser hashes and the authenticator signs
 * over indirectly.
 */

import { timingSafeEqual } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { fromBase64url } from './base64url.ts';

interface ClientData {
	type: string;
	challenge: string;
	origin: string;
	crossOrigin?: boolean;
}

function safeStringEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * @param clientDataJSONb64u base64url of the raw clientDataJSON bytes
 * @param expectedType 'webauthn.create' (registration) or 'webauthn.get' (auth)
 * @param expectedChallenge the base64url challenge we issued
 * @param expectedOrigin exact origin string, e.g. https://specboard.io
 * @returns the raw clientDataJSON bytes (needed for the auth signature)
 */
export function verifyClientData(
	clientDataJSONb64u: string,
	expectedType: 'webauthn.create' | 'webauthn.get',
	expectedChallenge: string,
	expectedOrigin: string
): Uint8Array {
	const raw = fromBase64url(clientDataJSONb64u);
	let data: ClientData;
	try {
		data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
	} catch {
		throw new Error('clientDataJSON is not valid JSON');
	}

	if (data.type !== expectedType) {
		throw new Error(`clientData type mismatch: expected ${expectedType}`);
	}
	// Defense-in-depth: never accept an empty expected challenge, so a bug that
	// dropped the challenge can't turn into "any assertion matches".
	if (!expectedChallenge) {
		throw new Error('empty expected challenge');
	}
	// challenge is the base64url of the challenge bytes; compare constant-time
	if (typeof data.challenge !== 'string' || !safeStringEqual(data.challenge, expectedChallenge)) {
		throw new Error('clientData challenge mismatch');
	}
	if (data.origin !== expectedOrigin) {
		throw new Error('clientData origin mismatch');
	}
	// Reject ceremonies performed in a cross-origin (embedded/iframe) context;
	// we never initiate them, so a crossOrigin that isn't explicitly false is a
	// clickjacking signal. (go-webauthn CollectedClientData.Verify does the same.)
	if (data.crossOrigin !== undefined && data.crossOrigin !== false) {
		throw new Error('clientData crossOrigin not allowed');
	}
	return raw;
}
