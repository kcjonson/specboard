/**
 * Epic service response types (camelCase for API/MCP responses)
 */

import type { EpicType, EpicStatus, SubStatus, SpecType } from '../../types.ts';

export interface TaskStats {
	total: number;
	done: number;
	inProgress: number;
	blocked: number;
}

export interface SpecSummary {
	id: string;
	path: string;
	type: SpecType;
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
	specs: SpecSummary[];
}

export interface CreateEpicInput {
	title: string;
	type?: EpicType;
	description?: string;
	status?: EpicStatus;
	creator?: string;
	rank?: number;
}

export interface UpdateEpicInput {
	title?: string;
	description?: string;
	status?: EpicStatus;
	subStatus?: SubStatus;
	rank?: number;
	prUrl?: string;
	branchName?: string;
	notes?: string;
}
