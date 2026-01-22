import { useState, useEffect, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@doc-platform/router';
import { fetchClient } from '@doc-platform/fetch';
import { Button, Page } from '@doc-platform/ui';
import styles from './AdminWaitlist.module.css';

interface WaitlistSignup {
	id: string;
	email: string;
	company: string | null;
	role: string | null;
	use_case: string | null;
	created_at: string;
}

interface WaitlistResponse {
	signups: WaitlistSignup[];
	total: number;
	limit: number;
	offset: number;
}

const SIGNUPS_PER_PAGE = 20;

export function AdminWaitlist(_props: RouteProps): JSX.Element {
	const [signups, setSignups] = useState<WaitlistSignup[]>([]);
	const [total, setTotal] = useState(0);
	const [offset, setOffset] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Search filter
	const [searchInput, setSearchInput] = useState('');
	const [search, setSearch] = useState('');

	const fetchSignups = useCallback(async () => {
		setLoading(true);
		setError(null);

		try {
			const params = new URLSearchParams();
			params.set('limit', String(SIGNUPS_PER_PAGE));
			params.set('offset', String(offset));
			if (search) params.set('search', search);

			const response = await fetchClient.get<WaitlistResponse>(`/api/waitlist?${params}`);
			setSignups(response.signups);
			setTotal(response.total);
		} catch (err) {
			const status = (err as { status?: number })?.status;
			if (status === 403) {
				setError('You do not have permission to view the waitlist');
			} else {
				setError('Failed to load waitlist signups');
			}
		} finally {
			setLoading(false);
		}
	}, [offset, search]);

	useEffect(() => {
		fetchSignups();
	}, [fetchSignups]);

	// Debounced search
	useEffect(() => {
		const timer = setTimeout(() => {
			setSearch(searchInput);
			setOffset(0);
		}, 300);
		return () => clearTimeout(timer);
	}, [searchInput]);

	const formatDate = (dateStr: string): string => {
		return new Date(dateStr).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
		});
	};

	const totalPages = Math.ceil(total / SIGNUPS_PER_PAGE);
	const currentPage = Math.floor(offset / SIGNUPS_PER_PAGE) + 1;

	return (
		<Page title="Early Access Waitlist">
			<div class={styles.content}>
				<div class={styles.controls}>
					<input
						type="text"
						class={styles.searchInput}
						placeholder="Search by email, company, or role..."
						aria-label="Search waitlist"
						value={searchInput}
						onInput={(e) => setSearchInput((e.target as HTMLInputElement).value)}
					/>
				</div>

				{error && <div class={styles.error}>{error}</div>}

				{loading ? (
					<div class={styles.loading}>Loading...</div>
				) : signups.length === 0 ? (
					<div class={styles.emptyState}>
						{search ? 'No signups match your search' : 'No waitlist signups yet'}
					</div>
				) : (
					<>
						<div class={styles.tableWrapper}>
							<table class={styles.table}>
								<thead>
									<tr>
										<th>Email</th>
										<th>Company</th>
										<th>Role</th>
										<th>Signed Up</th>
									</tr>
								</thead>
								<tbody>
									{signups.map((signup) => (
										<tr key={signup.id}>
											<td>
												<span class={styles.email}>{signup.email}</span>
											</td>
											<td>
												{signup.company || <span class={styles.muted}>—</span>}
											</td>
											<td>
												{signup.role || <span class={styles.muted}>—</span>}
											</td>
											<td class={styles.date}>{formatDate(signup.created_at)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>

						{totalPages > 1 && (
							<div class={styles.pagination}>
								<span class={styles.paginationInfo}>
									Page {currentPage} of {totalPages} ({total} signups)
								</span>
								<div class={styles.paginationButtons}>
									<Button
										class="secondary"
										disabled={currentPage <= 1}
										onClick={() => setOffset(Math.max(0, offset - SIGNUPS_PER_PAGE))}
									>
										Previous
									</Button>
									<Button
										class="secondary"
										disabled={currentPage >= totalPages}
										onClick={() => setOffset(offset + SIGNUPS_PER_PAGE)}
									>
										Next
									</Button>
								</div>
							</div>
						)}
					</>
				)}
			</div>
		</Page>
	);
}
