/**
 * Browser-safe cookie utilities
 */

/**
 * Read a cookie value by name.
 */
export function getCookie(name: string): string | null {
	if (typeof document === 'undefined') return null;
	const cookies = document.cookie ? document.cookie.split('; ') : [];
	for (const cookie of cookies) {
		const [cookieName, ...valueParts] = cookie.split('=');
		if (cookieName === name) {
			const value = valueParts.join('=');
			try {
				return decodeURIComponent(value);
			} catch {
				return value;
			}
		}
	}
	return null;
}

/**
 * Set a cookie with expiration in days.
 */
export function setCookie(name: string, value: string, days: number): void {
	if (typeof document === 'undefined') return;
	const expires = new Date();
	expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
	document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/;SameSite=Lax;Secure`;
}
