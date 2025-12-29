/**
 * Server-rendered 404 page
 * Uses the shared NotFound component for consistency with client-side
 */

import { render } from 'preact-render-to-string';
import { NotFound } from '@doc-platform/ui';

export interface NotFoundPageOptions {
	sharedCssPath?: string;
}

export function renderNotFoundPage(options: NotFoundPageOptions = {}): string {
	const { sharedCssPath } = options;

	const cssLinks = [sharedCssPath]
		.filter(Boolean)
		.map(path => `<link rel="stylesheet" href="${path}">`)
		.join('\n\t');

	const content = render(<NotFound />);

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Page Not Found - Doc Platform</title>
	${cssLinks}
</head>
<body>
	${content}
</body>
</html>`;
}
