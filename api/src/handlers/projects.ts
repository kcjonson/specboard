/**
 * Project handlers
 */

import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import { getSession, SESSION_COOKIE_NAME } from '@specboard/auth';
import {
	getProjects,
	getProject,
	createProject,
	updateProject,
	deleteProject,
} from '@specboard/db';
import { projectResponseToApi } from '../transform.ts';
import { isValidUUID, isValidTitle, isValidDescription, MAX_TITLE_LENGTH, MAX_DESCRIPTION_LENGTH } from '../validation.ts';
import { startGitHubInitialSync } from './github-sync.ts';

async function getUserId(context: Context, redis: Redis): Promise<string | null> {
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);
	if (!sessionId) return null;

	const session = await getSession(redis, sessionId);
	return session?.userId ?? null;
}

export async function handleListProjects(context: Context, redis: Redis): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	try {
		const projects = await getProjects(userId);

		const apiProjects = projects.map((project) => ({
			...projectResponseToApi(project),
			epicCount: project.epicCount,
			epicCounts: project.epicCounts,
		}));

		return context.json(apiProjects);
	} catch (error) {
		console.error('Failed to fetch projects:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleGetProject(context: Context, redis: Redis): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const id = context.req.param('id');

	if (!isValidUUID(id)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	// Support fields filter for lightweight queries (e.g., ?fields=name)
	// Note: 'id' is always included in filtered responses for client convenience
	const fieldsParam = context.req.query('fields');
	const requestedFields = fieldsParam
		? fieldsParam.split(',').map((f) => f.trim()).filter((f) => f !== 'id')
		: null;

	try {
		const project = await getProject(id, userId);

		if (!project) {
			return context.json({ error: 'Project not found' }, 404);
		}

		const fullResponse = projectResponseToApi(project);

		// If specific fields requested, return only those
		if (requestedFields) {
			const filtered: Record<string, unknown> = { id: fullResponse.id };
			for (const field of requestedFields) {
				if (field in fullResponse) {
					filtered[field] = fullResponse[field as keyof typeof fullResponse];
				}
			}
			return context.json(filtered);
		}

		return context.json(fullResponse);
	} catch (error) {
		console.error('Failed to fetch project:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleCreateProject(context: Context, redis: Redis): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	try {
		const body = await context.req.json();
		const { name, description, repository } = body;

		if (!name || typeof name !== 'string') {
			return context.json({ error: 'Name is required' }, 400);
		}

		if (!isValidTitle(name)) {
			return context.json(
				{ error: `Name must be between 1 and ${MAX_TITLE_LENGTH} characters` },
				400
			);
		}

		if (description !== undefined && typeof description === 'string' && !isValidDescription(description)) {
			return context.json(
				{ error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or less` },
				400
			);
		}

		// Validate repository config if provided
		let validatedRepository: { provider: 'github'; owner: string; repo: string; branch: string; url: string } | undefined;
		if (repository) {
			// Basic type validation
			if (
				typeof repository !== 'object' ||
				repository.provider !== 'github' ||
				typeof repository.owner !== 'string' ||
				typeof repository.repo !== 'string' ||
				typeof repository.branch !== 'string' ||
				typeof repository.url !== 'string'
			) {
				return context.json({ error: 'Invalid repository configuration' }, 400);
			}

			// Validate GitHub naming conventions:
			// - 1 to 100 characters
			// - may contain alphanumerics, dots, underscores, and hyphens
			// - must start and end with an alphanumeric character (no leading/trailing dots)
			const GITHUB_NAME_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,98}[a-zA-Z0-9])?$/;
			// Branch names must start with alphanumeric
			const BRANCH_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,254}$/;

			if (!GITHUB_NAME_REGEX.test(repository.owner)) {
				return context.json({ error: 'Invalid repository owner format' }, 400);
			}
			if (!GITHUB_NAME_REGEX.test(repository.repo)) {
				return context.json({ error: 'Invalid repository name format' }, 400);
			}
			if (!repository.branch || !BRANCH_REGEX.test(repository.branch)) {
				return context.json({ error: 'Invalid branch name format' }, 400);
			}

			// Validate URL is a GitHub URL with correct path format
			try {
				const url = new URL(repository.url);
				if (url.hostname !== 'github.com') {
					return context.json({ error: 'Repository URL must be a GitHub URL' }, 400);
				}
				// Validate path format: must be /{owner}/{repo}[.git][/]
				const pathParts = url.pathname.replace(/\.git\/?$/, '').replace(/\/+$/, '').split('/').filter(Boolean);
				if (pathParts.length !== 2) {
					return context.json({ error: 'Repository URL must be in format https://github.com/{owner}/{repo}' }, 400);
				}
			} catch {
				return context.json({ error: 'Invalid repository URL' }, 400);
			}

			validatedRepository = {
				provider: 'github',
				owner: repository.owner,
				repo: repository.repo,
				branch: repository.branch,
				url: repository.url,
			};
		}

		const project = await createProject(userId, {
			name,
			description: description || undefined,
			repository: validatedRepository,
		});

		// Trigger initial sync for cloud projects (fire-and-forget)
		if (validatedRepository) {
			void startGitHubInitialSync(project.id, userId).catch((err) => {
				console.error('Failed to start GitHub initial sync:', err);
			});
		}

		return context.json(projectResponseToApi(project), 201);
	} catch (error) {
		console.error('Failed to create project:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleUpdateProject(context: Context, redis: Redis): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const id = context.req.param('id');

	if (!isValidUUID(id)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	try {
		const body = await context.req.json();
		const { name, description } = body;

		if (name !== undefined && (typeof name !== 'string' || !isValidTitle(name))) {
			return context.json(
				{ error: `Name must be a string between 1 and ${MAX_TITLE_LENGTH} characters` },
				400
			);
		}

		if (description !== undefined && typeof description !== 'string') {
			return context.json(
				{ error: 'Description must be a string' },
				400
			);
		}

		if (description !== undefined && typeof description === 'string' && !isValidDescription(description)) {
			return context.json(
				{ error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or less` },
				400
			);
		}

		const project = await updateProject(id, userId, {
			name,
			description,
		});

		if (!project) {
			return context.json({ error: 'Project not found' }, 404);
		}

		return context.json(projectResponseToApi(project));
	} catch (error) {
		console.error('Failed to update project:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleDeleteProject(context: Context, redis: Redis): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const id = context.req.param('id');

	if (!isValidUUID(id)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	try {
		const deleted = await deleteProject(id, userId);

		if (!deleted) {
			return context.json({ error: 'Project not found' }, 404);
		}

		return context.json({ success: true });
	} catch (error) {
		console.error('Failed to delete project:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}
