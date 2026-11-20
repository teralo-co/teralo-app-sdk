// The app's screens' half of the bridge to Teralo's page. Teralo frames the screens in a
// sandboxed iframe on the app's own address and talks to them with postMessage; every message
// type is prefixed `teralo:`. No Teralo data crosses the bridge: the screens read it through the
// app's own server (`api()`), which asks Teralo with the person's own permissions.

const PREFIX = 'teralo:';
/** How long `api()` waits for a fresh token after a 401 before giving up. */
const TOKEN_WAIT_MS = 5000;
/** Teralo takes one error report every ten seconds and drops the rest. */
const REPORT_EVERY_MS = 10000;

let launch = null;
let token = null;
/** Teralo's private line for the session token, handed over with `init`: only this page holds it. */
let port = null;
let ready = null;
const navigateListeners = new Set();
const themeListeners = new Set();
const tokenWaiters = new Set();
/** Errors `fetch` threw: no connection, which is not the app failing. */
const offline = new WeakSet();
let lastReport = 0;

function send(type, data = {}) {
	// `type` last: it is reserved, so no field of `data` can replace it.
	window.parent.postMessage({ ...data, type: `${PREFIX}${type}` }, '*');
}

function applyTheme(theme) {
	const root = document.documentElement;
	root.style.colorScheme = theme.mode;
	root.dataset.theme = theme.mode;
	for (const [name, value] of Object.entries(theme.vars ?? {})) root.style.setProperty(name, value);
}

function onToken(message) {
	if (message.type !== `${PREFIX}token`) return;
	token = message.token;
	for (const wake of tokenWaiters) wake();
	tokenWaiters.clear();
}

function onMessage(event) {
	// Only the window that framed this one: Teralo's page (its frame-ancestors rule makes it so).
	if (event.source !== window.parent) return;
	const message = event.data ?? {};
	switch (message.type) {
		case `${PREFIX}init`:
			token = message.token;
			port = event.ports?.[0] ?? null;
			if (port) port.onmessage = (portEvent) => onToken(portEvent.data ?? {});
			launch = { surface: message.surface, path: message.path, theme: message.theme };
			applyTheme(message.theme);
			ready?.resolve(launch);
			break;
		case `${PREFIX}token`:
			// ponytail: a Teralo from before the port renews on the window; drop once none is live.
			onToken(message);
			break;
		case `${PREFIX}theme`:
			applyTheme(message.theme);
			for (const listener of themeListeners) listener(message.theme);
			break;
		case `${PREFIX}navigate`:
			for (const listener of navigateListeners) listener(message.path);
			break;
	}
}

/**
 * Tells Teralo the screen is ready and resolves with where it is shown (`'page'` or `'card'`),
 * the app path Teralo's URL holds, and the theme (already applied). Call it once, first.
 */
export function connect() {
	if (!ready) {
		let resolve;
		const promise = new Promise((r) => (resolve = r));
		ready = { promise, resolve };
		window.addEventListener('message', onMessage);
		send('ready');
	}
	return ready.promise;
}

function freshToken() {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			tokenWaiters.delete(wake);
			reject(new Error('Teralo did not renew the session. Reopen the app.'));
		}, TOKEN_WAIT_MS);
		const wake = () => {
			clearTimeout(timer);
			resolve();
		};
		tokenWaiters.add(wake);
		if (port) port.postMessage({ type: `${PREFIX}token` });
		else send('token');
	});
}

/**
 * `fetch` to the app's own server, with the session's token. Teralo renews the token before it
 * ends; a 401 anyway (a laptop that slept) asks for a fresh one and tries once more. An answer
 * of 500 or more is reported to Teralo (`reportError`) and still returned.
 */
export async function api(path, init = {}) {
	if (!launch) await connect();
	const call = async (bearer) => {
		const headers = new Headers(init.headers);
		headers.set('Authorization', `Bearer ${bearer}`);
		try {
			return await fetch(path, { ...init, headers });
		} catch (error) {
			if (error instanceof Object) offline.add(error);
			throw error;
		}
	};
	const sent = token;
	let response = await call(sent);
	if (response.status === 401) {
		// Renewed while the call was out (a laptop waking): use the new one, do not ask again.
		if (token === sent) await freshToken();
		response = await call(token);
	}
	if (response.status >= 500) reportError(`The app's server answered ${response.status}`);
	return response;
}

/**
 * Tells Teralo the screen failed: the person is told the app has a problem and its owner hears
 * of it. Sent for you on an uncaught error, an unhandled rejection and a server answer of 500
 * or more; call it for a failure you catch. Plain text, at most 500 characters, one every ten
 * seconds.
 */
export function reportError(message) {
	if (Date.now() - lastReport < REPORT_EVERY_MS) return;
	lastReport = Date.now();
	send('error', { message: String(message ?? '').slice(0, 500) });
}

window.addEventListener('error', (event) => reportError(event.message));
window.addEventListener('unhandledrejection', (event) => {
	if (!offline.has(event.reason)) reportError(event.reason?.message ?? event.reason);
});

/** Puts a screen of the app in Teralo's URL, so Back, reload and links reach it. */
export function navigate(path) {
	send('navigate', { path });
}

/** A short message under the app's name. Plain text, one a second at most. */
export function toast(message, kind = 'info') {
	send('toast', { message, kind });
}

/** Saves a file on the person's device: csv, xlsx, pdf, json or txt, up to 25 MB. */
export function saveFile(name, data) {
	send('save-file', { name, data });
}

/** From a dashboard card: opens the app's page, at `path`. */
export function openPage(path = '/') {
	send('open', { path });
}

/** Back and Forward in Teralo moved to `path`. Returns a function that stops listening. */
export function onNavigate(listener) {
	navigateListeners.add(listener);
	return () => navigateListeners.delete(listener);
}

/** Teralo switched between light and dark (already applied). Returns a function that stops listening. */
export function onTheme(listener) {
	themeListeners.add(listener);
	return () => themeListeners.delete(listener);
}
