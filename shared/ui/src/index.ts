/**
 * @doc-platform/ui
 * Shared Preact UI components with element-based styling.
 *
 * Import CSS files:
 * - `@doc-platform/ui/tokens.css` - Design tokens (colors, spacing, etc.)
 * - `@doc-platform/ui/elements.css` - Base element styles (button, input, textarea)
 *
 * Components pass through CSS classes for styling:
 * - <Button class="secondary size-sm">
 * - <Text class="size-lg error">
 * - <Textarea class="error">
 *
 * Native HTML elements are styled automatically by elements.css,
 * enabling SSR pages to use the same styles without JavaScript.
 */

// Button
export { Button } from './Button/Button';
export type { ButtonProps } from './Button/Button';

// Dialog
export { Dialog } from './Dialog/Dialog';
export type { DialogProps } from './Dialog/Dialog';

// Form components (Text, Select, Textarea with label/error support)
export { Text } from './form/Text';
export type { TextProps } from './form/Text';

export { Textarea } from './form/Textarea';
export type { TextareaProps } from './form/Textarea';

export { Select } from './form/Select';
export type { SelectProps, SelectOption } from './form/Select';

// Card
export { Card } from './Card/Card';
export type { CardProps } from './Card/Card';

// Badge
export { Badge } from './Badge/Badge';
export type { BadgeProps } from './Badge/Badge';

// StatusDot
export { StatusDot } from './StatusDot/StatusDot';
export type { StatusDotProps, StatusType } from './StatusDot/StatusDot';

// UserMenu
export { UserMenu } from './UserMenu/UserMenu';
export type { UserMenuProps } from './UserMenu/UserMenu';

// WebHeader - auth-aware header for web apps (fetches user internally)
export { WebHeader } from './WebHeader/WebHeader';
export type { WebHeaderProps, NavTabLabel } from './WebHeader/WebHeader';

// Page - standard page layout with header
export { Page } from './Page/Page';
export type { PageProps } from './Page/Page';

// NotFound
export { NotFound } from './NotFound/NotFound';
export { notFoundHtml } from './not-found';

// EditorToolbar - shared toolbar components for Slate editors
export {
	ToolbarContainer,
	ToolbarGroup,
	ToolbarSeparator,
	ToolbarButton,
} from './EditorToolbar/EditorToolbar';
export type {
	ToolbarContainerProps,
	ToolbarGroupProps,
	ToolbarSeparatorProps,
	ToolbarButtonProps,
} from './EditorToolbar/EditorToolbar';

// Icon - SVG outline icons
export { Icon } from './Icon/Icon';
export type { IconProps, IconName } from './Icon/Icon';

// ErrorBoundary - catches JS errors in child components
export { ErrorBoundary, withErrorBoundary } from './ErrorBoundary/ErrorBoundary';
