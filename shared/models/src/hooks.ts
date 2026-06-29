/**
 * @specboard/models - Preact hooks
 *
 * Hooks for subscribing to Model and Collection changes in Preact components.
 */

import { useState, useEffect, useRef } from 'preact/hooks';
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
export function useModel<T extends Observable>(observable: T | null | undefined): T | null | undefined {
	const [, forceUpdate] = useState(0);

	// Snapshot whether the observable was mid-fetch at render time. A SyncModel/
	// SyncCollection starts an auto-fetch in its constructor, which runs during render;
	// it can resolve before our effect subscribes, so the resulting change fires with no
	// listener and is lost — leaving the component stuck mid-fetch (a permanent
	// "Loading…"). We re-check this in the effect to recover, without an unconditional
	// extra render on every mount.
	const wasWorking = (observable as { $meta?: { working?: boolean } } | null | undefined)?.$meta?.working ?? false;
	const wasWorkingRef = useRef(wasWorking);
	wasWorkingRef.current = wasWorking;

	useEffect(() => {
		if (!observable) return;

		const handleChange = (): void => {
			forceUpdate((n) => n + 1);
		};

		observable.on('change', handleChange);

		// If a fetch in flight at render finished before we subscribed, we missed its
		// change — re-render once to pick it up. Only when the fetch state actually
		// flipped, so there's no extra render when nothing changed in the gap.
		const nowWorking = (observable as { $meta?: { working?: boolean } }).$meta?.working ?? false;
		if (nowWorking !== wasWorkingRef.current) {
			forceUpdate((n) => n + 1);
		}

		return () => {
			observable.off('change', handleChange);
		};
	}, [observable]);

	return observable;
}
