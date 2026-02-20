import { useMemo, useCallback, useRef, useState, useEffect } from 'preact/hooks';
import type { RefObject } from 'preact';
import type { JSX } from 'preact';
import { createEditor, Descendant, Editor, Element as SlateElement, Transforms, Range } from 'slate';
import { Slate, Editable, withReact, RenderElementProps, RenderLeafProps, ReactEditor } from 'slate-react';
import { withHistory } from 'slate-history';
import isHotkey from 'is-hotkey';
import { useModel, DocumentModel } from '@specboard/models';
import type { MarkType, CustomElement, CustomText, Comment } from './types';
import { Toolbar } from './Toolbar';
import { CommentsMargin, PendingComment } from './CommentsMargin';
import styles from './MarkdownEditor.module.css';

// Import types to augment Slate
import './types';

/** Ref handle for imperative editor operations */
export interface MarkdownEditorHandle {
	/** Replace entire editor content using Slate Transforms (undoable) */
	replaceContent: (content: Descendant[]) => void;
}

export interface MarkdownEditorProps {
	/** Document model - source of truth for editor content */
	model: DocumentModel;
	/** Comments to display alongside the document */
	comments?: Comment[];
	/** Placeholder text when empty */
	placeholder?: string;
	/** Read-only mode */
	readOnly?: boolean;
	/** Called when a new comment is added. Receives the generated commentId that was applied to text. */
	onAddComment?: (commentId: string, commentText: string, anchorText: string) => void;
	/** Called when a reply is added to a comment */
	onReply?: (commentId: string, replyText: string) => void;
	/** Called when a comment's resolved status is toggled */
	onToggleResolved?: (commentId: string) => void;
	/** Ref to access imperative editor operations */
	editorRef?: RefObject<MarkdownEditorHandle>;
}

// Hotkey mappings
const HOTKEYS: Record<string, MarkType> = {
	'mod+b': 'bold',
	'mod+i': 'italic',
	'mod+`': 'code',
};

// Check if a mark is active
function isMarkActive(editor: Editor, format: MarkType): boolean {
	try {
		const marks = Editor.marks(editor);
		return marks ? marks[format] === true : false;
	} catch {
		// Can throw if selection is in an invalid position (e.g., inside a table structure)
		return false;
	}
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

	try {
		const [match] = Array.from(
			Editor.nodes(editor, {
				at: Editor.unhangRange(editor, selection),
				match: n =>
					!Editor.isEditor(n) && SlateElement.isElement(n) && n.type === format,
			})
		);

		return !!match;
	} catch {
		// Can throw if selection is at an invalid path
		return false;
	}
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
			// Use explicit switch to avoid complex union type
			switch (level) {
				case 1: return <h1 {...attributes} class={styles.heading}>{children}</h1>;
				case 2: return <h2 {...attributes} class={styles.heading}>{children}</h2>;
				case 3: return <h3 {...attributes} class={styles.heading}>{children}</h3>;
				case 4: return <h4 {...attributes} class={styles.heading}>{children}</h4>;
				case 5: return <h5 {...attributes} class={styles.heading}>{children}</h5>;
				case 6: return <h6 {...attributes} class={styles.heading}>{children}</h6>;
				default: return <h1 {...attributes} class={styles.heading}>{children}</h1>;
			}
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
		case 'table':
			return (
				<table {...attributes} class={styles.table}>
					<tbody>{children}</tbody>
				</table>
			);
		case 'table-row':
			return <tr {...attributes} class={styles.tableRow}>{children}</tr>;
		case 'table-cell': {
			const isHeader = element.header === true;
			if (isHeader) {
				return <th {...attributes} class={styles.tableCell}>{children}</th>;
			}
			return <td {...attributes} class={styles.tableCell}>{children}</td>;
		}
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
	if (text.commentId) {
		content = (
			<mark
				class={styles.commentHighlight}
				data-comment-id={text.commentId}
				aria-label="Text with comment"
			>
				{content}
			</mark>
		);
	}

	return <span {...attributes}>{content}</span>;
}

