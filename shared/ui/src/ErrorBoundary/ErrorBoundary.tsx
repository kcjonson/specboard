import { Component } from 'preact';
import type { ComponentChildren, JSX } from 'preact';
import styles from './ErrorBoundary.module.css';

interface ErrorBoundaryProps {
	/** Content to render when no error */
	children: ComponentChildren;
	/** Optional custom fallback UI */
	fallback?: ComponentChildren;
	/** Called when an error is caught */
	onError?: (error: Error, errorInfo: { componentStack: string }) => void;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
}

/**
 * Error boundary component that catches JavaScript errors in child components.
 * Displays a fallback UI instead of crashing the whole app.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: { componentStack: string }): void {
		this.props.onError?.(error, errorInfo);
		console.error('ErrorBoundary caught an error:', error);
		console.error('Component stack:', errorInfo.componentStack);
	}

	handleRetry = (): void => {
		this.setState({ hasError: false, error: null });
	};

	render(): ComponentChildren {
		if (this.state.hasError) {
			// Custom fallback
			if (this.props.fallback) {
				return this.props.fallback;
			}

			// Default fallback UI
			return (
				<div class={styles.errorContainer}>
					<div class={styles.errorContent}>
						<div class={styles.errorIcon}>!</div>
						<h3 class={styles.errorTitle}>Something went wrong</h3>
						<p class={styles.errorMessage}>
							{this.state.error?.message || 'An unexpected error occurred'}
						</p>
						<button class={styles.retryButton} onClick={this.handleRetry}>
							Try Again
						</button>
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}

/**
 * HOC to wrap a component with an error boundary
 */
export function withErrorBoundary<P extends object>(
	WrappedComponent: (props: P) => JSX.Element,
	fallback?: ComponentChildren
): (props: P) => JSX.Element {
	return function WithErrorBoundary(props: P): JSX.Element {
		return (
			<ErrorBoundary fallback={fallback}>
				<WrappedComponent {...props} />
			</ErrorBoundary>
		);
	};
}
