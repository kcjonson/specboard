/**
 * @doc-platform/models - Preact hooks
 *
 * Hooks for subscribing to Model changes in Preact components.
 */

import { useState, useEffect, useCallback } from 'preact/hooks';
import type { Model } from './Model';
import type { SyncModel } from './SyncModel';
import type { ModelMeta } from './types';

/**
 * Subscribe to a Model's changes and trigger re-renders.
 *
 * @example
 * ```tsx
 * function UserCard({ user }: { user: User }) {
 *   useModel(user);
 *   return <div>{user.name}</div>;
 * }
 * ```
 */
export function useModel<T extends Record<string, unknown>>(model: Model<T>): Model<T> {
	const [, forceUpdate] = useState(0);

	useEffect(() => {
		const handleChange = (): void => {
			forceUpdate((n) => n + 1);
		};

		model.on('change', handleChange);

		// No cleanup since Model doesn't have off() - listeners persist
		// This is intentional per the original design
	}, [model]);

	return model;
}

/**
 * Subscribe to a SyncModel's changes and get meta state.
 *
 * @example
 * ```tsx
 * function PostView({ post }: { post: Post }) {
 *   const { meta, refetch } = useSyncModel(post);
 *
 *   if (meta.working) return <Spinner />;
 *   if (meta.error) return <Error message={meta.error.message} />;
 *
 *   return (
 *     <article>
 *       <h1>{post.title}</h1>
 *       <button onClick={refetch}>Refresh</button>
 *     </article>
 *   );
 * }
 * ```
 */
export function useSyncModel<T extends Record<string, unknown>>(
	model: SyncModel<T>
): {
	model: SyncModel<T>;
	meta: ModelMeta;
	refetch: () => Promise<void>;
} {
	const [, forceUpdate] = useState(0);

	useEffect(() => {
		const handleChange = (): void => {
			forceUpdate((n) => n + 1);
		};

		model.on('change', handleChange);
	}, [model]);

	const refetch = useCallback(async (): Promise<void> => {
		await model.fetch();
	}, [model]);

	return {
		model,
		meta: model.$meta,
		refetch,
	};
}
