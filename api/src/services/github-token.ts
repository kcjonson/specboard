import { query } from '@specboard/db';

export interface GitHubConnection {
	/** The access token as stored: encrypted, still to be decrypted by whoever uses it (the sync Lambda takes it this way). */
	encryptedToken: string;
	/** The GitHub login it belongs to. */
	username: string;
}

/** A user's GitHub connection, or null when they haven't connected GitHub. */
export async function getGitHubConnection(userId: string): Promise<GitHubConnection | null> {
	const result = await query<{ access_token: string; github_username: string }>(
		'SELECT access_token, github_username FROM github_connections WHERE user_id = $1',
		[userId]
	);
	const row = result.rows[0];
	return row ? { encryptedToken: row.access_token, username: row.github_username } : null;
}
