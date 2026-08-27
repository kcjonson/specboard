import { useMemo, useCallback, useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { createEditor, Descendant, Editor, Node, Transforms } from 'slate';
import { Slate, Editable, withReact, RenderElementProps, RenderLeafProps } from 'slate-react';
import { withHistory } from 'slate-history';
import isHotkey from 'is-hotkey';
import type { MarkType, CustomText } from './types';
import { Toolbar } from './Toolbar';
import styles from './RichTextEditor.module.css';

// Import Slate type augmentation from MarkdownEditor (single source of truth)
import '../../pages/MarkdownEditor/types';

export interface RichTextEditorProps {
	/** Current content as Slate nodes; a new array replaces what the editor shows. */
	value: Descendant[];
	/** Callback when content changes */
	onChange: (value: Descendant[]) => void;
	/** Placeholder text when empty */
	placeholder?: string;
	/** Read-only mode */
	readOnly?: boolean;
}

// A fresh empty document. Slate takes ownership of the nodes it is given, so
// every editor and every reset needs its own copy rather than a shared constant.
function emptyValue(): Descendant[] {
	return [{ type: 'paragraph', children: [{ text: '' }] }];
}

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
		return emptyValue();
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
	// Create editor instance with plugins
	const editor = useMemo(
		() => withHistory(withReact(createEditor())),
		[]
	);

	// Ensure value is valid. Memoized so an empty `value` doesn't produce a new
	// document every render and retrigger the sync effect below.
	const content = useMemo(() => (value.length > 0 ? value : emptyValue()), [value]);

	// The document last handed to the editor, whether by us below or by the editor
	// itself through onChange. Comparing against `editor.children` instead would race
	// fast typing: the state that comes back is one keystroke behind what the editor
	// already holds, and the effect would treat that as an external change and undo it.
	const applied = useRef<Descendant[]>(content);

	// The document the replacement below wrote. Slate reports its operations through
	// onChange exactly like a keystroke, and forwarding them would mark the newly
	// opened item dirty and save back a description nobody typed. Matching on the value
	// rather than latching a flag means a replacement that somehow emits nothing can't
	// leave the next real edit suppressed.
	const selfApplied = useRef<Descendant[] | null>(null);

	// Slate reads `initialValue` once, on mount, and ignores it forever after — so a
	// document arriving from outside (the drawer switching to another item, a fetch
	// landing) has to be written in by hand, or the previous item's text stays on
	// screen. It goes in through transforms rather than by assigning `editor.children`:
	// slate-react renders each node from a cache it only invalidates on operations, so
	// a raw assignment updates the model and leaves the old text rendered. History is
	// dropped with it, since undo must not reach back into the replaced document.
	useEffect(() => {
		if (content === applied.current) return;
		applied.current = content;
		Transforms.deselect(editor);
		Editor.withoutNormalizing(editor, () => {
			for (let i = editor.children.length - 1; i >= 0; i--) {
				Transforms.removeNodes(editor, { at: [i] });
			}
			Transforms.insertNodes(editor, content, { at: [0] });
		});
		selfApplied.current = editor.children;
		editor.history = { undos: [], redos: [] };
	}, [editor, content]);

	// Handle keyboard shortcuts
	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			for (const hotkey in HOTKEYS) {
				if (isHotkey(hotkey, event)) {
					event.preventDefault();
					const mark = HOTKEYS[hotkey];
					if (mark) {
						toggleMark(editor, mark);
					}
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
			if (!isAstChange) return;
			if (newValue === selfApplied.current) {
				selfApplied.current = null;
				return;
			}
			applied.current = newValue;
			onChange(newValue);
		},
		[editor, onChange]
	);

	return (
		<div class={styles.container}>
			<Slate editor={editor} initialValue={content} onChange={handleChange}>
				{!readOnly && (
					<Toolbar
						isMarkActive={(mark) => isMarkActive(editor, mark)}
						toggleMark={(mark) => toggleMark(editor, mark)}
					/>
				)}
				<div class={styles.editorWrapper}>
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
