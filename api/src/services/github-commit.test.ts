import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	createGitHubCommit,
	generateCommitMessage,
	type PendingChange,
} from './github-commit.ts';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('github-commit', () => {
	beforeEach(() => {
		mockFetch.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('generateCommitMessage', () => {
		it('should return "Update files" for empty changes', () => {
			expect(generateCommitMessage([])).toBe('Update files');
		});

		it('should generate message for single created file', () => {
			const changes: PendingChange[] = [
				{ path: 'docs/new-file.md', content: '# New', action: 'created' },
			];
			expect(generateCommitMessage(changes)).toBe('Add docs/new-file.md');
		});

		it('should generate message for single modified file', () => {
			const changes: PendingChange[] = [
				{ path: 'README.md', content: '# Updated', action: 'modified' },
			];
			expect(generateCommitMessage(changes)).toBe('Update README.md');
		});

		it('should generate message for single deleted file', () => {
			const changes: PendingChange[] = [
				{ path: 'old-file.md', content: null, action: 'deleted' },
			];
			expect(generateCommitMessage(changes)).toBe('Delete old-file.md');
		});

		it('should generate message for multiple files of same action', () => {
			const changes: PendingChange[] = [
				{ path: 'file1.md', content: '1', action: 'modified' },
				{ path: 'file2.md', content: '2', action: 'modified' },
				{ path: 'file3.md', content: '3', action: 'modified' },
			];
			expect(generateCommitMessage(changes)).toBe('Update 3 files');
		});

		it('should generate message for mixed actions', () => {
			const changes: PendingChange[] = [
				{ path: 'new.md', content: 'new', action: 'created' },
				{ path: 'updated.md', content: 'updated', action: 'modified' },
				{ path: 'removed.md', content: null, action: 'deleted' },
			];
			expect(generateCommitMessage(changes)).toBe(
				'Add new.md, Update updated.md, Delete removed.md'
			);
		});

		it('should generate message for multiple created and single modified', () => {
			const changes: PendingChange[] = [
				{ path: 'a.md', content: 'a', action: 'created' },
				{ path: 'b.md', content: 'b', action: 'created' },
				{ path: 'c.md', content: 'c', action: 'modified' },
			];
			expect(generateCommitMessage(changes)).toBe('Add 2 files, Update c.md');
		});
	});

	describe('createGitHubCommit', () => {
		const baseParams = {
			owner: 'testowner',
			repo: 'testrepo',
			branch: 'main',
			token: 'test-token',
			message: 'Test commit',
			changes: [
				{ path: 'test.md', content: '# Test', action: 'modified' as const },
			],
		};

		it('should return error for empty changes', async () => {
			const result = await createGitHubCommit({
				...baseParams,
				changes: [],
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe('No changes to commit');
		});

		it('should return error when getting branch HEAD fails', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				json: () => Promise.resolve({ message: 'Not Found' }),
			});

			const result = await createGitHubCommit(baseParams);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Failed to get branch HEAD');
		});

		it('should create commit successfully', async () => {
			// Mock GET branch HEAD
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ object: { sha: 'abc123' } }),
			});

			// Mock GraphQL mutation
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						data: {
							createCommitOnBranch: {
								commit: {
									oid: 'newsha456',
									url: 'https://github.com/testowner/testrepo/commit/newsha456',
								},
							},
						},
					}),
			});

			const result = await createGitHubCommit(baseParams);

			expect(result.success).toBe(true);
			expect(result.sha).toBe('newsha456');
			expect(result.url).toBe(
				'https://github.com/testowner/testrepo/commit/newsha456'
			);
			expect(result.filesCommitted).toBe(1);

			// Verify the GraphQL call
			expect(mockFetch).toHaveBeenCalledTimes(2);
			const graphqlCall = mockFetch.mock.calls[1] as [string, RequestInit];
			expect(graphqlCall[0]).toBe('https://api.github.com/graphql');
			expect(graphqlCall[1].method).toBe('POST');

			const body = JSON.parse(graphqlCall[1].body as string);
			expect(body.variables.input.expectedHeadOid).toBe('abc123');
			expect(body.variables.input.message.headline).toBe('Test commit');
		});

		it('should detect conflict errors', async () => {
			// Mock GET branch HEAD
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ object: { sha: 'abc123' } }),
			});

			// Mock GraphQL mutation with conflict error
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						errors: [
							{
								message:
									'The expectedHeadOid does not match the current head oid',
							},
						],
					}),
			});

			const result = await createGitHubCommit(baseParams);

			expect(result.success).toBe(false);
			expect(result.conflictDetected).toBe(true);
			expect(result.error).toBe('Remote has new changes. Sync before committing.');
		});

		it('should handle deletions correctly', async () => {
			// Mock GET branch HEAD
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ object: { sha: 'abc123' } }),
			});

			// Mock GraphQL mutation
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						data: {
							createCommitOnBranch: {
								commit: {
									oid: 'delsha789',
									url: 'https://github.com/testowner/testrepo/commit/delsha789',
								},
							},
						},
					}),
			});

			const result = await createGitHubCommit({
				...baseParams,
				changes: [{ path: 'deleted.md', content: null, action: 'deleted' }],
			});

			expect(result.success).toBe(true);

			// Verify deletions are in the request
			const graphqlCall = mockFetch.mock.calls[1] as [string, RequestInit];
			const body = JSON.parse(graphqlCall[1].body as string);
			expect(body.variables.input.fileChanges.deletions).toEqual([
				{ path: 'deleted.md' },
			]);
		});

		it('should handle mixed additions and deletions', async () => {
			// Mock GET branch HEAD
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ object: { sha: 'abc123' } }),
			});

			// Mock GraphQL mutation
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						data: {
							createCommitOnBranch: {
								commit: {
									oid: 'mixsha',
									url: 'https://github.com/testowner/testrepo/commit/mixsha',
								},
							},
						},
					}),
			});

			const changes: PendingChange[] = [
				{ path: 'new.md', content: '# New file', action: 'created' },
				{ path: 'updated.md', content: '# Updated', action: 'modified' },
				{ path: 'removed.md', content: null, action: 'deleted' },
			];

			const result = await createGitHubCommit({
				...baseParams,
				changes,
			});

			expect(result.success).toBe(true);
			expect(result.filesCommitted).toBe(3);

			// Verify the request structure
			const graphqlCall = mockFetch.mock.calls[1] as [string, RequestInit];
			const body = JSON.parse(graphqlCall[1].body as string);

			expect(body.variables.input.fileChanges.additions).toHaveLength(2);
			expect(body.variables.input.fileChanges.deletions).toHaveLength(1);
		});

		it('should handle non-conflict GraphQL errors', async () => {
			// Mock GET branch HEAD
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ object: { sha: 'abc123' } }),
			});

			// Mock GraphQL mutation with generic error
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						errors: [{ message: 'Some other error occurred' }],
					}),
			});

			const result = await createGitHubCommit(baseParams);

			expect(result.success).toBe(false);
			expect(result.conflictDetected).toBe(false);
			expect(result.error).toBe('Some other error occurred');
		});

		it('should handle unexpected API response', async () => {
			// Mock GET branch HEAD
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ object: { sha: 'abc123' } }),
			});

			// Mock GraphQL mutation with empty response
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ data: {} }),
			});

			const result = await createGitHubCommit(baseParams);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Unexpected response from GitHub API');
		});

		it('should handle network error during GraphQL call', async () => {
			// Mock GET branch HEAD - success
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ object: { sha: 'abc123' } }),
			});

			// Mock GraphQL mutation - network error
			mockFetch.mockRejectedValueOnce(new Error('Network connection failed'));

			const result = await createGitHubCommit(baseParams);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Network error: Network connection failed');
		});

		it('should handle HTTP error from GraphQL endpoint', async () => {
			// Mock GET branch HEAD - success
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ object: { sha: 'abc123' } }),
			});

			// Mock GraphQL mutation - HTTP error
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 503,
				statusText: 'Service Unavailable',
			});

			const result = await createGitHubCommit(baseParams);

			expect(result.success).toBe(false);
			expect(result.error).toBe('GitHub API error: 503 Service Unavailable');
		});

		it('should handle JSON parsing error from GraphQL response', async () => {
			// Mock GET branch HEAD - success
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ object: { sha: 'abc123' } }),
			});

			// Mock GraphQL mutation - invalid JSON
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.reject(new Error('Invalid JSON')),
			});

			const result = await createGitHubCommit(baseParams);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Failed to parse GitHub API response');
		});
	});
});
