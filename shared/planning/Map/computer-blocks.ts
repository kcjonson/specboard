import { clientLabel, deviceLabel, type AgentComputer } from './agents';
import type { ZoomLevel } from './zoom-levels';

/**
 * The one text block per computer (spec, Agents): its name, then a line per session
 * naming the work, "Session 1: SPE-206, SPE-209". The block names the items, so they get
 * no floating labels of their own; hover gives full titles.
 */

export interface BlockLine {
	text: string;
	/** The computer's name, in full ink; the session lines are muted. */
	strong: boolean;
}

export interface ComputerBlock {
	/** The computer's layout node. */
	node: string;
	lines: BlockLine[];
	/** The items it names, which draw no label of their own. */
	items: string[];
}

/** Zoomed in, each session line also names the agent: "Session 2, claude-code: SPE-207". */
export function computerBlock(computer: AgentComputer, level: ZoomLevel): ComputerBlock {
	const lines: BlockLine[] = [{ text: deviceLabel(computer.device), strong: true }];
	const items: string[] = [];
	for (const session of computer.sessions) {
		const keys = session.items.map((item) => item.key);
		items.push(...keys);
		const agent = level === 'far' ? '' : `, ${clientLabel(session.client)}`;
		lines.push({ text: `Session ${session.number}${agent}: ${keys.join(', ')}`, strong: false });
	}
	return { node: computer.node, lines, items };
}
