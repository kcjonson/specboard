import type { JSX } from 'preact';
import { useSlate } from 'slate-react';
import { ToolbarContainer, ToolbarGroup, ToolbarButton } from '@specboard/ui';
import type { MarkType } from './types';

export interface ToolbarProps {
	isMarkActive: (mark: MarkType) => boolean;
	toggleMark: (mark: MarkType) => void;
}

interface MarkButtonProps {
	format: MarkType;
	icon: string;
	title: string;
	ariaLabel: string;
	isActive: (mark: MarkType) => boolean;
	toggle: (mark: MarkType) => void;
}

function MarkButton({ format, icon, title, ariaLabel, isActive, toggle }: MarkButtonProps): JSX.Element {
	// Access editor context to trigger re-renders
	useSlate();

	return (
		<ToolbarButton
			active={isActive(format)}
			onAction={() => toggle(format)}
			title={title}
			ariaLabel={ariaLabel}
			compact
		>
			{icon}
		</ToolbarButton>
	);
}

export function Toolbar({ isMarkActive, toggleMark }: ToolbarProps): JSX.Element {
	return (
		<ToolbarContainer compact ariaLabel="Formatting options">
			<ToolbarGroup ariaLabel="Text formatting">
				<MarkButton format="bold" icon="B" title="Bold (Ctrl+B)" ariaLabel="Bold" isActive={isMarkActive} toggle={toggleMark} />
				<MarkButton format="italic" icon="I" title="Italic (Ctrl+I)" ariaLabel="Italic" isActive={isMarkActive} toggle={toggleMark} />
				<MarkButton format="code" icon="<>" title="Inline code (Ctrl+`)" ariaLabel="Inline code" isActive={isMarkActive} toggle={toggleMark} />
			</ToolbarGroup>
		</ToolbarContainer>
	);
}
