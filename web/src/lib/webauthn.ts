/**
 * Browser-side WebAuthn client glue for passkey registration.
 *
 * Hand-rolled (no @simplewebauthn/browser): converts the server's
 * base64url-encoded options into the ArrayBuffer shapes navigator.credentials
 * wants, and converts the resulting credential back into the
 * RegistrationResponseJSON the API's verify endpoint expects. Imported only by
 * the SPA (settings + onboarding); the unauthenticated login page has its own
 * inline authentication glue.
 */

/** Server registration options (from generateRegistrationOptions), base64url-encoded. */
export interface PublicKeyCredentialCreationOptionsJSON {
	rp: { id?: string; name: string };
	user: { id: string; name: string; displayName: string };
	challenge: string;
	pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>;
	timeout?: number;
	excludeCredentials?: Array<{ id: string; type: 'public-key'; transports?: string[] }>;
	authenticatorSelection?: {
		authenticatorAttachment?: 'platform' | 'cross-platform';
		residentKey?: string;
		requireResidentKey?: boolean;
		userVerification?: string;
	};
	attestation?: string;
	extensions?: Record<string, unknown>;
}

/** What the API's /register/verify endpoint expects as `response`. */
export interface RegistrationResponseJSON {
	id: string;
	rawId: string;
	type: string;
	response: {
		clientDataJSON: string;
		attestationObject: string;
		transports?: string[];
	};
	clientExtensionResults: Record<string, unknown>;
	authenticatorAttachment?: string;
}

export function browserSupportsWebAuthn(): boolean {
	return typeof window !== 'undefined'
		&& typeof window.PublicKeyCredential !== 'undefined'
		&& typeof navigator !== 'undefined'
		&& !!navigator.credentials
		&& typeof navigator.credentials.create === 'function';
}

function base64urlToBuffer(value: string): ArrayBuffer {
	const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
	const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}

function bufferToBase64url(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Run the registration ceremony. Takes the server options, calls the platform
 * authenticator, and returns the JSON the verify endpoint expects. Throws the
 * raw DOMException on cancel/failure — callers map it via passkeyErrorMessage.
 */
export async function createPasskey(
	options: PublicKeyCredentialCreationOptionsJSON
): Promise<RegistrationResponseJSON> {
	const publicKey: PublicKeyCredentialCreationOptions = {
		rp: options.rp,
		user: {
			id: base64urlToBuffer(options.user.id),
			name: options.user.name,
			displayName: options.user.displayName,
		},
		challenge: base64urlToBuffer(options.challenge),
		pubKeyCredParams: options.pubKeyCredParams,
		timeout: options.timeout,
		attestation: options.attestation as AttestationConveyancePreference | undefined,
		excludeCredentials: options.excludeCredentials?.map((c) => ({
			id: base64urlToBuffer(c.id),
			type: 'public-key' as const,
			transports: c.transports as AuthenticatorTransport[] | undefined,
		})),
		authenticatorSelection: options.authenticatorSelection as AuthenticatorSelectionCriteria | undefined,
		extensions: options.extensions as AuthenticationExtensionsClientInputs | undefined,
	};

	const credential = await navigator.credentials.create({ publicKey }) as PublicKeyCredential | null;
	if (!credential) {
		throw new Error('The authenticator returned no credential.');
	}
	const response = credential.response as AuthenticatorAttestationResponse;
	const transports = typeof response.getTransports === 'function' ? response.getTransports() : undefined;

	return {
		id: credential.id,
		rawId: bufferToBase64url(credential.rawId),
		type: credential.type,
		response: {
			clientDataJSON: bufferToBase64url(response.clientDataJSON),
			attestationObject: bufferToBase64url(response.attestationObject),
			transports,
		},
		clientExtensionResults: credential.getClientExtensionResults() as Record<string, unknown>,
		authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
	};
}

/**
 * Map a ceremony error to a user-facing message, or `null` when it should be
 * silent — a user-cancel/abort is a deliberate action, not an error to shout
 * about (matching how the login page treats NotAllowedError).
 */
export function passkeyErrorMessage(err: unknown, fallback: string): string | null {
	if (err instanceof Error) {
		// User dismissed the prompt, aborted, or it timed out — stay quiet.
		if (err.name === 'NotAllowedError' || err.name === 'AbortError') return null;
		// The authenticator already holds a credential excluded by the RP.
		if (err.name === 'InvalidStateError') return 'This device already has a passkey for your account.';
	}
	return fallback;
}
