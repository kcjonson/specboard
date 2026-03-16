# UI Library & Design System Specification

This specification defines the shared UI component library and design token system.

---

## Overview

Establish consistent, well-structured UI primitives in `@specboard/ui` with proper component APIs, design tokens, and icon management.

---

## Requirements

### Component API Standards
- Button: use `label` and `icon` props, not children
- Consistent prop patterns across all components
- Proper TypeScript interfaces for all component props

### Icon System
- Icons in individual files (not one monolithic file)
- Tree-shakeable icon imports
- Consistent sizing and color inheritance

### Design Tokens
- Refine `tokens.css` with complete token coverage
- Spacing, typography, color, shadow, border radius scales
- Document token usage guidelines

### Component Library
- Audit and refine existing shared components
- Custom checkbox with checked/unchecked/partial states
- Consistent patterns for form elements

---

## Dependencies

None

## Status

Needs design
