// The app's server code runs in Teralo's plugin host, one isolate per install, with no
// bindings, no keys and no internet unless an administrator agreed to named hosts. Teralo hands
// each request two capabilities, already bound to this install, project and person: `teralo`
// (Teralo data, through the person's own permissions) and `db` (the app's own database for
// this project).
import { WorkerEntrypoint } from 'cloudflare:workers';

/**
 * The app's server: `export default defineApp(async ({ request, url, teralo, db }) => ...)`.
 * Return a `Response`; an exception is logged by Teralo and answered 502.
 */
export function defineApp(handle) {
	return class extends WorkerEntrypoint {
		async fetch(request) {
			const { teralo: gate, db } = this.ctx.props;
			const teralo = {
				project: () => gate.call('project.get'),
				person: () => gate.call('person.get'),
				locations: () => gate.call('locations.list')
			};
			return handle({ request, url: new URL(request.url), teralo, db });
		}
	};
}
