import type { JSX } from 'preact';
import { useSlate } from 'slate-react';
import { ToolbarContainer, ToolbarGroup, ToolbarSeparator, ToolbarButton } from '@doc-platform/ui';
import type { MarkType, BlockType } from './types';

export interface ToolbarProps {
	isMarkActive: (mark: MarkType) => boolean;
	isBlockActive: (block: string) => boolean;
	toggleMark: (mark: MarkType) => void;
	toggleBlock: (block: string) => void;
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
		>
			{icon}
		</ToolbarButton>
	);
}

interface BlockButtonProps {
	format: BlockType;
	icon: string;
	title: string;
	ariaLabel: string;
	isActive: (block: string) => boolean;
	toggle: (block: string) => void;
}

function BlockButton({ format, icon, title, ariaLabel, isActive, toggle }: BlockButtonProps): JSX.Element {
	// Access editor context to trigger re-renders
	useSlate();

	return (
		<ToolbarButton
			active={isActive(format)}
			onAction={() => toggle(format)}
			title={title}
			ariaLabel={ariaLabel}
		>
			{icon}
		</ToolbarButton>
	);
}

export function Toolbar({ isMarkActive, isBlockActive, toggleMark, toggleBlock }: ToolbarProps): JSX.Element {
	return (
		<ToolbarContainer ariaLabel="Formatting options">
			<ToolbarGroup ariaLabel="Text formatting">
				<MarkButton format="bold" icon="B" title="Bold (Ctrl+B)" ariaLabel="Bold" isActive={isMarkActive} toggle={toggleMark} />
				<MarkButton format="italic" icon="I" title="Italic (Ctrl+I)" ariaLabel="Italic" isActive={isMarkActive} toggle={toggleMark} />
				<MarkButton format="code" icon="<>" title="Inline code (Ctrl+Backtick)" ariaLabel="Inline code" isActive={isMarkActive} toggle={toggleMark} />
				<MarkButton format="strikethrough" icon="~~" title="Strikethrough" ariaLabel="Strikethrough" isActive={isMarkActive} toggle={toggleMark} />
			</ToolbarGroup>
			<ToolbarSeparator />
			<ToolbarGroup ariaLabel="Block formatting">
				<BlockButton format="heading" icon="H1" title="Heading" ariaLabel="Heading" isActive={isBlockActive} toggle={toggleBlock} />
				<BlockButton format="blockquote" icon=">" title="Quote" ariaLabel="Block quote" isActive={isBlockActive} toggle={toggleBlock} />
				<BlockButton format="code-block" icon="{}" title="Code Block" ariaLabel="Code block" isActive={isBlockActive} toggle={toggleBlock} />
			</ToolbarGroup>
			<ToolbarSeparator />
			<ToolbarGroup ariaLabel="List formatting">
				<BlockButton format="bulleted-list" icon="•" title="Bulleted List" ariaLabel="Bulleted list" isActive={isBlockActive} toggle={toggleBlock} />
				<BlockButton format="numbered-list" icon="1." title="Numbered List" ariaLabel="Numbered list" isActive={isBlockActive} toggle={toggleBlock} />
			</ToolbarGroup>
		</ToolbarContainer>
	);
}
