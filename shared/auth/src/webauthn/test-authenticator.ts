/**
 * Test-only WebAuthn authenticator emulator.
 *
 * Builds valid registration/authentication payloads from node:crypto keypairs
 * so the verifier can be exercised without real devices, and exposes knobs to
 * mutate each field for the negative / conformance cases. NOT imported by
 * production code.
 */

import {
	generateKeyPairSync,
	createHash,
	sign as cryptoSign,
	randomBytes,
	type KeyObject,
} from 'node:crypto';

// ---- minimal CBOR encoder (definite length, the shapes we emit) ----

type CborEntry = [number | string, CborEnc];
type CborEnc = number | Uint8Array | string | CborEnc[] | { map: CborEntry[] };

function encodeHead(major: number, arg: number): Uint8Array {
	if (arg < 24) return Uint8Array.from([(major << 5) | arg]);
	if (arg < 0x100) return Uint8Array.from([(major << 5) | 24, arg]);
	if (arg < 0x10000) return Uint8Array.from([(major << 5) | 25, arg >> 8, arg & 0xff]);
	return Uint8Array.from([
		(major << 5) | 26, (arg >>> 24) & 0xff, (arg >> 16) & 0xff, (arg >> 8) & 0xff, arg & 0xff,
	]);
}

function encodeInt(n: number): Uint8Array {
	return n >= 0 ? encodeHead(0, n) : encodeHead(1, -n - 1);
}

export function encodeCbor(value: CborEnc): Uint8Array {
	if (typeof value === 'number') return encodeInt(value);
	if (value instanceof Uint8Array) return Buffer.concat([encodeHead(2, value.length), value]);
	if (typeof value === 'string') {
		const bytes = Buffer.from(value, 'utf-8');
		return Buffer.concat([encodeHead(3, bytes.length), bytes]);
	}
	if (Array.isArray(value)) {
		return Buffer.concat([encodeHead(4, value.length), ...value.map(encodeCbor)]);
	}
	// map
	const entries = value.map;
	const parts = [encodeHead(5, entries.length)];
	for (const [k, v] of entries) {
		parts.push(typeof k === 'number' ? encodeInt(k) : encodeCbor(k));
		parts.push(encodeCbor(v));
	}
	return Buffer.concat(parts);
}

// ---- authenticator ----

function b64u(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('base64url');
}

function jwkCoord(b64url: string): Uint8Array {
	return new Uint8Array(Buffer.from(b64url, 'base64url'));
}

export type Alg = 'ES256' | 'RS256';

export interface AuthenticatorOptions {
	rpId?: string;
	origin?: string;
	alg?: Alg;
	aaguid?: Uint8Array;
	credentialId?: Uint8Array;
}

export interface FlagOverrides {
	up?: boolean;
	uv?: boolean;
	be?: boolean;
	bs?: boolean;
	at?: boolean; // attested credential data
}

export class TestAuthenticator {
	readonly rpId: string;
	readonly origin: string;
	readonly alg: Alg;
	readonly credentialId: Uint8Array;
	private readonly aaguid: Uint8Array;
	private readonly privateKey: KeyObject;
	private readonly publicKey: KeyObject;
	signCount = 0;

	constructor(opts: AuthenticatorOptions = {}) {
		this.rpId = opts.rpId ?? 'localhost';
		this.origin = opts.origin ?? 'http://localhost';
		this.alg = opts.alg ?? 'ES256';
		this.credentialId = opts.credentialId ?? randomBytes(32);
		this.aaguid = opts.aaguid ?? new Uint8Array(16);
		const pair = this.alg === 'ES256'
			? generateKeyPairSync('ec', { namedCurve: 'P-256' })
			: generateKeyPairSync('rsa', { modulusLength: 2048 });
		this.privateKey = pair.privateKey;
		this.publicKey = pair.publicKey;
	}

	/** Raw COSE_Key bytes for this authenticator's public key. */
	coseKey(algOverride?: number): Uint8Array {
		const jwk = this.publicKey.export({ format: 'jwk' }) as Record<string, string>;
		if (this.alg === 'ES256') {
			return encodeCbor({ map: [
				[1, 2],                                   // kty EC2
				[3, algOverride ?? -7],                   // alg ES256
				[-1, 1],                                  // crv P-256
				[-2, jwkCoord(jwk.x!)],                   // x
				[-3, jwkCoord(jwk.y!)],                   // y
			] });
		}
		return encodeCbor({ map: [
			[1, 3],                                       // kty RSA
			[3, algOverride ?? -257],                     // alg RS256
			[-1, jwkCoord(jwk.n!)],                       // n
			[-2, jwkCoord(jwk.e!)],                       // e
		] });
	}

