import { FetchError, fetchErrorText } from '@specboard/fetch';
import { refreshProject } from './project';

/**
 * The message to show for a project write the server didn't take: its own words when it
 * sent some ("You have view access to this project"), else `fallback`. A 403 means the
 * caller's role moved under the page (an owner demoted them, GitHub was disconnected
 * elsewhere), so the project is re-read and the page turns read-only to match.
 */
export function writeFailure(err: unknown, fallback: string, projectRef: string): string {
	if (err instanceof FetchError && err.status === 403) refreshProject(projectRef);
	return fetchErrorText(err, fallback);
}
