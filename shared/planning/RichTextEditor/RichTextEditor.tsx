import { useMemo, useCallback, useRef, useEffect } from 'preact/hooks';
import type { JSX } from 'preact';
import { createEditor, Descendant, Editor, Node } from 'slate';
import { Slate, Editable, withReact, RenderElementProps, RenderLeafProps } from 'slate-react';
import { withHistory } from 'slate-history';
import isHotkey from 'is-hotkey';
import type { MarkType, CustomText } from './types';
import { Toolbar } from './Toolbar';
import styles from './RichTextEditor.module.css';

// Import types to augment Slate
import './types';

export interface RichTextEditorProps {
	/** Initial value as Slate nodes */
	value: Descendant[];
	/** Callback when content changes */
	onChange: (value: Descendant[]) => void;
	/** Placeholder text when empty */
	placeholder?: string;
	/** Read-only mode */
	readOnly?: boolean;
}

// Default empty value
const EMPTY_VALUE: Descendant[] = [
	{ type: 'paragraph', children: [{ text: '' }] }
];

// Hotkey mappings
const HOTKEYS: Record<string, MarkType> = {
	'mod+b': 'bold',
	'mod+i': 'italic',
	'mod+`': 'code',
};

// Check if a mark is active
function isMarkActive(editor: Editor, format: MarkType): boolean {
	const marks = Editor.marks(editor);
	return marks ? marks[format] === true : false;
}

// Toggle a mark on/off
function toggleMark(editor: Editor, format: MarkType): void {
	const isActive = isMarkActive(editor, format);
	if (isActive) {
		Editor.removeMark(editor, format);
	} else {
		Editor.addMark(editor, format, true);
	}
}

// Element renderer
function renderElement(props: RenderElementProps): JSX.Element {
	const { attributes, children } = props;
	return <p {...attributes} class={styles.paragraph}>{children}</p>;
}

// Leaf renderer (text with marks)
function renderLeaf(props: RenderLeafProps): JSX.Element {
	const { attributes, children, leaf } = props;
	let content = children;
	const text = leaf as CustomText;

	if (text.bold) {
		content = <strong>{content}</strong>;
	}
	if (text.italic) {
		content = <em>{content}</em>;
	}
	if (text.code) {
		content = <code class={styles.inlineCode}>{content}</code>;
	}

	return <span {...attributes}>{content}</span>;
}

// Serialize Slate value to plain text
export function serializeToText(nodes: Descendant[]): string {
	return nodes.map(n => Node.string(n)).join('\n');
}

// Deserialize plain text to Slate value
export function deserializeFromText(text: string): Descendant[] {
	if (!text || text.trim() === '') {
		return EMPTY_VALUE;
	}
	const lines = text.split('\n');
	return lines.map(line => ({
		type: 'paragraph' as const,
		children: [{ text: line }],
	}));
}

export function RichTextEditor({
	value,
	onChange,
	placeholder = 'Add a description...',
	readOnly = false,
}: RichTextEditorProps): JSX.Element {
	const editorWrapperRef = useRef<HTMLDivElement>(null);

	// Create editor instance with plugins
	const editor = useMemo(
		() => withHistory(withReact(createEditor())),
		[]
	);

	// Ensure value is valid
	const initialValue = value.length > 0 ? value : EMPTY_VALUE;

	// Handle keyboard shortcuts
	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			for (const hotkey in HOTKEYS) {
				if (isHotkey(hotkey, event)) {
					event.preventDefault();
					const mark = HOTKEYS[hotkey];
					toggleMark(editor, mark);
				}
			}
		},
		[editor]
	);

	// Handle value changes
	const handleChange = useCallback(
		(newValue: Descendant[]) => {
			// Check if content actually changed (not just selection)
			const isAstChange = editor.operations.some(
				op => op.type !== 'set_selection'
			);
			if (isAstChange) {
				onChange(newValue);
			}
		},
		[editor, onChange]
	);

	// Auto-resize the editor wrapper when content changes
	useEffect(() => {
		if (editorWrapperRef.current) {
			const wrapper = editorWrapperRef.current;
			// Reset height to auto to measure natural content height
			wrapper.style.height = 'auto';
			// Get the scroll height which is the actual content height
			const contentHeight = wrapper.scrollHeight;
			// Set the height, but CSS max-height (50vh) will cap it
			wrapper.style.height = `${contentHeight}px`;
		}
	}, [value]);

	return (
		<div class={styles.container}>
			<Slate editor={editor} initialValue={initialValue} onChange={handleChange}>
				{!readOnly && (
					<Toolbar
						isMarkActive={(mark) => isMarkActive(editor, mark)}
						toggleMark={(mark) => toggleMark(editor, mark)}
					/>
				)}
				<div ref={editorWrapperRef} class={styles.editorWrapper}>
					<Editable
						class={styles.editable}
						renderElement={renderElement}
						renderLeaf={renderLeaf}
						placeholder={placeholder}
						readOnly={readOnly}
						onKeyDown={handleKeyDown}
						spellCheck
					/>
				</div>
			</Slate>
		</div>
	);
}
