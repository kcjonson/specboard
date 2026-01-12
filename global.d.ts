// CSS module type declarations (shared across all packages)
declare module '*.module.css' {
	const classes: { readonly [key: string]: string };
	export default classes;
}

declare module '*.css' {
	const css: string;
	export default css;
}
