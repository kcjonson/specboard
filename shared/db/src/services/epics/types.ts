/**
 * Epic service response types (camelCase for API/MCP responses)
 */

import type { EpicType, EpicStatus, SubStatus } from '../../types.ts';

export interface TaskStats {
	total: number;
	done: number;
	inProgress: number;
	blocked: number;
}

export interface EpicSummary {
	id: string;
	title: string;
	type: EpicType;
	description: string | null;
	specDocPath: string | null;
	createdAt: Date;
}

export interface TaskSummary {
	id: string;
	title: string;
	status: string;
	details: string | null;
	note: string | null;
}

export interface ProgressNoteSummary {
	id: string;
	note: string;
	createdBy: string;
	createdAt: Date;
}

export interface EpicResponse {
	id: string;
	title: string;
	type: EpicType;
	description: string | null;
	status: EpicStatus;
	subStatus: SubStatus;
	creator: string | null;
	rank: number;
	specDocPath: string | null;
	prUrl: string | null;
	branchName: string | null;
	notes: string | null;
	createdAt: Date;
	updatedAt: Date;
	taskStats: TaskStats;
}

export interface EpicWithTasks extends EpicResponse {
	tasks: TaskSummary[];
}

export interface EpicWithDetails extends EpicWithTasks {
	progressNotes: ProgressNoteSummary[];
}

export interface CurrentWorkEpic {
	id: string;
	title: string;
	type: EpicType;
	status: EpicStatus;
	subStatus: SubStatus;
	specDocPath: string | null;
	prUrl: string | null;
	branchName: string | null;
	taskStats: TaskStats;
	currentTask: TaskSummary | null;
	recentNotes: Array<{ note: string; createdAt: Date }>;
}

export interface CurrentWorkResponse {
	inProgressEpics: CurrentWorkEpic[];
	readyEpics: EpicSummary[];
}

export interface CreateEpicInput {
	title: string;
	type?: EpicType;
	description?: string;
	status?: EpicStatus;
	creator?: string;
	rank?: number;
	specDocPath?: string;
}

export interface UpdateEpicInput {
	title?: string;
	description?: string;
	status?: EpicStatus;
	subStatus?: SubStatus;
	rank?: number;
	specDocPath?: string;
	prUrl?: string;
	branchName?: string;
	notes?: string;
}
