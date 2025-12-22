/**
 * @doc-platform/models - Preact hooks
 *
 * Hooks for subscribing to Model changes in Preact components.
 */

import { useState, useEffect } from 'preact/hooks';
import { Model } from './Model';

/**
 * Subscribe to a Model's changes and trigger re-renders.
 * Works with both Model and SyncModel.
 *
 * @example
 * ```tsx
 * function UserCard({ user }: { user: User }) {
 *   useModel(user);
 *   return <div>{user.name}</div>;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With SyncModel - access $meta directly
 * function PostView({ post }: { post: Post }) {
 *   useModel(post);
 *
 *   if (post.$meta.working) return <Spinner />;
 *   if (post.$meta.error) return <Error message={post.$meta.error.message} />;
 *
 *   return (
 *     <article>
 *       <h1>{post.title}</h1>
 *       <button onClick={() => post.fetch()}>Refresh</button>
 *     </article>
 *   );
 * }
 * ```
 */
export function useModel<T extends Model>(model: T): T {
	const [, forceUpdate] = useState(0);

	useEffect(() => {
		const handleChange = (): void => {
			forceUpdate((n) => n + 1);
		};

		model.on('change', handleChange);

		return () => {
			model.off('change', handleChange);
		};
	}, [model]);

	return model;
}
