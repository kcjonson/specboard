/**
 * Project handlers
 */

import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import { getSession, SESSION_COOKIE_NAME } from '@specboard/auth';
import {
	getProjects,
	getProjectBySlug,
	resolveProjectSlug,
	createProject,
	updateProject,
	deleteProject,
	ProjectIdentifierTakenError,
} from '@specboard/db';
import { isValidProjectSlug, isValidProjectKey } from '@specboard/core/identifiers';
import { projectResponseToApi } from '../transform.ts';
import { isValidTitle, isValidDescription, MAX_TITLE_LENGTH, MAX_DESCRIPTION_LENGTH } from '../validation.ts';
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
			itemCount: project.itemCount,
			itemCounts: project.itemCounts,
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

	const slug = context.req.param('projectSlug');

	if (!isValidProjectSlug(slug)) {
		return context.json({ error: 'Invalid project slug format' }, 400);
	}

	// Support fields filter for lightweight queries (e.g., ?fields=name)
	// Note: the identifiers (id, slug, key) are always included in filtered responses
	const fieldsParam = context.req.query('fields');
	const requestedFields = fieldsParam
		? fieldsParam.split(',').map((f) => f.trim()).filter((f) => f !== 'id' && f !== 'slug' && f !== 'key')
		: null;

	try {
		const project = await getProjectBySlug(slug, userId);

		if (!project) {
			return context.json({ error: 'Project not found' }, 404);
		}

		const fullResponse = projectResponseToApi(project);

		// If specific fields requested, return only those
		if (requestedFields) {
			const filtered: Record<string, unknown> = { id: fullResponse.id, slug: fullResponse.slug, key: fullResponse.key };
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
		const { name, description, repository, system_prompt: createSystemPrompt } = body;

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

		// Validate and sanitize system_prompt for create
		let sanitizedCreatePrompt: string | undefined;
		if (createSystemPrompt !== undefined && createSystemPrompt !== null) {
			if (typeof createSystemPrompt !== 'string') {
				return context.json({ error: 'System prompt must be a string' }, 400);
			}
			if (createSystemPrompt.length > 10000) {
				return context.json({ error: 'System prompt must be 10,000 characters or less' }, 400);
			}
			// eslint-disable-next-line no-control-regex
			sanitizedCreatePrompt = createSystemPrompt.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
		}

		const project = await createProject(userId, {
			name,
			description: description || undefined,
			systemPrompt: sanitizedCreatePrompt,
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

	const currentSlug = context.req.param('projectSlug');

	if (!isValidProjectSlug(currentSlug)) {
		return context.json({ error: 'Invalid project slug format' }, 400);
	}

	try {
		const body = await context.req.json();
		const { name, description, system_prompt, slug, key } = body;

		if (slug !== undefined && !isValidProjectSlug(slug)) {
			return context.json(
				{ error: 'Slug must be lowercase letters, numbers, and single hyphens' },
				400
			);
		}

		if (key !== undefined && !isValidProjectKey(key)) {
			return context.json(
				{ error: 'Key must be 2-10 characters: an uppercase letter followed by uppercase letters or digits' },
				400
			);
		}

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

		// Validate system_prompt
		if (system_prompt !== undefined && system_prompt !== null) {
			if (typeof system_prompt !== 'string') {
				return context.json({ error: 'System prompt must be a string' }, 400);
			}
			if (system_prompt.length > 10000) {
				return context.json({ error: 'System prompt must be 10,000 characters or less' }, 400);
			}
		}

		// Strip control characters from system_prompt if provided
		// eslint-disable-next-line no-control-regex
		const CONTROL_CHAR_REGEX = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
		const sanitizedSystemPrompt = typeof system_prompt === 'string'
			? system_prompt.replace(CONTROL_CHAR_REGEX, '')
			: undefined;

		const resolved = await resolveProjectSlug(currentSlug, userId);
		if (!resolved) {
			return context.json({ error: 'Project not found' }, 404);
		}

		const project = await updateProject(resolved.id, userId, {
			name,
			description,
			systemPrompt: sanitizedSystemPrompt,
			slug,
			key,
		});

		if (!project) {
			return context.json({ error: 'Project not found' }, 404);
		}

		return context.json(projectResponseToApi(project));
	} catch (error) {
		if (error instanceof ProjectIdentifierTakenError) {
			return context.json({ error: error.message, code: 'IDENTIFIER_TAKEN', field: error.field }, 409);
		}
		console.error('Failed to update project:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleDeleteProject(context: Context, redis: Redis): Promise<Response> {
	const userId = await getUserId(context, redis);
	if (!userId) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	const slug = context.req.param('projectSlug');

	if (!isValidProjectSlug(slug)) {
		return context.json({ error: 'Invalid project slug format' }, 400);
	}

	try {
		const resolved = await resolveProjectSlug(slug, userId);
		if (!resolved) {
			return context.json({ error: 'Project not found' }, 404);
		}

		const deleted = await deleteProject(resolved.id, userId);

		if (!deleted) {
			return context.json({ error: 'Project not found' }, 404);
		}

		return context.json({ success: true });
	} catch (error) {
		console.error('Failed to delete project:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}
