// CSS module type declarations
declare module '*.module.css' {
	const classes: { readonly [key: string]: string };
	export default classes;
}

declare module '*.css' {
	const css: string;
	export default css;
}

// Vite environment variables
interface ImportMetaEnv {
	readonly MODE: string;
	readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
