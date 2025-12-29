import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import {
	Button,
	Dialog,
	Text,
	Textarea,
	Select,
	Card,
	Badge,
	StatusDot,
} from '@doc-platform/ui';
import styles from './UIDemo.module.css';

export function UIDemo(): JSX.Element {
	const [dialogOpen, setDialogOpen] = useState(false);
	const [textValue, setTextValue] = useState('');
	const [textareaValue, setTextareaValue] = useState('');
	const [selectValue, setSelectValue] = useState('ready');
	const [disabledTextValue] = useState('');
	const [readonlyTextValue] = useState('Read-only value');
	const [errorTextValue, setErrorTextValue] = useState('');
	const [disabledTextareaValue] = useState('');
	const [errorTextareaValue, setErrorTextareaValue] = useState('');

	const selectOptions = [
		{ value: 'ready', label: 'Ready' },
		{ value: 'in_progress', label: 'In Progress' },
		{ value: 'done', label: 'Done' },
	];

	return (
		<div class={styles.container}>
			<header class={styles.header}>
				<h1 class={styles.title}>UI Component Library</h1>
				<a href="/projects" class={styles.backLink}>← Back to Projects</a>
			</header>

			<main class={styles.content}>
				{/* Buttons */}
				<section class={styles.section}>
					<h2 class={styles.sectionTitle}>Button</h2>
					<p class={styles.sectionDesc}>Buttons trigger actions. Default is primary variant.</p>

					<div class={styles.subsection}>
						<h3 class={styles.subsectionTitle}>Variants (via class)</h3>
						<div class={styles.row}>
							<Button>Primary (default)</Button>
							<Button class="secondary">Secondary</Button>
							<Button class="text">Text</Button>
							<Button class="danger">Danger</Button>
							<Button class="icon" aria-label="Close">×</Button>
						</div>
					</div>

					<div class={styles.subsection}>
						<h3 class={styles.subsectionTitle}>Sizes (via class)</h3>
						<div class={styles.row}>
							<Button class="size-sm">Small</Button>
							<Button>Medium (default)</Button>
							<Button class="size-lg">Large</Button>
						</div>
					</div>

					<div class={styles.subsection}>
						<h3 class={styles.subsectionTitle}>States</h3>
						<div class={styles.row}>
							<Button>Default</Button>
							<Button disabled>Disabled</Button>
						</div>
					</div>
				</section>

				{/* Dialog */}
				<section class={styles.section}>
					<h2 class={styles.sectionTitle}>Dialog</h2>
					<p class={styles.sectionDesc}>Modal dialogs for focused interactions.</p>

					<div class={styles.subsection}>
						<Button onClick={() => setDialogOpen(true)}>Open Dialog</Button>
					</div>

					<Dialog
						open={dialogOpen}
						onClose={() => setDialogOpen(false)}
						title="Example Dialog"
					>
						<p>This is the dialog content. Press Escape or click outside to close.</p>
						<div class={styles.dialogActions}>
							<Button class="text" onClick={() => setDialogOpen(false)}>Cancel</Button>
							<Button onClick={() => setDialogOpen(false)}>Confirm</Button>
						</div>
					</Dialog>
				</section>

				{/* Text Input */}
				<section class={styles.section}>
					<h2 class={styles.sectionTitle}>Text</h2>
					<p class={styles.sectionDesc}>Single-line text input field. Controlled component (requires value).</p>

					<div class={styles.subsection}>
						<h3 class={styles.subsectionTitle}>Sizes (via class)</h3>
						<div class={styles.stack}>
							<Text class="size-sm" placeholder="Small input" value="" onInput={() => {}} />
							<Text placeholder="Medium input (default)" value="" onInput={() => {}} />
							<Text class="size-lg" placeholder="Large input" value="" onInput={() => {}} />
						</div>
					</div>

					<div class={styles.subsection}>
						<h3 class={styles.subsectionTitle}>States</h3>
						<div class={styles.stack}>
							<Text placeholder="Default" value={textValue} onInput={(e) => setTextValue((e.target as HTMLInputElement).value)} />
							<Text placeholder="Disabled" value={disabledTextValue} disabled />
							<Text placeholder="Read-only" value={readonlyTextValue} readOnly />
							<Text class="error" placeholder="Error state" value={errorTextValue} onInput={(e) => setErrorTextValue((e.target as HTMLInputElement).value)} />
						</div>
					</div>
				</section>

				{/* Textarea */}
				<section class={styles.section}>
					<h2 class={styles.sectionTitle}>Textarea</h2>
					<p class={styles.sectionDesc}>Multi-line text input field. Controlled component (requires value).</p>

					<div class={styles.subsection}>
						<div class={styles.stack}>
							<Textarea
								placeholder="Enter description..."
								value={textareaValue}
								onInput={(e) => setTextareaValue((e.target as HTMLTextAreaElement).value)}
							/>
							<Textarea placeholder="Disabled" value={disabledTextareaValue} disabled />
							<Textarea class="error" placeholder="Error state" value={errorTextareaValue} onInput={(e) => setErrorTextareaValue((e.target as HTMLTextAreaElement).value)} />
						</div>
					</div>
				</section>

				{/* Select */}
				<section class={styles.section}>
					<h2 class={styles.sectionTitle}>Select</h2>
					<p class={styles.sectionDesc}>Dropdown selection field. Controlled component (requires value).</p>

					<div class={styles.subsection}>
						<h3 class={styles.subsectionTitle}>Sizes (via class)</h3>
						<div class={styles.row}>
							<Select class="size-sm" options={selectOptions} value={selectValue} onChange={(e) => setSelectValue((e.target as HTMLSelectElement).value)} />
							<Select options={selectOptions} value={selectValue} onChange={(e) => setSelectValue((e.target as HTMLSelectElement).value)} />
							<Select class="size-lg" options={selectOptions} value={selectValue} onChange={(e) => setSelectValue((e.target as HTMLSelectElement).value)} />
						</div>
					</div>

					<div class={styles.subsection}>
						<h3 class={styles.subsectionTitle}>States</h3>
						<div class={styles.row}>
							<Select options={selectOptions} value={selectValue} onChange={(e) => setSelectValue((e.target as HTMLSelectElement).value)} />
							<Select options={selectOptions} value="" disabled />
							<Select class="error" options={selectOptions} value="" />
						</div>
					</div>
				</section>

				{/* Card */}
				<section class={styles.section}>
					<h2 class={styles.sectionTitle}>Card</h2>
					<p class={styles.sectionDesc}>Container for grouped content.</p>

					<div class={styles.subsection}>
						<h3 class={styles.subsectionTitle}>Variants (via class)</h3>
						<div class={styles.cardGrid}>
							<Card>
								<strong>Default Card</strong>
								<p>Basic card with shadow</p>
							</Card>
							<Card class="variant-interactive" onClick={() => alert('Clicked!')}>
								<strong>Interactive Card</strong>
								<p>Hover to see effect</p>
							</Card>
							<Card class="variant-selected">
								<strong>Selected Card</strong>
								<p>With primary border</p>
							</Card>
						</div>
					</div>

					<div class={styles.subsection}>
						<h3 class={styles.subsectionTitle}>Padding (via class)</h3>
						<div class={styles.cardGrid}>
							<Card class="padding-none">
								<div style={{ padding: '8px', background: '#f0f0f0' }}>padding-none</div>
							</Card>
							<Card class="padding-sm">padding-sm</Card>
							<Card>padding (default)</Card>
							<Card class="padding-lg">padding-lg</Card>
						</div>
					</div>
				</section>

				{/* Badge */}
				<section class={styles.section}>
					<h2 class={styles.sectionTitle}>Badge</h2>
					<p class={styles.sectionDesc}>Labels for status or counts.</p>

					<div class={styles.subsection}>
						<h3 class={styles.subsectionTitle}>Variants (via class)</h3>
						<div class={styles.row}>
							<Badge>Default</Badge>
							<Badge class="variant-primary">Primary</Badge>
							<Badge class="variant-success">Success</Badge>
							<Badge class="variant-warning">Warning</Badge>
							<Badge class="variant-error">Error</Badge>
						</div>
					</div>

					<div class={styles.subsection}>
						<h3 class={styles.subsectionTitle}>Sizes (via class)</h3>
						<div class={styles.row}>
							<Badge class="size-sm">Small</Badge>
							<Badge>Medium (default)</Badge>
						</div>
					</div>
				</section>

				{/* StatusDot */}
				<section class={styles.section}>
					<h2 class={styles.sectionTitle}>StatusDot</h2>
					<p class={styles.sectionDesc}>Visual status indicators. Status prop determines color.</p>

					<div class={styles.subsection}>
						<h3 class={styles.subsectionTitle}>Status Types (via prop)</h3>
						<div class={styles.row}>
							<span class={styles.statusItem}><StatusDot status="default" /> Default</span>
							<span class={styles.statusItem}><StatusDot status="ready" /> Ready</span>
							<span class={styles.statusItem}><StatusDot status="in_progress" /> In Progress</span>
							<span class={styles.statusItem}><StatusDot status="done" /> Done</span>
						</div>
					</div>

					<div class={styles.subsection}>
						<h3 class={styles.subsectionTitle}>Sizes (via class)</h3>
						<div class={styles.row}>
							<span class={styles.statusItem}><StatusDot status="ready" class="size-sm" /> Small</span>
							<span class={styles.statusItem}><StatusDot status="ready" /> Medium (default)</span>
							<span class={styles.statusItem}><StatusDot status="ready" class="size-lg" /> Large</span>
						</div>
					</div>
				</section>
			</main>
		</div>
	);
}
