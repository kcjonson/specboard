import { describe, it, expect } from 'vitest';
import { fromMarkdown } from './fromMarkdown';
import { toMarkdown } from './toMarkdown';
import type { Descendant } from 'slate';

describe('Markdown Serialization', () => {
	describe('fromMarkdown', () => {
		it('should return empty document for empty string', () => {
			const result = fromMarkdown('');
			expect(result.content).toEqual([{ type: 'paragraph', children: [{ text: '' }] }]);
			expect(result.comments).toEqual([]);
		});

		it('should return empty document for whitespace', () => {
			const result = fromMarkdown('   ');
			expect(result.content).toEqual([{ type: 'paragraph', children: [{ text: '' }] }]);
			expect(result.comments).toEqual([]);
		});

		it('should parse a simple paragraph', () => {
			const result = fromMarkdown('Hello, world!');
			expect(result.content).toEqual([
				{ type: 'paragraph', children: [{ text: 'Hello, world!' }] }
			]);
		});

		it('should parse multiple paragraphs', () => {
			const result = fromMarkdown('First paragraph.\n\nSecond paragraph.');
			expect(result.content).toHaveLength(2);
			expect(result.content[0]).toEqual({
				type: 'paragraph',
				children: [{ text: 'First paragraph.' }]
			});
			expect(result.content[1]).toEqual({
				type: 'paragraph',
				children: [{ text: 'Second paragraph.' }]
			});
		});

		describe('headings', () => {
			it('should parse h1', () => {
				const result = fromMarkdown('# Heading 1');
				expect(result.content[0]).toMatchObject({
					type: 'heading',
					level: 1,
				});
			});

			it('should parse h2', () => {
				const result = fromMarkdown('## Heading 2');
				expect(result.content[0]).toMatchObject({
					type: 'heading',
					level: 2,
				});
			});

			it('should parse h3-h6', () => {
				for (let level = 3; level <= 6; level++) {
					const result = fromMarkdown('#'.repeat(level) + ` Heading ${level}`);
					expect(result.content[0]).toMatchObject({
						type: 'heading',
						level,
					});
				}
			});
		});

		describe('inline formatting', () => {
			it('should parse bold text', () => {
				const result = fromMarkdown('This is **bold** text.');
				expect(result.content[0]).toMatchObject({
					type: 'paragraph',
					children: expect.arrayContaining([
						expect.objectContaining({ text: 'bold', bold: true })
					])
				});
			});

			it('should parse italic text', () => {
				const result = fromMarkdown('This is _italic_ text.');
				expect(result.content[0]).toMatchObject({
					type: 'paragraph',
					children: expect.arrayContaining([
						expect.objectContaining({ text: 'italic', italic: true })
					])
				});
			});

			it('should parse inline code', () => {
				const result = fromMarkdown('Use `code` here.');
				expect(result.content[0]).toMatchObject({
					type: 'paragraph',
					children: expect.arrayContaining([
						expect.objectContaining({ text: 'code', code: true })
					])
				});
			});

			it('should parse strikethrough', () => {
				const result = fromMarkdown('This is ~~deleted~~ text.');
				expect(result.content[0]).toMatchObject({
					type: 'paragraph',
					children: expect.arrayContaining([
						expect.objectContaining({ text: 'deleted', strikethrough: true })
					])
				});
			});
		});

		describe('block elements', () => {
			it('should parse blockquotes', () => {
				const result = fromMarkdown('> This is a quote.');
				expect(result.content[0]).toMatchObject({
					type: 'blockquote',
				});
			});

			it('should parse code blocks', () => {
				const result = fromMarkdown('```javascript\nconst x = 1;\n```');
				expect(result.content[0]).toMatchObject({
					type: 'code-block',
					language: 'javascript',
				});
			});

			it('should parse code blocks without language', () => {
				const result = fromMarkdown('```\ncode here\n```');
				expect(result.content[0]).toMatchObject({
					type: 'code-block',
				});
			});

			it('should parse thematic breaks (hr)', () => {
				const result = fromMarkdown('---');
				expect(result.content[0]).toMatchObject({
					type: 'thematic-break',
				});
			});
		});

		describe('lists', () => {
			it('should parse bulleted lists', () => {
				const result = fromMarkdown('- Item 1\n- Item 2\n- Item 3');
				expect(result.content[0]).toMatchObject({
					type: 'bulleted-list',
				});
				const list = result.content[0] as { children: unknown[] };
				expect(list.children).toHaveLength(3);
			});

			it('should parse numbered lists', () => {
				const result = fromMarkdown('1. First\n2. Second\n3. Third');
				expect(result.content[0]).toMatchObject({
					type: 'numbered-list',
				});
			});

			it('should have list-item children', () => {
				const result = fromMarkdown('- Item 1\n- Item 2');
				const list = result.content[0] as { type: string; children: { type: string }[] };
				expect(list.children[0]!.type).toBe('list-item');
				expect(list.children[1]!.type).toBe('list-item');
			});
		});

		describe('links', () => {
			it('should parse links', () => {
				const result = fromMarkdown('[Example](https://example.com)');
				const paragraph = result.content[0] as { children: unknown[] };
				expect(paragraph.children).toContainEqual(
					expect.objectContaining({
						type: 'link',
						url: 'https://example.com',
					})
				);
			});
		});

		describe('tables', () => {
			it('should parse tables', () => {
				const markdown = `
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
`.trim();
				const result = fromMarkdown(markdown);
				expect(result.content[0]).toMatchObject({
					type: 'table',
				});
			});

			it('should parse table rows', () => {
				const markdown = `
| A | B |
|---|---|
| 1 | 2 |
`.trim();
				const result = fromMarkdown(markdown);
				const table = result.content[0] as { children: { type: string }[] };
				expect(table.children[0]!.type).toBe('table-row');
			});

			it('should parse table cells', () => {
				const markdown = `
| A | B |
|---|---|
| 1 | 2 |
`.trim();
				const result = fromMarkdown(markdown);
				const table = result.content[0] as { children: { children: { type: string }[] }[] };
				const firstRow = table.children[0]!;
				expect(firstRow.children[0]!.type).toBe('table-cell');
			});
		});

		describe('unsupported types', () => {
			it('should skip images silently', () => {
				const result = fromMarkdown('![alt](image.png)');
				// Should not crash, image is filtered out
				expect(result).toBeDefined();
			});
		});
	});

	describe('toMarkdown', () => {
		it('should return empty string for empty array', () => {
			const result = toMarkdown([]);
			expect(result).toBe('');
		});

		it('should serialize a paragraph', () => {
			const content: Descendant[] = [
				{ type: 'paragraph', children: [{ text: 'Hello, world!' }] }
			];
			const result = toMarkdown(content);
			expect(result.trim()).toBe('Hello, world!');
		});

		it('should serialize multiple paragraphs', () => {
			const content: Descendant[] = [
				{ type: 'paragraph', children: [{ text: 'First.' }] },
				{ type: 'paragraph', children: [{ text: 'Second.' }] },
			];
			const result = toMarkdown(content);
			expect(result).toContain('First.');
			expect(result).toContain('Second.');
		});

		describe('headings', () => {
			it('should serialize h1', () => {
				const content: Descendant[] = [
					{ type: 'heading', level: 1, children: [{ text: 'Title' }] }
				];
				const result = toMarkdown(content);
				expect(result.trim()).toBe('# Title');
			});

			it('should serialize h2-h6', () => {
				for (let level = 2; level <= 6; level++) {
					const content: Descendant[] = [
						{ type: 'heading', level: level as 1 | 2 | 3 | 4 | 5 | 6, children: [{ text: 'Title' }] }
					];
					const result = toMarkdown(content);
					expect(result.trim()).toBe('#'.repeat(level) + ' Title');
				}
			});
		});

		describe('inline formatting', () => {
			it('should serialize bold', () => {
				const content: Descendant[] = [
					{
						type: 'paragraph',
						children: [
							{ text: 'This is ' },
							{ text: 'bold', bold: true },
							{ text: ' text.' }
						]
					}
				];
				const result = toMarkdown(content);
				expect(result).toContain('**bold**');
			});

			it('should serialize italic', () => {
				const content: Descendant[] = [
					{
						type: 'paragraph',
						children: [
							{ text: 'This is ' },
							{ text: 'italic', italic: true },
							{ text: ' text.' }
						]
					}
				];
				const result = toMarkdown(content);
				expect(result).toContain('_italic_');
			});

			it('should serialize inline code', () => {
				const content: Descendant[] = [
					{
						type: 'paragraph',
						children: [
							{ text: 'Use ' },
							{ text: 'code', code: true },
							{ text: ' here.' }
						]
					}
				];
				const result = toMarkdown(content);
				expect(result).toContain('`code`');
			});

			it('should serialize strikethrough', () => {
				const content: Descendant[] = [
					{
						type: 'paragraph',
						children: [
							{ text: 'This is ' },
							{ text: 'deleted', strikethrough: true },
							{ text: ' text.' }
						]
					}
				];
				const result = toMarkdown(content);
				expect(result).toContain('~~deleted~~');
			});
		});

		describe('block elements', () => {
			it('should serialize blockquotes', () => {
				const content: Descendant[] = [
					{ type: 'blockquote', children: [{ text: 'A quote.' }] }
				];
				const result = toMarkdown(content);
				expect(result).toContain('> A quote.');
			});

			it('should serialize code blocks with language', () => {
				const content: Descendant[] = [
					{ type: 'code-block', language: 'typescript', children: [{ text: 'const x = 1;' }] }
				];
				const result = toMarkdown(content);
				expect(result).toContain('```typescript');
				expect(result).toContain('const x = 1;');
				expect(result).toContain('```');
			});

			it('should serialize thematic breaks', () => {
				const content: Descendant[] = [
					{ type: 'thematic-break', children: [{ text: '' }] }
				];
				const result = toMarkdown(content);
				expect(result).toContain('---');
			});
		});

		describe('lists', () => {
			it('should serialize bulleted lists', () => {
				const content: Descendant[] = [
					{
						type: 'bulleted-list',
						children: [
							{ type: 'list-item', children: [{ text: 'Item 1' }] },
							{ type: 'list-item', children: [{ text: 'Item 2' }] },
						]
					}
				];
				const result = toMarkdown(content);
				expect(result).toContain('- Item 1');
				expect(result).toContain('- Item 2');
			});

			it('should serialize numbered lists', () => {
				const content: Descendant[] = [
					{
						type: 'numbered-list',
						children: [
							{ type: 'list-item', children: [{ text: 'First' }] },
							{ type: 'list-item', children: [{ text: 'Second' }] },
						]
					}
				];
				const result = toMarkdown(content);
				expect(result).toContain('1. First');
				expect(result).toContain('2. Second');
			});
		});

		describe('links', () => {
			it('should serialize links', () => {
				const content: Descendant[] = [
					{
						type: 'paragraph',
						children: [
							{ type: 'link', url: 'https://example.com', children: [{ text: 'Example' }] }
						]
					}
				];
				const result = toMarkdown(content);
				expect(result).toContain('[Example](https://example.com)');
			});
		});

		describe('tables', () => {
			it('should serialize tables', () => {
				const content: Descendant[] = [
					{
						type: 'table',
						children: [
							{
								type: 'table-row',
								children: [
									{ type: 'table-cell', header: true, children: [{ text: 'A' }] },
									{ type: 'table-cell', header: true, children: [{ text: 'B' }] },
								]
							},
							{
								type: 'table-row',
								children: [
									{ type: 'table-cell', children: [{ text: '1' }] },
									{ type: 'table-cell', children: [{ text: '2' }] },
								]
							},
						]
					}
				];
				const result = toMarkdown(content);
				expect(result).toContain('A');
				expect(result).toContain('B');
				expect(result).toContain('|');
			});
		});
	});

	describe('round-trip', () => {
		it('should round-trip a paragraph', () => {
			const original = 'Hello, world!';
			const { content } = fromMarkdown(original);
			const output = toMarkdown(content);
			expect(output.trim()).toBe(original);
		});

		it('should round-trip headings', () => {
			const original = '# Heading 1';
			const { content } = fromMarkdown(original);
			const output = toMarkdown(content);
			expect(output.trim()).toBe(original);
		});

		it('should round-trip bold text', () => {
			const original = 'This is **bold** text.';
			const { content } = fromMarkdown(original);
			const output = toMarkdown(content);
			expect(output.trim()).toBe(original);
		});

		it('should round-trip code blocks', () => {
			const original = '```javascript\nconst x = 1;\n```';
			const { content } = fromMarkdown(original);
			const output = toMarkdown(content);
			expect(output.trim()).toBe(original);
		});

		it('should round-trip bulleted lists', () => {
			const original = '- Item 1\n- Item 2';
			const { content } = fromMarkdown(original);
			const output = toMarkdown(content);
			expect(output.trim()).toBe(original);
		});

		it('should round-trip links', () => {
			const original = '[Example](https://example.com)';
			const { content } = fromMarkdown(original);
			const output = toMarkdown(content);
			expect(output.trim()).toBe(original);
		});

		it('should round-trip tables', () => {
			const original = `| A | B |
| - | - |
| 1 | 2 |`;
			const { content } = fromMarkdown(original);
			const output = toMarkdown(content);
			// Table formatting may vary slightly, just check content preserved
			expect(output).toContain('A');
			expect(output).toContain('B');
			expect(output).toContain('1');
			expect(output).toContain('2');
		});
	});

	describe('edge cases', () => {
		it('should handle empty tables', () => {
			const markdown = `| | |
| - | - |
| | |`;
			const result = fromMarkdown(markdown);
			expect(result.content[0]).toMatchObject({ type: 'table' });
		});

		it('should handle nested formatting (bold+italic)', () => {
			const result = fromMarkdown('This is **_bold and italic_** text.');
			expect(result.content[0]).toMatchObject({ type: 'paragraph' });
			// The text should be parsed without crashing
			expect(result).toBeDefined();
		});

		it('should handle malformed markdown gracefully', () => {
			// Unclosed code block
			const result = fromMarkdown('```javascript\nconst x = 1;');
			expect(result).toBeDefined();
			expect(result.content.length).toBeGreaterThan(0);
		});

		it('should handle very long lines', () => {
			const longText = 'a'.repeat(10000);
			const result = fromMarkdown(longText);
			expect(result.content[0]).toMatchObject({ type: 'paragraph' });
		});

		it('should handle special characters in text', () => {
			const result = fromMarkdown('Text with <angle brackets> and &amp; entities');
			expect(result).toBeDefined();
		});

		it('should handle tables with varying column text lengths', () => {
			const markdown = `| Short | Very Long Header Text |
| - | - |
| A | B |`;
			const result = fromMarkdown(markdown);
			expect(result.content[0]).toMatchObject({ type: 'table' });
		});
	});
});
