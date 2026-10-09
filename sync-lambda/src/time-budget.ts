/**
 * How long a sync may keep going. A Lambda is stopped at its timeout with no chance to
 * record anything, which would leave the project's lock held (and the sync showing as
 * running) until it goes stale. A sync checks its budget as it works and, with enough
 * time left to record the failure, stops with a message saying why.
 */

/** What the project shows when a sync runs out of time. */
export const OUT_OF_TIME_MESSAGE =
	'The repository is too large to sync in one pass. Try a pull again; if it keeps stopping here, the repository needs to be smaller (or its docs moved to their own repository).';

/** Thrown when a sync stops for time; its message is OUT_OF_TIME_MESSAGE. */
export class SyncOutOfTimeError extends Error {
	constructor() {
		super(OUT_OF_TIME_MESSAGE);
		this.name = 'SyncOutOfTimeError';
	}
}

export interface TimeBudget {
	/** Throws SyncOutOfTimeError once less than the reserve is left. */
	check(): void;
}

/**
 * A budget over the Lambda's remaining time (`context.getRemainingTimeInMillis`), keeping
 * `reserveMs` back for recording the failure and returning.
 */
export function timeBudget(remainingMs: () => number, reserveMs = 30_000): TimeBudget {
	return {
		check(): void {
			if (remainingMs() < reserveMs) throw new SyncOutOfTimeError();
		},
	};
}

/** No limit: a sync run in-process in development. */
export const UNLIMITED_TIME: TimeBudget = { check(): void {} };
