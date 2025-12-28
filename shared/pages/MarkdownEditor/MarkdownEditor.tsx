import { useMemo, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import { createEditor, Descendant, Editor, Element as SlateElement, Transforms } from 'slate';
import { Slate, Editable, withReact, RenderElementProps, RenderLeafProps } from 'slate-react';
import { withHistory } from 'slate-history';
import isHotkey from 'is-hotkey';
import { useModel, DocumentModel } from '@doc-platform/models';
import type { MarkType, CustomElement, CustomText } from './types';
import { Toolbar } from './Toolbar';
import styles from './MarkdownEditor.module.css';

// Import types to augment Slate
import './types';

export interface MarkdownEditorProps {
	/** Document model - source of truth for editor content */
	model: DocumentModel;
	/** Placeholder text when empty */
	placeholder?: string;
	/** Read-only mode */
	readOnly?: boolean;
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

// Check if a block type is active
function isBlockActive(editor: Editor, format: string): boolean {
	const { selection } = editor;
	if (!selection) return false;

	const [match] = Array.from(
		Editor.nodes(editor, {
			at: Editor.unhangRange(editor, selection),
			match: n =>
				!Editor.isEditor(n) && SlateElement.isElement(n) && n.type === format,
		})
	);

	return !!match;
}

// Toggle block type
function toggleBlock(editor: Editor, format: CustomElement['type']): void {
	const isActive = isBlockActive(editor, format);
	const isList = format === 'bulleted-list' || format === 'numbered-list';

	Transforms.unwrapNodes(editor, {
		match: n =>
			!Editor.isEditor(n) &&
			SlateElement.isElement(n) &&
			(n.type === 'bulleted-list' || n.type === 'numbered-list'),
		split: true,
	});

	// Handle heading with required level property
	// When toggling to heading, set level; when toggling away from heading, unset level
	let newProperties: Partial<CustomElement>;
	if (!isActive && format === 'heading') {
		newProperties = { type: 'heading', level: 1 };
	} else if (isActive && format === 'heading') {
		// Toggling heading off - remove level property
		newProperties = { type: 'paragraph' };
	} else {
		// Determine target block type
		let targetType: CustomElement['type'];
		if (isActive) {
			targetType = 'paragraph';
		} else if (isList) {
			targetType = 'list-item';
		} else {
			targetType = format;
		}
		newProperties = { type: targetType };
	}

	Transforms.setNodes<CustomElement>(editor, newProperties);

	// Clean up stale properties when switching away from heading
	if (isActive && format === 'heading') {
		Transforms.unsetNodes(editor, 'level', {
			match: n => SlateElement.isElement(n) && n.type === 'paragraph',
		});
	}

	if (!isActive && isList) {
		// Wrap selected list-items in a list container.
		// Note: children:[] is a TypeScript requirement; Slate replaces it with
		// the matched nodes during the wrap operation. The empty array is never used.
		const block: CustomElement = { type: format, children: [] };
		Transforms.wrapNodes(editor, block);
	}
}

// Element renderer
function renderElement(props: RenderElementProps): JSX.Element {
	const { attributes, children, element } = props;

	switch (element.type) {
		case 'heading': {
			// Validate level at runtime, default to 1
			const rawLevel = (element as { level?: unknown }).level;
			const level = typeof rawLevel === 'number' && rawLevel >= 1 && rawLevel <= 6
				? rawLevel
				: 1;
			const HeadingTag = `h${level}` as keyof JSX.IntrinsicElements;
			return <HeadingTag {...attributes} class={styles.heading}>{children}</HeadingTag>;
		}
		case 'blockquote':
			return <blockquote {...attributes} class={styles.blockquote}>{children}</blockquote>;
		case 'code-block': {
			const language = element.language;
			return (
				<pre {...attributes} class={styles.codeBlock} data-language={language}>
					<code class={language ? `language-${language}` : undefined}>{children}</code>
				</pre>
			);
		}
		case 'bulleted-list':
			return <ul {...attributes} class={styles.list}>{children}</ul>;
		case 'numbered-list':
			return <ol {...attributes} class={styles.list}>{children}</ol>;
		case 'list-item':
			return <li {...attributes}>{children}</li>;
		case 'link': {
			// Validate URL and prevent navigation in edit mode
			const href = typeof element.url === 'string' ? element.url : '#';
			return (
				<a
					{...attributes}
					href={href}
					class={styles.link}
					onClick={(e) => e.preventDefault()}
				>
					{children}
				</a>
			);
		}
		case 'thematic-break':
			// Slate requires children to be rendered even for void elements
			return (
				<div {...attributes} class={styles.thematicBreakWrapper}>
					<hr class={styles.thematicBreak} contentEditable={false} />
					{children}
				</div>
			);
		default:
			return <p {...attributes} class={styles.paragraph}>{children}</p>;
	}
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
	if (text.strikethrough) {
		content = <s>{content}</s>;
	}

	return <span {...attributes}>{content}</span>;
}

export function MarkdownEditor({
	model,
	placeholder = 'Start typing...',
	readOnly = false,
}: MarkdownEditorProps): JSX.Element {
	// Subscribe to model changes - this triggers re-renders when model updates
	useModel(model);

	// Create editor instance with plugins
	const editor = useMemo(
		() => withHistory(withReact(createEditor())),
		[]
	);

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

	// Handle value changes - update the model
	const handleChange = useCallback(
		(value: Descendant[]) => {
			// Check if content actually changed (not just selection)
			const isAstChange = editor.operations.some(
				op => op.type !== 'set_selection'
			);
			if (isAstChange) {
				// Update model - this will emit a change event
				model.set({ content: value, dirty: true });
			}
		},
		[editor, model]
	);

	return (
		<div class={styles.container}>
			{/* Key on documentId forces Slate to re-mount when loading different documents.
			    Slate's initialValue is only read on mount, so we need a new instance for new docs. */}
			<Slate key={model.documentId} editor={editor} initialValue={model.content} onChange={handleChange}>
				{!readOnly && (
					<Toolbar
						isMarkActive={(mark) => isMarkActive(editor, mark)}
						isBlockActive={(block) => isBlockActive(editor, block)}
						toggleMark={(mark) => toggleMark(editor, mark)}
						toggleBlock={(block) => toggleBlock(editor, block as CustomElement['type'])}
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
						autoFocus
					/>
				</div>
			</Slate>
		</div>
	);
}
