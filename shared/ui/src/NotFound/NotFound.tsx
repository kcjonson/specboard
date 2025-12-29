import type { JSX } from 'preact';

export interface NotFoundProps {
	/** Additional CSS class */
	class?: string;
}

/**
 * NotFound component - displays a friendly 404 message.
 * Uses plain class names (not CSS modules) for SSR compatibility.
 * Styles are in shared/ui/src/not-found.css
 */
export function NotFound({ class: className }: NotFoundProps = {}): JSX.Element {
	const classes = ['not-found-container', className].filter(Boolean).join(' ');

	return (
		<div class={classes}>
			<h1 class="not-found-title">You appear to be lost...</h1>
			<p class="not-found-message">
				The page you're looking for doesn't exist or may have been moved.
				Don't worry, it happens to the best of us.
			</p>
			<a href="/projects" class="not-found-link">Take me home</a>
		</div>
	);
}
