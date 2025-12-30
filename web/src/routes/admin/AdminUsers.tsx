import { useState, useEffect, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@doc-platform/router';
import { navigate } from '@doc-platform/router';
import { fetchClient } from '@doc-platform/fetch';
import { Button } from '@doc-platform/ui';
import styles from './AdminUsers.module.css';

interface User {
	id: string;
	username: string;
	email: string;
	first_name: string;
	last_name: string;
	email_verified: boolean;
	roles: string[];
	is_active: boolean;
	created_at: string;
}

interface UsersResponse {
	users: User[];
	total: number;
	limit: number;
	offset: number;
}

const USERS_PER_PAGE = 20;

export function AdminUsers(_props: RouteProps): JSX.Element {
	const [users, setUsers] = useState<User[]>([]);
	const [total, setTotal] = useState(0);
	const [offset, setOffset] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Filters
	const [searchInput, setSearchInput] = useState('');
	const [search, setSearch] = useState('');
	const [statusFilter, setStatusFilter] = useState('');

	const fetchUsers = useCallback(async () => {
		setLoading(true);
		setError(null);

		try {
			const params = new URLSearchParams();
			params.set('limit', String(USERS_PER_PAGE));
			params.set('offset', String(offset));
			if (search) params.set('search', search);
			if (statusFilter) params.set('is_active', statusFilter);

			const response = await fetchClient.get<UsersResponse>(`/api/users?${params}`);
			setUsers(response.users);
			setTotal(response.total);
		} catch (err) {
			setError('Failed to load users');
		} finally {
			setLoading(false);
		}
	}, [offset, search, statusFilter]);

	useEffect(() => {
		fetchUsers();
	}, [fetchUsers]);

	// Debounced search
	useEffect(() => {
		const timer = setTimeout(() => {
			setSearch(searchInput);
			setOffset(0);
		}, 300);
		return () => clearTimeout(timer);
	}, [searchInput]);

	const handleUserClick = (user: User): void => {
		navigate(`/admin/users/${user.id}`);
	};

	const formatDate = (dateStr: string): string => {
		return new Date(dateStr).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		});
	};

	const totalPages = Math.ceil(total / USERS_PER_PAGE);
	const currentPage = Math.floor(offset / USERS_PER_PAGE) + 1;

	return (
		<div class={styles.container}>
			<div class={styles.content}>
				<nav class={styles.nav}>
					<a href="/admin" class={styles.backLink}>
						← Back to Admin
					</a>
				</nav>

				<h1 class={styles.title}>Users</h1>

				<div class={styles.controls}>
					<input
						type="text"
						class={styles.searchInput}
						placeholder="Search users..."
						value={searchInput}
						onInput={(e) => setSearchInput((e.target as HTMLInputElement).value)}
					/>
					<select
						class={styles.filterSelect}
						value={statusFilter}
						onChange={(e) => { setStatusFilter((e.target as HTMLSelectElement).value); setOffset(0); }}
					>
						<option value="">All Status</option>
						<option value="true">Active</option>
						<option value="false">Inactive</option>
					</select>
				</div>

				{error && <div class={styles.error}>{error}</div>}

				{loading ? (
					<div class={styles.loading}>Loading...</div>
				) : users.length === 0 ? (
					<div class={styles.emptyState}>
						{search || statusFilter ? 'No users match your filters' : 'No users found'}
					</div>
				) : (
					<>
						<table class={styles.table}>
							<thead>
								<tr>
									<th>User</th>
									<th>Roles</th>
									<th>Status</th>
									<th>Created</th>
								</tr>
							</thead>
							<tbody>
								{users.map((user) => (
									<tr key={user.id} onClick={() => handleUserClick(user)}>
										<td>
											<div class={styles.userInfo}>
												<span class={styles.userName}>
													{user.first_name} {user.last_name}
												</span>
												<span class={styles.userEmail}>
													@{user.username} · {user.email}
												</span>
											</div>
										</td>
										<td>
											{user.roles.includes('admin') && (
												<span class={`${styles.badge} ${styles.badgeAdmin}`}>Admin</span>
											)}
											{user.roles.length === 0 && (
												<span style="color: var(--color-text-muted)">—</span>
											)}
										</td>
										<td>
											<span class={`${styles.badge} ${user.is_active ? styles.badgeActive : styles.badgeInactive}`}>
												{user.is_active ? 'Active' : 'Inactive'}
											</span>
										</td>
										<td>{formatDate(user.created_at)}</td>
									</tr>
								))}
							</tbody>
						</table>

						{totalPages > 1 && (
							<div class={styles.pagination}>
								<span class={styles.paginationInfo}>
									Page {currentPage} of {totalPages} ({total} users)
								</span>
								<div class={styles.paginationButtons}>
									<Button
										class="secondary"
										disabled={currentPage <= 1}
										onClick={() => setOffset(Math.max(0, offset - USERS_PER_PAGE))}
									>
										Previous
									</Button>
									<Button
										class="secondary"
										disabled={currentPage >= totalPages}
										onClick={() => setOffset(offset + USERS_PER_PAGE)}
									>
										Next
									</Button>
								</div>
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
}
