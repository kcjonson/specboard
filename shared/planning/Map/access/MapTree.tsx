import type { JSX, Ref } from 'preact';
import { memo } from 'preact/compat';
import type { MapTree as Tree, TreeNode } from './tree-model';
import styles from './MapTree.module.css';

export interface MapTreeProps {
	tree: Tree;
	/** The tree item the Map's keyboard focus is on, which screen readers say without DOM focus ever leaving the tree. */
	activeId: string | undefined;
	/** The item the drawer shows. */
	selectedKey: string | null;
	/** A screen reader's activate on an item does what Enter does on the focused one. */
	onActivate(key: string): void;
	treeRef: Ref<HTMLDivElement>;
}

function Item({ node, selectedKey, onActivate }: { node: TreeNode; selectedKey: string | null; onActivate(key: string): void }): JSX.Element {
	return (
		<div
			role="treeitem"
			id={node.id}
			aria-label={node.name}
			aria-level={node.level}
			aria-setsize={node.setSize}
			aria-posinset={node.position}
			aria-expanded={node.expanded}
			aria-selected={selectedKey === node.key}
			onClick={(event) => {
				event.stopPropagation();
				onActivate(node.key);
			}}
		>
			{node.children.length > 0 && (
				<div role="group">
					{node.children.map((child) => (
						<Item key={child.id} node={child} selectedKey={selectedKey} onActivate={onActivate} />
					))}
				</div>
			)}
		</div>
	);
}

/**
 * The Map's parallel accessible tree (spec, Accessibility). It is the Map's one tab stop and
 * the thing that holds keyboard focus: a visually hidden `tree` that stays where it is while
 * `aria-activedescendant` follows the Map's focus, so a screen reader says the item the keys
 * land on and DOM focus never leaves the Map. Hidden by clipping rather than `display: none`
 * or `aria-hidden`, since either would take it out of the accessibility tree.
 */
function MapTreeView({ tree, activeId, selectedKey, onActivate, treeRef }: MapTreeProps): JSX.Element {
	return (
		<div ref={treeRef} class={styles.tree} role="tree" aria-label={tree.label} aria-activedescendant={activeId} tabIndex={0}>
			{tree.roots.map((node) => (
				<Item key={node.id} node={node} selectedKey={selectedKey} onActivate={onActivate} />
			))}
		</div>
	);
}

export const MapTree = memo(MapTreeView);
