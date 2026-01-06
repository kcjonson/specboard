/**
 * Project handlers
 */

import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import { getSession, SESSION_COOKIE_NAME } from '@doc-platform/auth';
import {
	getProjects,
	getProject,
	createProject,
	updateProject,
	deleteProject,
} from '@doc-platform/db';
import { projectResponseToApi } from '../transform.js';
import { isValidUUID, isValidTitle, isValidDescription, MAX_TITLE_LENGTH, MAX_DESCRIPTION_LENGTH } from '../validation.js';

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
	const fieldsParam = context.req.query('fields');
	const requestedFields = fieldsParam ? fieldsParam.split(',').map((f) => f.trim()) : null;

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
		const { name, description } = body;

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

		const project = await createProject(userId, {
			name,
			description: description || undefined,
		});

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
