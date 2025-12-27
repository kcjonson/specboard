/**
 * Database entity types
 * These must match the schema defined in migrations
 */

export interface User {
	id: string;
	cognito_sub: string;
	display_name: string;
	avatar_url: string | null;
	created_at: Date;
	updated_at: Date;
}

export interface UserEmail {
	id: string;
	user_id: string;
	email: string;
	is_primary: boolean;
	is_verified: boolean;
	verified_at: Date | null;
	created_at: Date;
}

export interface GitHubConnection {
	id: string;
	user_id: string;
	github_user_id: string;
	github_username: string;
	access_token: string; // Encrypted
	refresh_token: string | null; // Encrypted
	token_expires_at: Date | null;
	scopes: string[];
	connected_at: Date;
}

export interface McpToken {
	id: string;
	user_id: string;
	client_id: string;
	access_token_hash: string;
	refresh_token_hash: string | null;
	scopes: string[];
	expires_at: Date;
	created_at: Date;
}

export interface OAuthCode {
	code: string;
	user_id: string;
	client_id: string;
	code_challenge: string;
	code_challenge_method: string;
	scopes: string[];
	redirect_uri: string;
	expires_at: Date;
}

/**
 * Planning entity types
 */

export type EpicStatus = 'ready' | 'in_progress' | 'done';

export interface Epic {
	id: string;
	title: string;
	description: string | null;
	status: EpicStatus;
	assignee: string | null;
	rank: number;
	created_at: Date;
	updated_at: Date;
}

export interface Task {
	id: string;
	epic_id: string;
	title: string;
	status: EpicStatus;
	assignee: string | null;
	due_date: Date | null;
	rank: number;
	created_at: Date;
	updated_at: Date;
}
