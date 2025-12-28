/**
 * API types (camelCase for JSON responses)
 */

import type { EpicStatus, TaskStatus } from '@doc-platform/db';

export interface ApiEpic {
	id: string;
	title: string;
	description?: string;
	status: EpicStatus;
	creator?: string;
	assignee?: string;
	rank: number;
	specDocPath?: string;
	prUrl?: string;
	createdAt: string;
	updatedAt: string;
}

export interface ApiTask {
	id: string;
	epicId: string;
	title: string;
	status: TaskStatus;
	assignee?: string;
	dueDate?: string;
	rank: number;
	details?: string;
	blockReason?: string;
}

export interface TaskStats {
	total: number;
	done: number;
}

export interface ApiProgressNote {
	id: string;
	epicId?: string;
	taskId?: string;
	note: string;
	createdBy?: string;
	createdAt: string;
}
