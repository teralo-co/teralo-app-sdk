/** Where Teralo shows the screen: the app's own page, or a card on a project dashboard. */
export type Surface = 'page' | 'card';

/** Teralo's light or dark theme: CSS custom properties, applied to `:root` for you. */
export type Theme = { mode: 'light' | 'dark'; vars: Record<string, string> };

export type Launch = {
	surface: Surface;
	/** The screen of the app Teralo's URL names, such as `/` or `/deliveries/12`. */
	path: string;
	theme: Theme;
};

/**
 * Tells Teralo the screen is ready and resolves with where it is shown, the app path and the
 * theme (already applied). Call it once, first.
 */
export function connect(): Promise<Launch>;

/**
 * `fetch` to the app's own server, with the session's token. A 401 asks Teralo for a fresh
 * token and tries once more. An answer of 500 or more is reported (`reportError`).
 */
export function api(path: string, init?: RequestInit): Promise<Response>;

/**
 * Tells Teralo the screen failed: the person is told the app has a problem and its owner hears
 * of it. Sent for you on an uncaught error, an unhandled rejection and a server answer of 500
 * or more. Plain text, at most 500 characters, one every ten seconds.
 */
export function reportError(message: unknown): void;

/** Puts a screen of the app in Teralo's URL (plain path segments only). */
export function navigate(path: string): void;

/** A short message under the app's name. Plain text, one a second at most. */
export function toast(message: string, kind?: 'success' | 'error' | 'info'): void;

/** Saves a file on the person's device: csv, xlsx, pdf, json or txt, up to 25 MB. */
export function saveFile(name: string, data: string | ArrayBuffer | Uint8Array): void;

/** From a dashboard card: opens the app's page, at `path`. */
export function openPage(path?: string): void;

/** Back and Forward in Teralo moved to `path`. Returns a function that stops listening. */
export function onNavigate(listener: (path: string) => void): () => void;

/** Teralo switched theme (already applied). Returns a function that stops listening. */
export function onTheme(listener: (theme: Theme) => void): () => void;
