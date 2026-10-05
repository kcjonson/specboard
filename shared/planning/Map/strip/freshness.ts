const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * When the data last loaded, in words (spec, Summary strip and Loading, empty, and errors):
 * "Updated just now", "Updated 4 min ago". A refresh that failed keeps the Map as it is and
 * says so: "Updated 4 min ago, retrying". Short, for a strip with no room: "Updated now",
 * "Updated 4m", "Updated 3h", "Updated 2d".
 */
export function freshnessText(updatedAt: number, now: number, retrying = false, short = false): string {
	const age = Math.max(0, now - updatedAt);
	let ago: string;
	if (age < MINUTE) ago = short ? 'now' : 'just now';
	else if (age < HOUR) ago = short ? `${Math.floor(age / MINUTE)}m` : `${Math.floor(age / MINUTE)} min ago`;
	else if (age < DAY) ago = short ? `${Math.floor(age / HOUR)}h` : `${Math.floor(age / HOUR)} h ago`;
	else ago = short ? `${Math.floor(age / DAY)}d` : `${Math.floor(age / DAY)} d ago`;
	return `Updated ${ago}${retrying ? ', retrying' : ''}`;
}
