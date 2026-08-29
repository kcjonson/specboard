import { useEffect, useId, useRef } from 'preact/hooks';
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
	const titleId = useId();
	// Set while we close the element ourselves (unmount cleanup), so the native
	// `close` listener doesn't call onClose into a parent that's tearing down.
	const suppressCloseSync = useRef(false);

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
		if (open && !el.open) {
			el.showModal();
			// showModal's focusing steps honor [autofocus] on a descendant; without
			// one they focus the first tabbable — the header close X, where Enter
			// dismisses. Focus the dialog itself instead (tabIndex=-1 below makes it
			// focusable) so Tab reaches the content in order.
			if (!el.querySelector('[autofocus]')) el.focus();
		} else if (!open && el.open) {
			el.close();
		}
	}, [open]);

	// Consumers that conditionally render unmount while open; close the element
	// first so the top layer exits and focus restores to the opener.
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		return () => {
			if (el.open) {
				suppressCloseSync.current = true;
				el.close();
			}
		};
	}, []);

	// ESC arrives as `cancel`. preventDefault keeps the element open until the
	// parent flips state/unmounts — single source of truth stays with the consumer.
	const handleCancel = (e: Event): void => {
		e.preventDefault();
		onClose();
	};

	// Safety net: if the element closes without going through props (close-watcher
	// edge cases where `cancel` never fires), resync the owner so `open` can't
	// wedge at true against a closed element.
	const handleNativeClose = (): void => {
		if (suppressCloseSync.current) return;
		if (open) onClose();
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
	// title-less dialogs. CSS hides .headerEmpty (and mobile-only closes) at >= 768px.
	const headerClasses = showHeader ? styles.header : `${styles.header} ${styles.headerEmpty}`;
	const closeClasses = shouldShowCloseButton ? 'icon' : 'icon mobile-only';

	return (
		<dialog
			ref={ref}
			class={dialogClasses}
			tabIndex={-1}
			onCancel={handleCancel}
			onClose={handleNativeClose}
			onClick={handleClick}
			aria-labelledby={title ? titleId : undefined}
		>
			<div class={headerClasses}>
				{title && (
					<h2 id={titleId} class={styles.title}>{title}</h2>
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
