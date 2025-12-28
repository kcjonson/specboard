/**
 * Database entity types
 * These must match the schema defined in migrations
 */

export interface User {
	id: string;
	username: string;
	first_name: string;
	last_name: string;
	email: string;
	email_verified: boolean;
	email_verified_at: Date | null;
	phone_number: string | null;
	avatar_url: string | null;
	created_at: Date;
	updated_at: Date;
}

export interface UserPassword {
	user_id: string;
	password_hash: string;
	created_at: Date;
	updated_at: Date;
}

export interface EmailVerificationToken {
	id: string;
	user_id: string;
	email: string;
	token_hash: string;
	expires_at: Date;
	created_at: Date;
}

export interface PasswordResetToken {
	id: string;
	user_id: string;
	token_hash: string;
	expires_at: Date;
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

export type EpicStatus = 'ready' | 'in_progress' | 'in_review' | 'done';
export type TaskStatus = 'ready' | 'in_progress' | 'blocked' | 'done';

export interface Epic {
	id: string;
	title: string;
	description: string | null;
	status: EpicStatus;
	creator: string | null;
	assignee: string | null;
	rank: number;
	spec_doc_path: string | null;
	pr_url: string | null;
	created_at: Date;
	updated_at: Date;
}

export interface Task {
	id: string;
	epic_id: string;
	title: string;
	status: TaskStatus;
	assignee: string | null;
	due_date: Date | null;
	rank: number;
	details: string | null;
	block_reason: string | null;
	created_at: Date;
	updated_at: Date;
}

export interface ProgressNote {
	id: string;
	epic_id: string | null;
	task_id: string | null;
	note: string;
	created_by: string;
	created_at: Date;
}
