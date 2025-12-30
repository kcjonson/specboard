import type { JSX } from 'preact';
import { notFoundHtml } from '../not-found';

export function NotFound(): JSX.Element {
	return <div dangerouslySetInnerHTML={{ __html: notFoundHtml }} />;
}
