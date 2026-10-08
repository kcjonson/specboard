import type { MapItemRow } from '@specboard/core/map-read';
import { STATUS_LABELS, glyphStatus } from '@specboard/ui';
import { agoText, deviceLabel, type Agents } from '../agents';
import { SUB_STATUS_LABELS, waitingOn } from '../cards/card-content';
import type { MapLayout } from '../layout/types';
import { reasonsText, type NeedsPersonReasons } from '../needs-person';
import { upNextNumbers } from '../up-next';

/**
 * The accessible tree (spec, Accessibility): the Map as a screen reader meets it. Families
 * are groups holding their children, standalone items sit beside them, and the newest anchor
 * comes first, so what is happening now is where the tree starts. Collapse mirrors the Map: a
 * folded family is a closed item with its children out of the tree, since the Map doesn't draw
 * them. Each item's name carries what its glyph, ring, and number carry on the canvas.
 */

export interface TreeNode {
	/** The Map node it stands for: an item's key, or `session:...` and `computer:...` for agents. */
	key: string;
	id: string;
	name: string;
	/** 1 at the top. */
	level: number;
	setSize: number;
	/** 1-based among its siblings. */
	position: number;
	/** Undefined for something that can't open or close. */
	expanded?: boolean;
	/** Empty unless it is open. */
	children: TreeNode[];
}

export interface MapTree {
	roots: TreeNode[];
	/** Every node in the tree by its key. */
	nodes: ReadonlyMap<string, TreeNode>;
	/** The tree's own name. */
	label: string;
}

export interface TreeInput {
	layout: MapLayout;
	rows: ReadonlyMap<string, MapItemRow>;
	needs: NeedsPersonReasons;
	liveItems: ReadonlySet<string>;
	working: Agents;
	/** Epoch ms, for how long ago an agent last wrote. */
	now: number;
	/** Makes node ids unique to one Map on the page. */
	idPrefix: string;
	summarized: boolean;
}

/** What an item is, in a line a screen reader can say: key and title, then everything the dot draws. */
export function itemName(row: MapItemRow, input: Pick<TreeInput, 'layout' | 'needs' | 'liveItems'>, family: { size: number; open: boolean } | null): string {
	const parts = [`${row.key}: ${row.title}`, STATUS_LABELS[glyphStatus(row.status, row.blocked)]];
	const sub = row.subStatus ? SUB_STATUS_LABELS[row.subStatus] : undefined;
	if (sub) parts.push(sub);
	const waiting = waitingOn(row);
	// A bare "Blocked" only repeats the status.
	if (waiting && waiting !== parts[1]) parts.push(waiting);
	if (row.textBlockerCount > 0) parts.push(row.textBlockerCount === 1 ? '1 hold' : `${row.textBlockerCount} holds`);
	const reasons = input.needs.get(row.key);
	if (reasons) parts.push(`Needs a person: ${reasonsText(reasons)}`);
	const upNext = upNextNumbers(input.layout.upNext).get(row.key);
	if (upNext !== undefined) parts.push(`Up next, number ${upNext}`);
	if (input.liveItems.has(row.key)) parts.push('Live agent session');
	if (family) parts.push(family.open ? `${family.size} items inside` : `Collapsed, ${family.size} items inside`);
	return parts.join(', ');
}

const timeOf = (row: MapItemRow): number => {
	const at = Date.parse(row.timeAnchor);
	return Number.isFinite(at) ? at : 0;
};

