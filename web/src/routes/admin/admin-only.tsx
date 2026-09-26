import type { ComponentType, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { RouteProps } from '@specboard/router';
import { UserModel } from '@specboard/models';
import { NotFound } from '@specboard/ui';
import styles from './admin-only.module.css';

async function currentUserIsAdmin(): Promise<boolean> {
	// Built empty so the constructor doesn't start its own fetch, whose
	// failure nothing could catch
	const me = new UserModel();
	me.id = 'me';
	await me.fetch();
	return me.roles?.includes('admin') ?? false;
}

/**
 * Wrap an admin route so it renders only for a user who holds the admin role
 * right now. The role is re-read from the API on every navigation into the
 * route; until it answers nothing admin-specific renders, and a non-admin or
 * a failed check gets the same NotFound page as an unknown URL.
 */
export function adminOnly(Page: ComponentType<RouteProps>): ComponentType<RouteProps> {
	return function AdminOnly(props: RouteProps): JSX.Element {
		const [checked, setChecked] = useState<{ props: RouteProps; isAdmin: boolean } | null>(null);

		// The router renders a fresh props object on every navigation, so keying
		// on it re-checks between two URLs of the same route too, and a result
		// only counts for the navigation that asked for it
		useEffect(() => {
			let current = true;
			currentUserIsAdmin()
				.catch(() => false)
				.then((isAdmin) => {
					if (current) setChecked({ props, isAdmin });
				});
			return () => {
				current = false;
			};
		}, [props]);

		if (checked?.props !== props) {
			return <div class={styles.loading}>Loading...</div>;
		}
		return checked.isAdmin ? <Page {...props} /> : <NotFound />;
	};
}