export function MarkdownEditor({
	model,
	comments = [],
	placeholder = 'Start typing...',
	readOnly = false,
	onAddComment,
	onReply,
	onToggleResolved,
	editorRef,
}: MarkdownEditorProps): JSX.Element {
	// Subscribe to model changes - this triggers re-renders when model updates
	useModel(model);

	// Ref to the editable container for comment positioning
	const editableRef = useRef<HTMLDivElement>(null);

	// Currently active/selected comment
	const [activeCommentId, setActiveCommentId] = useState<string | undefined>();

	// Pending comment state (when user initiates add comment)
	const [pendingComment, setPendingComment] = useState<PendingComment | undefined>();

	// Store the selection when initiating a new comment
	const pendingSelectionRef = useRef<Range | null>(null);

	// Create editor instance with plugins
	const editor = useMemo(
		() => withHistory(withReact(createEditor())),
		[]
	);

	// Expose imperative editor operations via ref
	useEffect(() => {
		if (editorRef) {
			editorRef.current = {
				replaceContent: (content: Descendant[]) => {
					Editor.withoutNormalizing(editor, () => {
						// Select all content
						Transforms.select(editor, {
							anchor: Editor.start(editor, []),
							focus: Editor.end(editor, []),
						});
						// Delete selection (all content)
						Transforms.delete(editor);
						// Insert new content at the start
						Transforms.insertNodes(editor, content, { at: [0] });
						// Remove the empty paragraph that may remain
						if (editor.children.length > content.length) {
							Transforms.removeNodes(editor, { at: [editor.children.length - 1] });
						}
					});
					// Deselect to avoid stale selection issues
					Transforms.deselect(editor);
				},
			};
		}
	}, [editor, editorRef]);

	// Check if there's a non-collapsed text selection
	const hasTextSelection = useCallback((): boolean => {
		const { selection } = editor;
		if (!selection || Range.isCollapsed(selection)) {
			return false;
		}
		// Check that the selection contains actual text
		const text = Editor.string(editor, selection);
		return text.length > 0;
	}, [editor]);

	// Get the top position for a new comment based on current selection
	const getSelectionTop = useCallback((): number => {
		try {
			const { selection } = editor;
			if (!selection) return 0;

			const domRange = ReactEditor.toDOMRange(editor, selection);
			const rect = domRange.getBoundingClientRect();
			const containerRect = editableRef.current?.getBoundingClientRect();

			if (containerRect) {
				return rect.top - containerRect.top;
			}
			return rect.top;
		} catch {
			return 0;
		}
	}, [editor]);

	// Initiate adding a new comment
	const handleInitiateAddComment = useCallback(() => {
		if (!hasTextSelection()) return;

		// Store the current selection
		pendingSelectionRef.current = editor.selection ? { ...editor.selection } : null;

		// Show the comment input form
		setPendingComment({
			top: getSelectionTop(),
		});
	}, [editor, hasTextSelection, getSelectionTop]);

	// Submit a new comment
	const handleSubmitNewComment = useCallback((commentText: string) => {
		const selection = pendingSelectionRef.current;
		if (!selection || !onAddComment) {
			setPendingComment(undefined);
			pendingSelectionRef.current = null;
			return;
		}

		// Get the selected text
		const anchorText = Editor.string(editor, selection);

		// Generate a unique comment ID
		const commentId = `comment-${Date.now()}-${crypto.randomUUID()}`;

		// Apply the commentId mark to the selected text
		Transforms.select(editor, selection);
		Editor.addMark(editor, 'commentId', commentId);

		// Call the callback to add the comment to the model (pass commentId so it matches the mark)
		onAddComment(commentId, commentText, anchorText);

		// Clear pending state
		setPendingComment(undefined);
		pendingSelectionRef.current = null;

		// Focus the editor (can throw if editor is unmounted)
		try {
			ReactEditor.focus(editor);
		} catch {
			// Editor may have been unmounted
		}
	}, [editor, onAddComment]);

	// Cancel adding a new comment
	const handleCancelNewComment = useCallback(() => {
		setPendingComment(undefined);
		pendingSelectionRef.current = null;
		// Focus the editor (can throw if editor is unmounted)
		try {
			ReactEditor.focus(editor);
		} catch {
			// Editor may have been unmounted
		}
	}, [editor]);

	// Handle keyboard shortcuts
	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			// Check for comment shortcut (Cmd/Ctrl+Shift+M)
			if (isHotkey('mod+shift+m', event)) {
				event.preventDefault();
				if (onAddComment && hasTextSelection()) {
					handleInitiateAddComment();
				}
				return;
			}

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
		[editor, onAddComment, hasTextSelection, handleInitiateAddComment]
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

	// Handle clicking on comment highlights in the editor
	const handleEditableClick = useCallback(
		(event: MouseEvent) => {
			const target = event.target as HTMLElement;
			const commentHighlight = target.closest('[data-comment-id]');
			if (commentHighlight) {
				const commentId = commentHighlight.getAttribute('data-comment-id');
				if (commentId) {
					setActiveCommentId(commentId);
				}
			} else {
				setActiveCommentId(undefined);
			}
		},
		[]
	);

	// Show comments margin if there are comments or if we can add comments
	const showCommentsMargin = comments.length > 0 || pendingComment || onAddComment;

	return (
		<div class={styles.container}>
			{/* Key on documentId forces Slate to re-mount when loading different documents.
			    Slate's initialValue is only read on mount, so we need a new instance for new docs. */}
			<Slate key={model.documentId} editor={editor} initialValue={model.content as Descendant[]} onChange={handleChange}>
				{!readOnly && (
					<Toolbar
						isMarkActive={(mark) => isMarkActive(editor, mark)}
						isBlockActive={(block) => isBlockActive(editor, block)}
						toggleMark={(mark) => toggleMark(editor, mark)}
						toggleBlock={(block) => toggleBlock(editor, block as CustomElement['type'])}
						onAddComment={onAddComment ? handleInitiateAddComment : undefined}
						canAddComment={hasTextSelection()}
					/>
				)}
				<div class={styles.editorWithComments}>
					<div ref={editableRef} class={styles.editorWrapper} data-editor-wrapper onClick={handleEditableClick}>
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
					{showCommentsMargin && (
						<CommentsMargin
							comments={comments}
							editorRef={editableRef}
							activeCommentId={activeCommentId}
							onCommentClick={setActiveCommentId}
							onReply={onReply}
							onToggleResolved={onToggleResolved}
							pendingComment={pendingComment}
							onSubmitNewComment={handleSubmitNewComment}
							onCancelNewComment={handleCancelNewComment}
						/>
					)}
				</div>
			</Slate>
		</div>
	);
}
