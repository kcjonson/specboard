/**
 * Shared utilities for AI providers
 */

/**
 * Sanitize error messages to avoid leaking sensitive information
 *
 * This function converts raw provider errors into user-friendly messages
 * that don't expose internal details, API keys, or server information.
 */
export function getSafeErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		const msg = error.message.toLowerCase();

		// Authentication/key errors
		if (msg.includes('401') || msg.includes('invalid') || msg.includes('authentication') || msg.includes('api_key')) {
			return 'API key configuration error. Please check your API key in Settings.';
		}

		// Rate limiting
		if (msg.includes('rate') || msg.includes('429') || msg.includes('limit') || msg.includes('quota')) {
			return 'Rate limit exceeded. Please try again later.';
		}

		// Billing/credits
		if (msg.includes('insufficient') || msg.includes('credit') || msg.includes('balance')) {
			return 'Insufficient API credits. Please check your account.';
		}

		// Permission errors
		if (msg.includes('permission') || msg.includes('403') || msg.includes('forbidden')) {
			return 'Permission denied. Please check your API key permissions.';
		}

		// Timeout errors
		if (msg.includes('timeout') || msg.includes('timed out')) {
			return 'Request timed out. Please try again.';
		}
	}

	// Generic fallback - never expose raw error details
	return 'An error occurred while processing your request.';
}
