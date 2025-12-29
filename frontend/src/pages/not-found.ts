/**
 * Server-rendered 404 page
 * Friendly message without technical details
 */

export interface NotFoundPageOptions {
	sharedCssPath?: string;
	notFoundCssPath?: string;
}

export function renderNotFoundPage(options: NotFoundPageOptions = {}): string {
	const { sharedCssPath, notFoundCssPath } = options;

	const cssLinks = [sharedCssPath, notFoundCssPath]
		.filter(Boolean)
		.map(path => `<link rel="stylesheet" href="${path}">`)
		.join('\n\t');

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Page Not Found - Doc Platform</title>
	${cssLinks}
</head>
<body>
	<div class="not-found-container">
		<h1>You appear to be lost...</h1>
		<p>
			The page you're looking for doesn't exist or may have been moved.
			Don't worry, it happens to the best of us.
		</p>
		<a href="/projects">Take me home</a>
	</div>
</body>
</html>`;
}
