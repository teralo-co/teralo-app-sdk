import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { build } from '../lib/build.js';

const roots = [];
after(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

/** An app folder from `{ path: contents }`. */
async function app(files) {
	const root = await mkdtemp(join(tmpdir(), 'teralo-app-'));
	roots.push(root);
	const manifest = {
		id: 'sample',
		name: 'Sample',
		version: '1.0.0',
		teraloApi: 1,
		publisher: 'Teralo',
		scopes: ['database'],
		server: 'server/index.js'
	};
	const all = { 'teralo-app.json': JSON.stringify(manifest), ...files };
	for (const [path, contents] of Object.entries(all)) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), contents);
	}
	return root;
}

const minimal = {
	'server/index.js': `import { WorkerEntrypoint } from 'cloudflare:workers';
import { greeting } from './greeting.js';
export default class extends WorkerEntrypoint { fetch() { return new Response(greeting); } }`,
	'server/greeting.js': `export const greeting = 'hello from the server';`,
	'ui/index.html': '<script type="module" src="app.js"></script>',
	'ui/app.ts': `import { shout } from './lib/shout.js';\ndocument.body.textContent = shout('hi');`,
	'ui/lib/shout.js': `export const shout = (s: string) => s.toUpperCase();`.replace(': string', ''),
	'ui/styles/app.css': 'body { margin: 0 }',
	'migrations/0001_init.sql': 'CREATE TABLE visits (person TEXT PRIMARY KEY, n INTEGER)'
};

test('packs server, screens and migrations into the shape the plugin host loads', async () => {
	const { text, hash, manifest } = await build(await app(minimal));
	const bundle = JSON.parse(text);
	assert.equal(manifest.version, '1.0.0');
	assert.equal(hash, createHash('sha256').update(text).digest('hex'));
	assert.equal(bundle.mainModule, 'index.js');
	assert.deepEqual(Object.keys(bundle.modules), ['index.js']);
	// One module: local imports inlined, the runtime's own left for it.
	assert.match(bundle.modules['index.js'], /hello from the server/);
	assert.match(bundle.modules['index.js'], /from "cloudflare:workers"/);
	// A top-level script is bundled and named .js; a script in a folder is copied as it is.
	assert.deepEqual(Object.keys(bundle.ui), [
		'app.js',
		'index.html',
		'lib/shout.js',
		'styles/app.css'
	]);
	assert.match(bundle.ui['app.js'], /toUpperCase/);
	assert.deepEqual(Object.keys(bundle.migrations), ['0001_init.sql']);
});

test('builds the same bytes twice, and from any folder, so the hash names the code', async () => {
	const root = await app(minimal);
	const here = process.cwd();
	const first = (await build(root)).hash;
	try {
		process.chdir(tmpdir());
		assert.equal((await build(root)).hash, first);
		assert.equal((await build(await app(minimal))).hash, first);
	} finally {
		process.chdir(here);
	}
});

test('a dev build carries its own version', async () => {
	const { manifest } = await build(await app(minimal), { version: '1.0.0-dev.7' });
	assert.equal(manifest.version, '1.0.0-dev.7');
});

test('refuses what the plugin host could not serve or run', async () => {
	await assert.rejects(
		build(await app({ ...minimal, 'ui/logo.png': 'not text' })),
		/logo\.png: screens can be/
	);
	const { 'ui/index.html': _, ...noIndex } = minimal;
	await assert.rejects(build(await app(noIndex)), /ui\/index\.html is required/);
	await assert.rejects(
		build(await app({ ...minimal, 'migrations/later/0002.sql': '' })),
		/no folders/
	);
	const root = await app(minimal);
	await writeFile(
		join(root, 'teralo-app.json'),
		JSON.stringify({ teraloApi: 2, server: 'server/index.js', version: '1.0.0' })
	);
	await assert.rejects(build(root), /teraloApi must be 1/);
});
