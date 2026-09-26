/**
 * How an MCP call names its project, and the one path from that name to a project.
 *
 * A project is `owner/project` (acme/roadmap), from the `project` tool argument or a
 * repo's X-Specboard-Project binding. A bare `project` means the caller's own project
 * of that slug: it is expanded to the caller's user slug here, before anything is
 * resolved, so every call still goes through the single resolveProject check.
 */

import { getUserSlug, resolveProject, type ResolvedProject } from '@specboard/db';
import { formatProjectRef, parseProjectRef, type ProjectRef } from '@specboard/core/identifiers';

export type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

/**
 * The repo binding from the X-Specboard-Project header: absent, a parsed ref, or
 * present but unparseable (reported on every tool call rather than ignored, since
 * ignoring it would silently unscope a repo that meant to be scoped).
 */
export type ProjectBinding = { ref: ProjectRef } | { invalid: string } | undefined;

export function parseProjectBinding(header: string | undefined): ProjectBinding {
	const raw = header?.trim();
	if (!raw) return undefined;
	const ref = parseProjectRef(raw);
	return ref ? { ref } : { invalid: raw };
}

/** A ref with both halves, once a bare one has been expanded. */
export interface FullProjectRef {
	owner: string;
	project: string;
}

/**
 * Fill in a bare ref's owner with the caller's slug. Null when the ref is bare and the
 * caller has no slug yet (not onboarded), which can only resolve to not-found.
 */
export async function expandProjectRef(ref: ProjectRef, userId: string): Promise<FullProjectRef | null> {
	if (ref.owner) return { owner: ref.owner, project: ref.project };
	const owner = await getUserSlug(userId);
	return owner ? { owner, project: ref.project } : null;
}

function error(text: string): ToolResult {
	return { content: [{ type: 'text', text }], isError: true };
}

const INVALID_REF = 'must be owner/project (e.g. acme/roadmap), or a bare project slug for one of your own projects';

const BINDING_UNAVAILABLE =
	"This repo's .mcp.json binding (X-Specboard-Project) points to a project that's unavailable: it may not exist, or your Specboard account may not have access to it. Verify the owner/project committed in .mcp.json and that your account has access to that project.";

const ACCESS_DENIED = "Access denied: that project doesn't exist, or your account doesn't have access to it.";

/** Appended to a not-found for a bare ref, the likely cause when a collaborator hits it. */
const BARE_HINT =
	' A bare project slug means your own project; for a project someone else owns, use the full owner/project form (list_projects shows each project\'s ref).';

export function invalidBindingResult(binding: { invalid: string }): ToolResult {
	return error(`This repo's .mcp.json binding (X-Specboard-Project: ${binding.invalid}) ${INVALID_REF}.`);
}

export function bindingUnavailableResult(bare: boolean): ToolResult {
	return error(BINDING_UNAVAILABLE + (bare ? BARE_HINT : ''));
}

/**
 * Resolve the project a tool call targets: the `project` argument, else the repo
 * binding. With both, they must name the same project once expanded. Misses come back
 * ambiguous between "doesn't exist" and "no access", without echoing the name, so
 * they can't be used to probe other users' projects.
 */
export async function resolveToolProject(
	requested: unknown,
	userId: string,
	binding: ProjectBinding
): Promise<ResolvedProject | ToolResult> {
	if (binding && 'invalid' in binding) return invalidBindingResult(binding);

	let requestedRef: ProjectRef | undefined;
	if (requested !== undefined) {
		const parsed = parseProjectRef(requested);
		if (!parsed) return error(`project ${INVALID_REF}.`);
		requestedRef = parsed;
	}

	const boundRef = binding?.ref;
	const ref = requestedRef ?? boundRef;
	if (!ref) return error('project is required (owner/project, e.g. acme/roadmap)');

	const target = await expandProjectRef(ref, userId);

	// The binding is authoritative: an explicit project must name the same board.
	if (requestedRef && boundRef) {
		const bound = await expandProjectRef(boundRef, userId);
		if (!bound || !target || bound.owner !== target.owner || bound.project !== target.project) {
			const boundText = bound ? formatProjectRef(bound.owner, bound.project) : boundRef.project;
			return error(`This repo is bound to project ${boundText} and cannot operate on a different project.`);
		}
	}

	const project = target ? await resolveProject(target.owner, target.project, userId) : null;
	if (!project) {
		const bare = ref.owner === null;
		return requestedRef ? error(ACCESS_DENIED + (bare ? BARE_HINT : '')) : bindingUnavailableResult(bare);
	}
	return project;
}
