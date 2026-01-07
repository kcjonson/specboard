import { useEffect, useCallback } from 'preact/hooks';
import type { JSX, ComponentChildren } from 'preact';
import { Icon } from '../Icon/Icon';
import styles from './Dialog.module.css';

export interface DialogProps {
	/** Whether the dialog is open (default: true for conditional rendering) */
	open?: boolean;
	/** Called when dialog should close (required for controlled behavior) */
	onClose: () => void;
	/** Dialog title/label in header */
	title?: string;
	/** Whether to show close button in header (default: true when header is visible) */
	showCloseButton?: boolean;
	/** Custom actions to render in header (before close button) */
	headerActions?: ComponentChildren;
	/** Dialog content */
	children: ComponentChildren;
	/** Maximum width of the dialog */
	maxWidth?: 'sm' | 'md' | 'lg' | 'xl';
	/** Additional CSS class for dialog */
	class?: string;
}

export function Dialog({
	open = true,
	onClose,
	title,
	showCloseButton,
	headerActions,
	children,
	maxWidth = 'md',
	class: className,
}: DialogProps): JSX.Element | null {
	// Show header if title is provided OR showCloseButton is explicitly true OR headerActions are provided
	const showHeader = Boolean(title) || showCloseButton === true || Boolean(headerActions);
	// Show close button by default when header is visible, unless explicitly disabled
	const shouldShowCloseButton = showHeader && showCloseButton !== false;
	// Handle escape key
	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				onClose();
			}
		},
		[onClose]
	);

	useEffect(() => {
		if (!open) return;

		document.addEventListener('keydown', handleKeyDown);
		document.body.style.overflow = 'hidden';

		return () => {
			document.removeEventListener('keydown', handleKeyDown);
			document.body.style.overflow = '';
		};
	}, [open, handleKeyDown]);

	if (!open) return null;

	const handleBackdropClick = (e: MouseEvent): void => {
		if (e.target === e.currentTarget) {
			onClose();
		}
	};

	const dialogClasses = [
		styles.dialog,
		styles[maxWidth],
		className,
	].filter(Boolean).join(' ');

	return (
		<div
			class={styles.backdrop}
			onClick={handleBackdropClick}
			role="dialog"
			aria-modal="true"
			aria-labelledby={title ? 'dialog-title' : undefined}
		>
			<div class={dialogClasses}>
				{showHeader && (
					<div class={styles.header}>
						{title && (
							<h2 id="dialog-title" class={styles.title}>{title}</h2>
						)}
						{!title && <div class={styles.headerSpacer} />}
						<div class={styles.headerActions}>
							{headerActions}
							{shouldShowCloseButton && (
								<button
									type="button"
									class={styles.closeButton}
									onClick={onClose}
									aria-label="Close"
								>
									<Icon name="close" class="size-lg" />
								</button>
							)}
						</div>
					</div>
				)}
				<div class={styles.content}>
					{children}
				</div>
			</div>
		</div>
	);
}
