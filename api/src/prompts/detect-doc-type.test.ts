import { describe, it, expect } from 'vitest';
import { detectDocType } from './detect-doc-type.ts';

describe('detectDocType', () => {
	describe('new-doc detection', () => {
		it('returns new-doc for undefined content', () => {
			expect(detectDocType(undefined)).toBe('new-doc');
		});

		it('returns new-doc for empty string', () => {
			expect(detectDocType('')).toBe('new-doc');
		});

		it('returns new-doc for whitespace-only content', () => {
			expect(detectDocType('   \n\t  ')).toBe('new-doc');
		});

		it('returns new-doc for very short content (<50 chars)', () => {
			expect(detectDocType('Hello world')).toBe('new-doc');
		});

		it('returns new-doc for a single heading', () => {
			expect(detectDocType('# My Document Title')).toBe('new-doc');
		});

		it('returns new-doc for h2 heading only', () => {
			expect(detectDocType('## Section')).toBe('new-doc');
		});

		it('does not treat multi-line content as heading-only', () => {
			const content = '# Title\n\nSome paragraph text that makes this longer than fifty characters overall.';
			expect(detectDocType(content)).not.toBe('new-doc');
		});
	});

	describe('technical detection', () => {
		it('returns technical for content with 2+ code blocks', () => {
			const content = `# API Reference

Here is how to use the function:

\`\`\`typescript
function hello() {
  return 'world';
}
\`\`\`

And another example:

\`\`\`typescript
function goodbye() {
  return 'farewell';
}
\`\`\`
`;
			expect(detectDocType(content)).toBe('technical');
		});

		it('returns technical for high inline code density', () => {
			const content = 'Use `useState` and `useEffect` hooks. The `props` object contains `children` and `className`. Call `render` to update the `DOM` element. This is a paragraph of code references.';
			expect(detectDocType(content)).toBe('technical');
		});

		it('does not flag single code block as technical', () => {
			const content = `# Getting Started

This is a long introduction paragraph that explains the project setup process and configuration steps.

\`\`\`bash
npm install
\`\`\`

That's all you need to do to get started with the project and begin development.`;
			expect(detectDocType(content)).toBe('product');
		});
	});

	describe('product detection (default)', () => {
		it('returns product for prose content', () => {
			const content = `# Product Vision

Our product helps teams collaborate more effectively by providing real-time
document editing and task management in a single unified platform. The key
differentiator is our seamless integration between planning and documentation.`;
			expect(detectDocType(content)).toBe('product');
		});

		it('returns product for content with few inline code terms', () => {
			const content = 'This document describes the user onboarding flow. Users sign up with their email, verify their account through a confirmation link, and then set up their profile with a display name and avatar.';
			expect(detectDocType(content)).toBe('product');
		});
	});
});
