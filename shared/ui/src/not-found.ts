export const notFoundHtml = `<style>
.not-found-container {
	text-align: center;
	padding: 4rem 2rem;
	max-width: 500px;
	margin: 0 auto;
}
.not-found-title {
	font-size: 2rem;
	font-weight: 600;
	margin-bottom: 1rem;
}
.not-found-message {
	font-size: 1.125rem;
	color: #666;
	margin-bottom: 2rem;
	line-height: 1.6;
}
.not-found-link {
	display: inline-block;
	padding: 0.75rem 1.5rem;
	background: #2563eb;
	color: white;
	text-decoration: none;
	border-radius: 6px;
	font-weight: 500;
}
.not-found-link:hover {
	background: #1d4ed8;
}
</style>
<div class="not-found-container">
	<h1 class="not-found-title">You appear to be lost...</h1>
	<p class="not-found-message">
		The page you're looking for doesn't exist or may have been moved.
		Don't worry, it happens to the best of us.
	</p>
	<a href="/projects" class="not-found-link">Take me home</a>
</div>`;