export function buildTree(input: TreeInput): MapTree {
	const { layout, rows, working, now } = input;
	const children = new Map<string | null, MapItemRow[]>();
	for (const row of rows.values()) {
		const parent = row.parentKey !== null && rows.has(row.parentKey) ? row.parentKey : null;
		const list = children.get(parent);
		if (list) list.push(row);
		else children.set(parent, [row]);
	}
	// The newest anchor anywhere under an item: a family sits where its latest work does.
	const anchors = new Map<string, number>();
	const anchorOf = (row: MapItemRow): number => {
		const known = anchors.get(row.key);
		if (known !== undefined) return known;
		let newest = timeOf(row);
		for (const child of children.get(row.key) ?? []) newest = Math.max(newest, anchorOf(child));
		anchors.set(row.key, newest);
		return newest;
	};
	const regions = new Set(layout.regions.map((region) => region.key));
	const folded = new Set(layout.collapsed);
	const nodes = new Map<string, TreeNode>();
	let count = 0;
	const idOf = (): string => `${input.idPrefix}-${count++}`;

	const sizeOf = (row: MapItemRow): number => {
		let size = 0;
		for (const child of children.get(row.key) ?? []) size += 1 + sizeOf(child);
		return size + (row.summarizedDescendants ?? 0);
	};

	const build = (siblings: readonly MapItemRow[], level: number): TreeNode[] => {
		const ordered = [...siblings].sort((a, b) => anchorOf(b) - anchorOf(a) || (a.key < b.key ? -1 : 1));
		return ordered.map((row, i) => {
			const hasChildren = (children.get(row.key)?.length ?? 0) > 0;
			const open = regions.has(row.key) && hasChildren;
			const closed = folded.has(row.key) && hasChildren;
			const family = open || closed ? { size: sizeOf(row), open } : null;
			const node: TreeNode = {
				key: row.key,
				id: idOf(),
				name: itemName(row, input, family),
				level,
				setSize: ordered.length,
				position: i + 1,
				expanded: open ? true : closed ? false : undefined,
				children: [],
			};
			nodes.set(row.key, node);
			if (open) node.children = build(children.get(row.key)!, level + 1);
			return node;
		});
	};
	const roots = build(children.get(null) ?? [], 1);

	if (working.computers.length > 0) {
		// Last, after every item: the agents are a group of their own beside the items, not part of any family.
		for (const root of roots) root.setSize++;
		const agents: TreeNode = {
			key: 'agents',
			id: idOf(),
			name: `Agents at work: ${plural(working.computers.length, 'computer')}, ${plural(working.sessions.length, 'session')}`,
			level: 1,
			setSize: roots.length + 1,
			position: roots.length + 1,
			expanded: true,
			children: [],
		};
		agents.children = working.computers.map((computer, i) => {
			const label = deviceLabel(computer.device);
			const node: TreeNode = {
				key: computer.node,
				id: idOf(),
				name: `Computer ${label}, ${computer.live ? 'live' : 'quiet'}, ${plural(computer.sessions.length, 'session')}`,
				level: 2,
				setSize: working.computers.length,
				position: i + 1,
				expanded: true,
				children: [],
			};
			node.children = computer.sessions.map((session, j) => {
				const items = session.items.map((item) => item.key).join(', ');
				const leaf: TreeNode = {
					key: session.node,
					id: idOf(),
					name: `Session ${session.number} on ${label}, ${session.state}, last wrote ${agoText(now - session.lastWriteAt)}, on ${items}`,
					level: 3,
					setSize: computer.sessions.length,
					position: j + 1,
					children: [],
				};
				nodes.set(leaf.key, leaf);
				return leaf;
			});
			nodes.set(node.key, node);
			return node;
		});
		nodes.set(agents.key, agents);
		roots.push(agents);
	}

	const label = `Map of ${rows.size} ${rows.size === 1 ? 'item' : 'items'}${input.summarized ? ', with finished families summarized' : ''}`;
	return { roots, nodes, label };
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The tree item that stands for a focused key: its own, or the nearest open ancestor's when
 * the Map draws it inside a folded family.
 */
export function activeNode(tree: MapTree, layout: MapLayout, key: string | null): TreeNode | null {
	if (key === null) return null;
	return tree.nodes.get(key) ?? tree.nodes.get(layout.representative[key] ?? '') ?? null;
}
