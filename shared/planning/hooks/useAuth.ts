import { useState, useEffect, useCallback } from 'preact/hooks';
import { fetchClient } from '@doc-platform/fetch';

export interface AuthUser {
	id: string;
	email: string;
	displayName: string;
}

interface AuthState {
	user: AuthUser | null;
	loading: boolean;
	error: string | null;
}

interface UseAuthResult extends AuthState {
	logout: () => Promise<void>;
	refetch: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
	const [state, setState] = useState<AuthState>({
		user: null,
		loading: true,
		error: null,
	});

	const fetchUser = useCallback(async (): Promise<void> => {
		setState((prev) => ({ ...prev, loading: true, error: null }));

		try {
			const response = await fetchClient.get<{ user: AuthUser }>('/api/auth/me');
			setState({ user: response.user, loading: false, error: null });
		} catch (err) {
			// 401 means not logged in - not an error state
			const status = (err as { status?: number }).status;
			if (status === 401) {
				setState({ user: null, loading: false, error: null });
			} else {
				setState({
					user: null,
					loading: false,
					error: err instanceof Error ? err.message : 'Failed to fetch user',
				});
			}
		}
	}, []);

	const logout = useCallback(async (): Promise<void> => {
		try {
			await fetchClient.post('/api/auth/logout', {});
		} catch {
			// Even if logout fails, continue to clear local state
		}
		setState({ user: null, loading: false, error: null });
	}, []);

	useEffect(() => {
		fetchUser();
	}, [fetchUser]);

	return {
		...state,
		logout,
		refetch: fetchUser,
	};
}
