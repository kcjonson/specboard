import { SESSION_COOKIE_NAME } from '@specboard/auth';

const ADMIN_CHECK_TIMEOUT_MS = 5000;

/**
 * Ask the API whether a session's user is a site admin right now. The
 * frontend has no database access, and GET /api/auth/me reads the user row
 * on every call, so a role change applies to the very next check. Anything
 * but a 2xx whose user carries an 'admin' role reads as not admin; network
 * errors and the timeout reject.
 */
export async function sessionIsAdmin(apiUrl: string, sessionId: string): Promise<boolean> {
	const response = await fetch(`${apiUrl}/api/auth/me`, {
		headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
		signal: AbortSignal.timeout(ADMIN_CHECK_TIMEOUT_MS),
	});

	if (!response.ok) {
		await response.body?.cancel();
		return false;
	}

	const body: unknown = await response.json();
	const roles = (body as { user?: { roles?: unknown } } | null)?.user?.roles;
	return Array.isArray(roles) && roles.includes('admin');
}
