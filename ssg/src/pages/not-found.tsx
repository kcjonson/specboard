/**
 * 404 Not Found page content component
 */
import type { JSX } from 'preact';

export function NotFoundContent(): JSX.Element {
	return (
		<div class="not-found-container">
			<h1>You appear to be lost...</h1>
			<p>
				The page you're looking for doesn't exist or may have been moved.
				Don't worry, it happens to the best of us.
			</p>
			<a href="/">Take me home</a>
		</div>
	);
}
