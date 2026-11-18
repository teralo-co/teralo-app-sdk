#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { build, publish } from '../lib/build.js';

const USAGE = `Usage:
  teralo-app build [dir]
      Bundles the app into dist/bundle.json and prints its sha256.
  teralo-app publish [dir] [--to <url>] [--dev]
      Builds and publishes to Teralo (default https://app.teralo.co) with
      Teralo's publishing key in TERALO_PUBLISH_SECRET.
      --dev  publishes {version}-dev.{time} to a local Teralo, which moves
             its installs to it: rerun after each change, then reload.`;

const { positionals, values } = parseArgs({
	allowPositionals: true,
	options: {
		to: { type: 'string', default: 'https://app.teralo.co' },
		dev: { type: 'boolean', default: false }
	}
});
const [command, dir = '.'] = positionals;

try {
	if (command === 'build') {
		const { manifest, text, hash } = await build(dir);
		await mkdir(join(dir, 'dist'), { recursive: true });
		await writeFile(join(dir, 'dist', 'bundle.json'), text);
		const size = (Buffer.byteLength(text) / 1024).toFixed(1);
		console.log(`${manifest.id} ${manifest.version}: dist/bundle.json, ${size} KB, sha256 ${hash}`);
	} else if (command === 'publish') {
		const secret = process.env.TERALO_PUBLISH_SECRET;
		if (!secret) throw new Error("set TERALO_PUBLISH_SECRET to Teralo's publishing key");
		const result = await publish(dir, { to: values.to, secret, dev: values.dev });
		console.log(
			values.dev
				? `Published ${result.version}: ${result.rolled} install(s) moved to it. Reload the app.`
				: `Published ${result.version} (sha256 ${result.bundleHash}). Organisation administrators can install or update it in Tool Settings > Apps.`
		);
	} else {
		console.log(USAGE);
		if (command) process.exitCode = 1;
	}
} catch (err) {
	console.error(`teralo-app: ${err.message}`);
	process.exitCode = 1;
}
