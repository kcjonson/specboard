import type { ItemStatus } from '@specboard/models';

/** Status labels shared by every view that renders an item's status. */
export const STATUS_LABELS: Record<ItemStatus, string> = {
	ready: 'Ready',
	in_progress: 'In Progress',
	blocked: 'Blocked',
	in_review: 'In Review',
	done: 'Done',
};
