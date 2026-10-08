/**
 * Checks on item fields as a caller sends them, shared by the REST handlers and the MCP
 * tools so both refuse a bad value in their own words before the database's constraints
 * would. The limits mirror the columns (018_unify_items.sql).
 */

import type { ItemStatus, ItemType, SubStatus } from '../types.ts';

const ITEM_STATUSES: readonly ItemStatus[] = ['ready', 'in_progress', 'blocked', 'in_review', 'done'];
const SUB_STATUSES: readonly SubStatus[] = ['not_started', 'scoping', 'in_development', 'paused', 'needs_input', 'pr_open', 'complete'];
const ITEM_TYPES: readonly ItemType[] = ['epic', 'task', 'bug'];

/** items.title and projects.name are VARCHAR(255). */
export const MAX_TITLE_LENGTH = 255;
/** items.branch_name is VARCHAR(255). */
export const MAX_BRANCH_NAME_LENGTH = 255;

export function isValidStatus(status: unknown): status is ItemStatus {
	return typeof status === 'string' && ITEM_STATUSES.includes(status as ItemStatus);
}

export function isValidSubStatus(subStatus: unknown): subStatus is SubStatus {
	return typeof subStatus === 'string' && SUB_STATUSES.includes(subStatus as SubStatus);
}

export function isValidType(type: unknown): type is ItemType {
	return typeof type === 'string' && ITEM_TYPES.includes(type as ItemType);
}

/** A title (or a project name): 1 to MAX_TITLE_LENGTH characters. */
export function isValidTitle(title: string): boolean {
	return title.length > 0 && title.length <= MAX_TITLE_LENGTH;
}

export function isValidBranchName(branchName: string): boolean {
	return branchName.length <= MAX_BRANCH_NAME_LENGTH;
}
