const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * When the data last loaded, in words (spec, Summary strip and Loading, empty, and errors):
 * "Updated just now", "Updated 4 min ago". A refresh that failed keeps the Map as it is and
 * says so: "Updated 4 min ago, retrying". Nothing sets `retrying` until polling lands.
 */
export function freshnessText(updatedAt: number, now: number, retrying = false): string {
	const age = Math.max(0, now - updatedAt);
	let ago: string;
	if (age < MINUTE) ago = 'just now';
	else if (age < HOUR) ago = `${Math.floor(age / MINUTE)} min ago`;
	else if (age < DAY) ago = `${Math.floor(age / HOUR)} h ago`;
	else ago = `${Math.floor(age / DAY)} d ago`;
	return `Updated ${ago}${retrying ? ', retrying' : ''}`;
}
