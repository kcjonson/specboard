/**
 * Project handlers
 */

import type { Context } from 'hono';
import {
	getProjects,
	getProject,
	createProject,
	updateProject,
	deleteProject,
} from '@doc-platform/db';
import type { Project as DbProject } from '@doc-platform/db';
import { dbProjectToApi } from '../transform.js';
import { isValidUUID, isValidTitle, MAX_TITLE_LENGTH } from '../validation.js';

// Stub user ID until auth is wired up
const STUB_USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

function getUserId(_context: Context): string {
	// TODO: Get from session once auth is wired up
	return STUB_USER_ID;
}

export async function handleListProjects(context: Context): Promise<Response> {
	const userId = getUserId(context);

	try {
		const projects = await getProjects(userId);

		const apiProjects = projects.map((project) => ({
			...dbProjectToApi(project as unknown as DbProject),
			epicCount: project.epicCount,
		}));

		return context.json(apiProjects);
	} catch (error) {
		console.error('Failed to fetch projects:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleGetProject(context: Context): Promise<Response> {
	const userId = getUserId(context);
	const id = context.req.param('id');

	if (!isValidUUID(id)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	try {
		const project = await getProject(id, userId);

		if (!project) {
			return context.json({ error: 'Project not found' }, 404);
		}

		return context.json(dbProjectToApi(project as unknown as DbProject));
	} catch (error) {
		console.error('Failed to fetch project:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleCreateProject(context: Context): Promise<Response> {
	const userId = getUserId(context);

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

		const project = await createProject(userId, {
			name,
			description: description || undefined,
		});

		return context.json(dbProjectToApi(project as unknown as DbProject), 201);
	} catch (error) {
		console.error('Failed to create project:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleUpdateProject(context: Context): Promise<Response> {
	const userId = getUserId(context);
	const id = context.req.param('id');

	if (!isValidUUID(id)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	try {
		const body = await context.req.json();
		const { name, description } = body;

		if (name !== undefined && !isValidTitle(name)) {
			return context.json(
				{ error: `Name must be between 1 and ${MAX_TITLE_LENGTH} characters` },
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

		return context.json(dbProjectToApi(project as unknown as DbProject));
	} catch (error) {
		console.error('Failed to update project:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleDeleteProject(context: Context): Promise<Response> {
	const userId = getUserId(context);
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
