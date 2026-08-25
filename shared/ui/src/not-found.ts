export const notFoundHtml = `<style>
.not-found-container {
	text-align: center;
	padding: 4rem 2rem;
	max-width: 500px;
	margin: 0 auto;
}
.not-found-mark {
	margin-bottom: 1.5rem;
}
.not-found-mark polygon,
.not-found-mark rect {
	fill: var(--color-primary);
}
.not-found-title {
	font-size: 2rem;
	font-weight: 600;
	margin-bottom: 1rem;
}
.not-found-message {
	font-size: 1.125rem;
	color: var(--color-text-muted);
	margin-bottom: 2rem;
	line-height: 1.6;
}
.not-found-link {
	display: inline-block;
	padding: 0.75rem 1.5rem;
	background: var(--color-primary);
	color: var(--color-text-inverse);
	text-decoration: none;
	border-radius: 6px;
	font-weight: 500;
}
.not-found-link:hover {
	background: var(--color-primary-hover);
}
</style>
<div class="not-found-container">
	<svg class="not-found-mark" width="51" height="32" viewBox="0 0 240 150" aria-hidden="true">
		<polygon points="28,30 76,62 28,94"/>
		<rect x="108" y="92" width="92" height="30" rx="7"/>
	</svg>
	<h1 class="not-found-title">You appear to be lost...</h1>
	<p class="not-found-message">
		The page you're looking for doesn't exist or may have been moved.
		Don't worry, it happens to the best of us.
	</p>
	<a href="/" class="not-found-link">Take me home</a>
</div>`;
