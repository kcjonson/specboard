/**
 * Minimal CBOR decoder (RFC 8949) for WebAuthn.
 *
 * Deliberately supports only what attestation objects and COSE keys use:
 * definite-length unsigned/negative integers, byte strings, text strings,
 * arrays, and maps (majors 0-5). Indefinite-length items, tags (major 6),
 * and floats/simple values (major 7) are rejected rather than parsed — a
 * narrow decoder is far easier to audit than a general one, and anything
 * outside this set in an authenticator payload is a reason to reject.
 *
 * Maps decode to a JS Map so integer COSE labels (e.g. -2 = x coordinate)
 * survive; text-keyed maps also work. Depth and size are bounded to prevent
 * a malicious payload from exhausting the stack or memory.
 */

import { TextDecoder } from 'node:util';

const MAX_DEPTH = 16;
const MAX_ELEMENTS = 1024;

export type CborValue =
	| number
	| bigint
	| Uint8Array
	| string
	| CborValue[]
	| Map<number | string, CborValue>;

class CborReader {
	private readonly view: DataView;

	constructor(private readonly buf: Uint8Array, private offset: number) {
		this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	}

	get position(): number {
		return this.offset;
	}

	private need(n: number): void {
		if (this.offset + n > this.buf.length) {
			throw new Error('CBOR: unexpected end of input');
		}
	}

	/** Read a major-type argument (RFC 8949 §3). Rejects indefinite length. */
	private readArgument(info: number): number | bigint {
		if (info < 24) return info;
		if (info === 24) {
			this.need(1);
			return this.buf[this.offset++]!;
		}
		if (info === 25) {
			this.need(2);
			const v = this.view.getUint16(this.offset);
			this.offset += 2;
			return v;
		}
		if (info === 26) {
			this.need(4);
			const v = this.view.getUint32(this.offset);
			this.offset += 4;
			return v;
		}
		if (info === 27) {
			this.need(8);
			const v = this.view.getBigUint64(this.offset);
			this.offset += 8;
			// Collapse to Number when exactly representable; callers that use a
			// value as a length re-check the range.
			return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
		}
		// info 28-30 reserved, 31 indefinite length
		throw new Error(`CBOR: unsupported additional info ${info}`);
	}

	private asLength(arg: number | bigint): number {
		if (typeof arg !== 'number' || !Number.isInteger(arg) || arg < 0) {
			throw new Error('CBOR: invalid length');
		}
		if (arg > this.buf.length) {
			throw new Error('CBOR: length exceeds input');
		}
		return arg;
	}

	read(depth: number): CborValue {
		if (depth > MAX_DEPTH) throw new Error('CBOR: max depth exceeded');
		this.need(1);
		const initial = this.buf[this.offset++]!;
		const major = initial >> 5;
		const info = initial & 0x1f;

		switch (major) {
			case 0: // unsigned integer
				return this.readArgument(info);
			case 1: { // negative integer: -(n+1)
				const n = this.readArgument(info);
				return typeof n === 'bigint' ? -n - 1n : -n - 1;
			}
			case 2: { // byte string
				const len = this.asLength(this.readArgument(info));
				this.need(len);
				const bytes = this.buf.subarray(this.offset, this.offset + len);
				this.offset += len;
				return bytes;
			}
			case 3: { // text string
				const len = this.asLength(this.readArgument(info));
				this.need(len);
				const text = new TextDecoder('utf-8', { fatal: true }).decode(
					this.buf.subarray(this.offset, this.offset + len)
				);
				this.offset += len;
				return text;
			}
			case 4: { // array
				const len = this.asLength(this.readArgument(info));
				if (len > MAX_ELEMENTS) throw new Error('CBOR: array too large');
				const arr: CborValue[] = [];
				for (let i = 0; i < len; i++) arr.push(this.read(depth + 1));
				return arr;
			}
			case 5: { // map
				const len = this.asLength(this.readArgument(info));
				if (len > MAX_ELEMENTS) throw new Error('CBOR: map too large');
				const map = new Map<number | string, CborValue>();
				for (let i = 0; i < len; i++) {
					const key = this.read(depth + 1);
					if (typeof key !== 'number' && typeof key !== 'string') {
						throw new Error('CBOR: unsupported map key type');
					}
					if (map.has(key)) throw new Error('CBOR: duplicate map key');
					map.set(key, this.read(depth + 1));
				}
				return map;
			}
			default: // 6 = tag, 7 = float/simple
				throw new Error(`CBOR: unsupported major type ${major}`);
		}
	}
}

/**
 * Decode one CBOR item starting at `offset`.
 * Returns the value and the offset just past it, so a caller can keep reading
 * (authenticator data has a COSE key of unknown length followed by extensions).
 */
export function decodeFirst(
	buf: Uint8Array,
	offset = 0
): { value: CborValue; offset: number } {
	const reader = new CborReader(buf, offset);
	const value = reader.read(0);
	return { value, offset: reader.position };
}

/** Decode a CBOR item and require it to consume the whole buffer. */
export function decode(buf: Uint8Array): CborValue {
	const { value, offset } = decodeFirst(buf, 0);
	if (offset !== buf.length) {
		throw new Error('CBOR: trailing data after item');
	}
	return value;
}

/** Narrow a decoded value to a CBOR map, or throw. */
export function asMap(value: CborValue): Map<number | string, CborValue> {
	if (!(value instanceof Map)) throw new Error('CBOR: expected a map');
	return value;
}
