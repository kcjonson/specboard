/**
 * @doc-platform/models - Preact hooks
 *
 * Hooks for subscribing to Model and Collection changes in Preact components.
 */

import { useState, useEffect } from 'preact/hooks';
import type { Observable } from './types';

/**
 * Subscribe to an Observable's changes and trigger re-renders.
 * Works with Model, SyncModel, and Collection.
 *
 * @example
 * ```tsx
 * // Subscribe to a Model
 * function UserCard({ user }: { user: User }) {
 *   useModel(user);
 *   return <div>{user.name}</div>;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Subscribe to a Collection directly (granular updates)
 * function TaskList({ epic }: { epic: Epic }) {
 *   useModel(epic.tasks); // Only re-renders when tasks change
 *   return (
 *     <ul>
 *       {epic.tasks.map(task => <TaskItem task={task} />)}
 *     </ul>
 *   );
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
export function useModel<T extends Observable>(observable: T): T {
	const [, forceUpdate] = useState(0);

	useEffect(() => {
		const handleChange = (): void => {
			forceUpdate((n) => n + 1);
		};

		observable.on('change', handleChange);

		return () => {
			observable.off('change', handleChange);
		};
	}, [observable]);

	return observable;
}
