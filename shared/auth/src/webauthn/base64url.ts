/**
 * base64url helpers for WebAuthn payloads (server side).
 * The browser sends credential id, clientDataJSON, attestationObject,
 * authenticatorData, and signature as base64url strings.
 */

export function fromBase64url(input: string): Uint8Array {
	if (typeof input !== 'string' || !/^[A-Za-z0-9_-]*$/.test(input)) {
		throw new Error('Invalid base64url');
	}
	return new Uint8Array(Buffer.from(input, 'base64url'));
}

export function toBase64url(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('base64url');
}
