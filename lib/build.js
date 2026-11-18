// Packs an app folder into the one file Teralo runs: `{ mainModule, modules, ui, migrations }`
// as JSON, named by the sha256 of its bytes. Teralo checks the same shape and hash again when it
// is published, and the plugin host once more before running it.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import * as esbuild from 'esbuild';

/** The plugin API contract this SDK speaks. A breaking change to it raises the number. */
export const TERALO_API = 1;

/** What the plugin host serves as a screen. Images and fonts are not served yet. */
const UI_TEXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt']);
/** Scripts at the top of `ui/` are entry points: bundled, so they can import packages. */
const UI_ENTRY = new Set(['.js', '.mjs', '.ts']);

export async function readManifest(dir) {
	const manifest = JSON.parse(await readFile(join(dir, 'teralo-app.json'), 'utf8'));
	// Only what building needs; Teralo checks the rest when it is published.
	if (manifest.teraloApi !== TERALO_API) {
		throw new Error(`teralo-app.json: teraloApi must be ${TERALO_API} for this SDK`);
	}
	if (typeof manifest.server !== 'string') {
		throw new Error('teralo-app.json: server is the path of the server entry, such as server/index.js');
	}
	if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? '')) {
		throw new Error('teralo-app.json: version must look like 1.4.0');
	}
	return manifest;
}

async function bundle(dir, entry, platform) {
	const server = platform === 'neutral';
	const result = await esbuild.build({
		// Paths in the output are relative to the app folder, wherever the command runs, so anyone
		// can rebuild a tagged repo and get the hash Teralo runs.
		absWorkingDir: resolve(dir),
		entryPoints: [entry],
		bundle: true,
		write: false,
		format: 'esm',
		target: 'es2022',
		platform,
		// The plugin host's runtime provides these.
		external: server ? ['cloudflare:*'] : [],
		conditions: server ? ['workerd', 'worker', 'browser'] : [],
		mainFields: ['module', 'main'],
		// Readable on purpose: an app's code is reviewed by the people who install it.
		minify: false,
		legalComments: 'inline',
		logLevel: 'silent'
	});
	return result.outputFiles[0].text;
}

/** Every file under `root`, as sorted `a/b.txt` paths; none when `root` does not exist. */
async function filesUnder(root) {
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true, recursive: true });
	} catch (err) {
		if (err.code === 'ENOENT') return [];
		throw err;
	}
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
		.sort();
}

/**
 * Builds the app in `dir`. `version` overrides the manifest's (a dev build). Resolves with the
 * manifest as published, the bundle's exact text and its sha256.
 */
export async function build(dir, { version } = {}) {
	const manifest = { ...(await readManifest(dir)), ...(version ? { version } : {}) };

	const ui = {};
	const uiDir = join(dir, manifest.ui ?? 'ui');
	for (const file of await filesUnder(uiDir)) {
		const ext = extname(file);
		if (!file.includes('/') && UI_ENTRY.has(ext)) {
			ui[file.slice(0, -ext.length) + '.js'] = await bundle(dir, join(uiDir, file), 'browser');
		} else if (UI_TEXT.has(ext)) {
			ui[file] = await readFile(join(uiDir, file), 'utf8');
		} else {
			throw new Error(`${file}: screens can be ${[...UI_TEXT].join(' ')} files for now`);
		}
	}
	if (!ui['index.html']) throw new Error('ui/index.html is required: it is the screen Teralo opens');

	const migrations = {};
	for (const file of await filesUnder(join(dir, manifest.migrations ?? 'migrations'))) {
		if (file.includes('/') || !file.endsWith('.sql')) {
			throw new Error(`migrations/${file}: migrations are .sql files, no folders`);
		}
		migrations[file] = await readFile(join(dir, manifest.migrations ?? 'migrations', file), 'utf8');
	}

	const text = JSON.stringify({
		mainModule: 'index.js',
		modules: { 'index.js': await bundle(dir, join(dir, manifest.server), 'neutral') },
		ui,
		migrations
	});
	return { manifest, text, hash: createHash('sha256').update(text).digest('hex') };
}

/**
 * Builds and publishes to the Teralo at `to` with Teralo's publishing key. `dev` publishes
 * `{version}-dev.{time}`, which only a local Teralo accepts and moves its installs to.
 */
export async function publish(dir, { to, secret, dev = false }) {
	const { version } = await readManifest(dir);
	const built = await build(dir, { version: dev ? `${version}-dev.${Date.now()}` : undefined });
	const { publisher, description, ...manifest } = built.manifest;
	const response = await fetch(new URL('/api/plugins/publish', to), {
		method: 'POST',
		headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ publisher, description, manifest, bundle: built.text })
	});
	const answer = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(answer.error ?? `Teralo answered ${response.status}`);
	if (answer.bundleHash !== built.hash) {
		throw new Error('Teralo stored different bytes from the ones built: publish again');
	}
	return { ...answer, version: built.manifest.version };
}
