import { query } from '@specboard/db';

/**
 * A user's GitHub access token as stored: encrypted, still to be decrypted by whoever
 * uses it (the sync Lambda takes it this way). Null when they haven't connected GitHub.
 */
export async function getEncryptedGitHubToken(userId: string): Promise<string | null> {
	const result = await query<{ access_token: string }>(
		'SELECT access_token FROM github_connections WHERE user_id = $1',
		[userId]
	);
	return result.rows[0]?.access_token ?? null;
}