	private flagsByte(f: FlagOverrides): number {
		let b = 0;
		if (f.up ?? true) b |= 0x01;
		if (f.uv ?? true) b |= 0x04;
		if (f.be ?? false) b |= 0x08;
		if (f.bs ?? false) b |= 0x10;
		if (f.at ?? false) b |= 0x40;
		return b;
	}

	private authData(opts: {
		rpId?: string;
		flags: FlagOverrides;
		includeAttestedData: boolean;
		coseKeyOverride?: Uint8Array;
		signCount?: number;
	}): Uint8Array {
		const rpIdHash = createHash('sha256').update(opts.rpId ?? this.rpId).digest();
		const flags = Uint8Array.from([this.flagsByte({ ...opts.flags, at: opts.includeAttestedData })]);
		const count = Buffer.alloc(4);
		count.writeUInt32BE(opts.signCount ?? this.signCount);
		const parts: Uint8Array[] = [rpIdHash, flags, count];
		if (opts.includeAttestedData) {
			const credIdLen = Buffer.alloc(2);
			credIdLen.writeUInt16BE(this.credentialId.length);
			parts.push(this.aaguid, credIdLen, this.credentialId, opts.coseKeyOverride ?? this.coseKey());
		}
		return Buffer.concat(parts);
	}

	private clientDataJSON(type: string, challenge: string, origin?: string): string {
		const json = JSON.stringify({ type, challenge, origin: origin ?? this.origin });
		return b64u(Buffer.from(json, 'utf-8'));
	}

	/** Build a registration response. Overrides let tests corrupt one field. */
	register(challenge: string, over: {
		type?: string;
		origin?: string;
		rpId?: string;
		flags?: FlagOverrides;
		includeAttestedData?: boolean;
		coseKeyOverride?: Uint8Array;
		fmt?: string;
	} = {}): { clientDataJSON: string; attestationObject: string } {
		const clientDataJSON = this.clientDataJSON(over.type ?? 'webauthn.create', challenge, over.origin);
		const authData = this.authData({
			rpId: over.rpId,
			flags: over.flags ?? {},
			includeAttestedData: over.includeAttestedData ?? true,
			coseKeyOverride: over.coseKeyOverride,
		});
		const attestationObject = encodeCbor({ map: [
			['fmt', over.fmt ?? 'none'],
			['attStmt', { map: [] }],
			['authData', authData],
		] });
		return { clientDataJSON, attestationObject: b64u(attestationObject) };
	}

	/** Build an authentication response. Overrides let tests corrupt one field. */
	authenticate(challenge: string, over: {
		type?: string;
		origin?: string;
		rpId?: string;
		flags?: FlagOverrides;
		signCount?: number;
		tamperSignature?: boolean;
		userHandle?: Uint8Array;
	} = {}): {
		clientDataJSON: string;
		authenticatorData: string;
		signature: string;
		userHandle?: string;
	} {
		const clientDataJSON = this.clientDataJSON(over.type ?? 'webauthn.get', challenge, over.origin);
		const authData = this.authData({
			rpId: over.rpId,
			flags: over.flags ?? {},
			includeAttestedData: false,
			signCount: over.signCount,
		});
		const clientDataHash = createHash('sha256')
			.update(Buffer.from(clientDataJSON, 'base64url'))
			.digest();
		const signedData = Buffer.concat([authData, clientDataHash]);
		const sig = new Uint8Array(cryptoSign('sha256', signedData, this.privateKey));
		if (over.tamperSignature && sig.length > 0) sig[0] = (sig[0] ?? 0) ^ 0xff;
		const result: {
			clientDataJSON: string;
			authenticatorData: string;
			signature: string;
			userHandle?: string;
		} = {
			clientDataJSON,
			authenticatorData: b64u(authData),
			signature: b64u(sig),
		};
		if (over.userHandle) result.userHandle = b64u(over.userHandle);
		return result;
	}
}

export function randomChallenge(): string {
	return b64u(randomBytes(32));
}
