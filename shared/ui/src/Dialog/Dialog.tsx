import { useEffect, useCallback } from 'preact/hooks';
import type { JSX, ComponentChildren } from 'preact';
import styles from './Dialog.module.css';

export interface DialogProps {
	/** Whether the dialog is open (default: true for conditional rendering) */
	open?: boolean;
	/** Called when dialog should close */
	onClose: () => void;
	/** Dialog title */
	title?: string;
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
	children,
	maxWidth = 'md',
	class: className,
}: DialogProps): JSX.Element | null {
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
				{title && (
					<div class={styles.header}>
						<h2 id="dialog-title" class={styles.title}>{title}</h2>
						<button
							type="button"
							class={styles.closeButton}
							onClick={onClose}
							aria-label="Close"
						>
							×
						</button>
					</div>
				)}
				<div class={styles.content}>
					{children}
				</div>
			</div>
		</div>
	);
}
