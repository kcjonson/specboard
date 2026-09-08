import type { ItemStatus } from '@specboard/models';
import type { StatusType } from './StatusDot/StatusDot';

/** Status labels shared by every view that renders an item's status. */
export const STATUS_LABELS: Record<ItemStatus, string> = {
	ready: 'Ready',
	in_progress: 'In Progress',
	blocked: 'Blocked',
	in_review: 'In Review',
	done: 'Done',
};

// 'in_review' has no dedicated StatusDot color — fall back to the neutral dot.
export const DOT_STATUS: Record<ItemStatus, StatusType> = {
	ready: 'ready',
	in_progress: 'in_progress',
	blocked: 'blocked',
	in_review: 'default',
	done: 'done',
};
