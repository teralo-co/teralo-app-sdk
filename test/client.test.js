import assert from 'node:assert/strict';
import { after, test } from 'node:test';

// client.js runs in the app's frame: a stand-in window whose parent is Teralo's page.
const toParent = [];
const listeners = {};
globalThis.window = {
	parent: { postMessage: (message) => toParent.push(message) },
	addEventListener: (type, listener) => (listeners[type] = listener)
};
globalThis.document = { documentElement: { style: { setProperty() {} }, dataset: {} } };

let answer = () => new Response('ok');
const bearers = [];
globalThis.fetch = async (_path, init) => {
	const bearer = init.headers.get('Authorization').slice('Bearer '.length);
	bearers.push(bearer);
	return answer(bearer);
};

const client = await import('../client.js');
const channel = new MessageChannel();
const asked = [];
channel.port1.onmessage = (event) => asked.push(event.data);
after(() => channel.port1.close());

const connected = client.connect();
listeners.message({
	source: window.parent,
	data: { type: 'teralo:init', token: 't1', surface: 'page', path: '/', theme: { mode: 'light' } },
	ports: [channel.port2]
});
await connected;

test('a 401 asks for a fresh token on the port, never on the window', async () => {
	answer = (bearer) => new Response(null, { status: bearer === 't1' ? 401 : 200 });
	const replied = new Promise((resolve) => {
		channel.port1.onmessage = (event) => {
			asked.push(event.data);
			channel.port1.postMessage({ type: 'teralo:token', token: 't2' });
			resolve();
		};
	});
	const response = await client.api('/summary');
	await replied;
	assert.equal(response.status, 200);
	assert.deepEqual(asked, [{ type: 'teralo:token' }]);
	assert.equal(toParent.filter((message) => message.type === 'teralo:token').length, 0);
});

test('a token renewed while the call was out is used without asking again', async () => {
	asked.length = 0;
	bearers.length = 0;
	answer = async (bearer) => {
		if (bearer !== 't2') return new Response(null, { status: 200 });
		channel.port1.postMessage({ type: 'teralo:token', token: 't3' });
		await new Promise((resolve) => setTimeout(resolve, 20));
		return new Response(null, { status: 401 });
	};
	const response = await client.api('/summary');
	assert.equal(response.status, 200);
	assert.deepEqual(bearers, ['t2', 't3']);
	assert.deepEqual(asked, []);
});
