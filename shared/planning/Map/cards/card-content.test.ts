import { describe, expect, it } from 'vitest';
import { drawDot } from '../draw-dot.fixture';
import { BoardBuilder } from '../layout/board-fixture';
import { cardContent, fitChips, type CardChip, type CardContent } from './card-content';

const b = new BoardBuilder();

describe('cardContent', () => {
	it('names the status in words, with the sub-statuses that change what a person does', () => {
		for (const [subStatus, label] of [['scoping', 'Scoping'], ['pr_open', 'PR open'], ['needs_input', 'Needs input'], ['paused', 'Paused']] as const) {
			const row = b.add({ status: 'in_progress', subStatus });
			expect(cardContent(row, drawDot(row.key, 0, 0, { status: 'in_progress' }))).toMatchObject({ statusLabel: 'In Progress', subStatus: label });
		}
		// in_development and the rest say nothing the glyph doesn't.
		const plain = b.add({ status: 'in_progress', subStatus: 'in_development' });
		expect(cardContent(plain, drawDot(plain.key, 0, 0)).subStatus).toBeNull();
	});

	it('says Blocked for a blocked glyph, and what it is waiting on by key', () => {
		const first = b.add({ status: 'in_progress' });
		const second = b.add({ status: 'ready' });
		const third = b.add({ status: 'ready' });
		const waiting = b.add({ status: 'ready' });
		b.block(waiting, first);
		b.block(waiting, second);
		b.block(waiting, third);
		const content = cardContent(waiting, drawDot(waiting.key, 0, 0, { status: 'blocked' }));
		expect(content.statusLabel).toBe('Blocked');
		expect(content.waitingOn).toBe(`Waiting on ${first.key}, ${second.key} and 1 more`);

		const one = b.add({ status: 'ready' });
		b.block(one, first);
		expect(cardContent(one, drawDot(one.key, 0, 0, { status: 'blocked' })).waitingOn).toBe(`Waiting on ${first.key}`);
	});

	it('does not list a satisfied blocker as something the item waits on', () => {
		const done = b.add({ status: 'done' });
		const item = b.add({ status: 'ready' });
		b.block(item, done);
		expect(item.blockers[0]!.state).toBe('satisfied');
		expect(cardContent(item, drawDot(item.key, 0, 0)).waitingOn).toBeNull();
	});

	it('counts text holds, and says plain Blocked for a hold with nothing behind it', () => {
		const held = b.add({ status: 'ready', textBlockerCount: 2, blocked: true });
		expect(cardContent(held, drawDot(held.key, 0, 0, { status: 'blocked' }))).toMatchObject({ holds: 2, waitingOn: null });
		const bare = b.add({ status: 'blocked', blocked: true });
		expect(cardContent(bare, drawDot(bare.key, 0, 0, { status: 'blocked' })).waitingOn).toBe('Blocked');
	});

	it('shows a PR as its number when the URL names one, and the linked spec count', () => {
		const pr = b.add({ status: 'in_review', prUrl: 'https://github.com/acme/repo/pull/123', specCount: 2 });
		expect(cardContent(pr, drawDot(pr.key, 0, 0))).toMatchObject({ pr: 'PR #123', specs: 2 });
		const odd = b.add({ status: 'in_review', prUrl: 'https://example.com/review/9' });
		expect(cardContent(odd, drawDot(odd.key, 0, 0)).pr).toBe('PR');
		expect(cardContent(b.add({ status: 'ready' }), drawDot('x', 0, 0)).pr).toBeNull();
	});

	it('says whether an agent or a person made it, and nothing when nobody knows or the system did', () => {
		const origin = (originActorType: 'user' | 'agent' | 'system' | null): CardContent['origin'] => cardContent(b.add({ status: 'ready', originActorType }), drawDot('x', 0, 0)).origin;
		expect(origin('agent')).toBe('agent');
		expect(origin('user')).toBe('person');
		expect(origin('system')).toBeNull();
		expect(origin(null)).toBeNull();
	});

	it('carries a folded family\'s size and the needs-a-person ring', () => {
		const row = b.add({ status: 'done' });
		const folded = drawDot(row.key, 0, 0, { needsPerson: true, folded: { count: 12, rollup: { done: 11, in_flight: 0, next: 0, later: 0 }, expandable: true } });
		expect(cardContent(row, folded)).toMatchObject({ family: 12, needsPerson: true });
	});
});

describe('card chips', () => {
	const chip = (text: string, icon: CardChip['icon'] = null): CardChip => ({ text, icon });

	it('lists the status first, then the marks in the order they matter', () => {
		const row = b.add({ status: 'ready', subStatus: 'scoping', specCount: 1, prUrl: 'https://github.com/a/b/pull/9', textBlockerCount: 1, blocked: true });
		const blocker = b.add({ status: 'in_progress' });
		b.block(row, blocker);
		const content = cardContent(row, drawDot(row.key, 0, 0, { status: 'blocked' }));
		expect(content.chips.map((c) => c.text)).toEqual(['Blocked', 'Scoping', `Waiting on ${blocker.key}`, 'Spec', 'PR #9', '1 hold']);
		expect(content.chips.filter((c) => c.icon).map((c) => c.icon)).toEqual(['file', 'git-branch']);
	});

	it('shows every chip when they fit one row', () => {
		expect(fitChips([chip('Done'), chip('Spec', 'file')])).toEqual({ shown: [chip('Done'), chip('Spec', 'file')], hidden: 0 });
	});

	it('cuts what does not fit to a +N, keeping the status and as many of the next as there is room for', () => {
		const many = [chip('In Progress'), chip('Needs input'), chip('Waiting on MAP-10, MAP-11'), chip('2 specs', 'file'), chip('PR #123', 'git-branch')];
		const { shown, hidden } = fitChips(many);
		expect(shown[0]).toEqual(chip('In Progress'));
		expect(shown.length).toBeLessThan(many.length);
		expect(hidden).toBe(many.length - shown.length);
		expect(hidden).toBeGreaterThan(0);
	});

	it('always shows the status, even one too wide for the row alone', () => {
		const { shown, hidden } = fitChips([chip('A status label much longer than any row has room for at all'), chip('Spec', 'file')]);
		expect(shown).toHaveLength(1);
		expect(hidden).toBe(1);
	});
});

