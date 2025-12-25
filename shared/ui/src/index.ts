/**
 * @doc-platform/ui
 * Shared Preact UI components.
 *
 * Styling is done via CSS class modifiers:
 * - Size: class="size-sm" or class="size-lg"
 * - Variants: class="variant-secondary", class="variant-danger", etc.
 * - States: class="error"
 * - Padding: class="padding-sm", class="padding-lg", class="padding-none"
 */

// Button
export { Button } from './Button/Button';
export type { ButtonProps } from './Button/Button';

// Dialog
export { Dialog } from './Dialog/Dialog';
export type { DialogProps } from './Dialog/Dialog';

// Text (text input)
export { Text } from './Text/Text';
export type { TextProps } from './Text/Text';

// Textarea
export { Textarea } from './Textarea/Textarea';
export type { TextareaProps } from './Textarea/Textarea';

// Select
export { Select } from './Select/Select';
export type { SelectProps, SelectOption } from './Select/Select';

// Card
export { Card } from './Card/Card';
export type { CardProps } from './Card/Card';

// Badge
export { Badge } from './Badge/Badge';
export type { BadgeProps } from './Badge/Badge';

// StatusDot
export { StatusDot } from './StatusDot/StatusDot';
export type { StatusDotProps, StatusType } from './StatusDot/StatusDot';
