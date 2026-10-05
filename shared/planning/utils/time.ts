/** Relative time for card footers and presence rows. */
export function formatTimeAgo(dateString: string): string {
	const diffMs = Date.now() - new Date(dateString).getTime();
	const diffMinutes = Math.floor(diffMs / (1000 * 60));
	const diffHours = Math.floor(diffMinutes / 60);
	const diffDays = Math.floor(diffHours / 24);
	if (diffDays > 0) return `${diffDays}d ago`;
	if (diffHours > 0) return `${diffHours}h ago`;
	if (diffMinutes > 0) return `${diffMinutes}m ago`;
	return 'just now';
}

/** A day as a short date, the year only when it isn't this one: "Sep 19". */
export function formatDate(dateString: string): string {
	const date = new Date(dateString);
	return date.toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
		...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
	});
}

/** A moment as a short date and time, the year only when it isn't this one: "Oct 3, 3:12 PM". */
export function formatDateTime(dateString: string): string {
	const date = new Date(dateString);
	return date.toLocaleString(undefined, {
		month: 'short',
		day: 'numeric',
		...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
		hour: 'numeric',
		minute: '2-digit',
	});
}
