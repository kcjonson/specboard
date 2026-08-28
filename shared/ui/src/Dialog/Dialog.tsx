import { useEffect, useRef } from 'preact/hooks';
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
}: DialogProps): JSX.Element {
	const ref = useRef<HTMLDialogElement>(null);

	// Show header if title is provided OR showCloseButton is explicitly true OR headerActions are provided
	const showHeader = Boolean(title) || showCloseButton === true || Boolean(headerActions);
	// Show close button by default when header is visible, unless explicitly disabled
	const shouldShowCloseButton = showHeader && showCloseButton !== false;

	// Sync controlled `open` with the native element. Mount-with-open covers the
	// conditional-render consumers; the toggle covers consumers that keep the
	// Dialog mounted and flip `open`. The `open` attribute is never rendered in
	// JSX — that would put the element in the non-modal open state.
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		if (open && !el.open) el.showModal();
		else if (!open && el.open) el.close();
	}, [open]);

	// ESC arrives as `cancel`. preventDefault keeps the element open until the
	// parent flips state/unmounts — single source of truth stays with the consumer.
	const handleCancel = (e: Event): void => {
		e.preventDefault();
		onClose();
	};

	// Clicks on ::backdrop retarget to the <dialog> itself. The dialog has
	// padding: 0 and header/content fill it, so an inside click always targets a child.
	const handleClick = (e: MouseEvent): void => {
		if (e.target === ref.current) onClose();
	};

	const dialogClasses = [
		styles.dialog,
		styles[maxWidth],
		className,
	].filter(Boolean).join(' ');

	// Header is always rendered: small screens need a close affordance even on
	// title-less dialogs. CSS hides .headerEmpty / .closeDesktopHidden at >= 768px.
	const headerClasses = showHeader ? styles.header : `${styles.header} ${styles.headerEmpty}`;
	const closeClasses = shouldShowCloseButton
		? styles.closeButton
		: `${styles.closeButton} ${styles.closeDesktopHidden}`;

	return (
		<dialog
			ref={ref}
			class={dialogClasses}
			onCancel={handleCancel}
			onClick={handleClick}
			aria-labelledby={title ? 'dialog-title' : undefined}
		>
			<div class={headerClasses}>
				{title && (
					<h2 id="dialog-title" class={styles.title}>{title}</h2>
				)}
				{!title && <div class={styles.headerSpacer} />}
				<div class={styles.headerActions}>
					{headerActions}
					<button
						type="button"
						class={closeClasses}
						onClick={onClose}
						aria-label="Close"
					>
						<Icon name="close" class="size-lg" />
					</button>
				</div>
			</div>
			<div class={styles.content}>
				{children}
			</div>
		</dialog>
	);
}
