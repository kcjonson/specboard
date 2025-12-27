/**
 * API types (camelCase for JSON responses)
 */

import type { EpicStatus } from '@doc-platform/db';

export interface ApiEpic {
	id: string;
	title: string;
	description?: string;
	status: EpicStatus;
	creator?: string;
	assignee?: string;
	rank: number;
	createdAt: string;
	updatedAt: string;
}

export interface ApiTask {
	id: string;
	epicId: string;
	title: string;
	status: EpicStatus;
	assignee?: string;
	dueDate?: string;
	rank: number;
}

export interface TaskStats {
	total: number;
	done: number;
}
