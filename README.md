# Teralo apps SDK

Build mini apps that run inside [Teralo](https://teralo.co): small tools with their own screens
and their own data, switched on per organisation and per project. This package is the whole
contract an app gets:

- `@teralo-co/apps/client`: the bridge between the app's screens and Teralo's page.
- `@teralo-co/apps/server`: typed access to Teralo data and to the app's own database.
- `teralo-app`: the command that builds and publishes an app.

Start from [teralo-app-hello](https://github.com/teralo-co/teralo-app-hello), the smallest
complete app.

> **Status: 0.x.** Only apps made by Teralo are published for now. Outside authors come later,
> through publishing from a public GitHub repository.

## How an app runs

- **Screens** run in a sandboxed frame on the app's own address (`{install}.teralo.net`), so
  they have no cookies, no browser storage and no access to Teralo's page. They talk to Teralo
  over `postMessage` (the client below).
- **Server code** runs on Teralo's infrastructure, one isolate per install, with no keys and no
  internet unless an administrator agreed to named hosts.
- **Teralo data** is read with the person's own permissions, so an app never shows anyone more
  than Teralo would. An app cannot change Teralo's records.
- **The app's own data** is a SQLite database for each project the app is switched on for. An
  app can never read another project's rows.

## An app folder

```
teralo-app.json        the manifest
server/index.js        server code (any file; named in the manifest)
ui/index.html          the screen Teralo opens; other screens and assets beside it
migrations/0001_x.sql  optional: the app's tables, run in name order on each project
```

Scripts at the top of `ui/` (`.js`, `.mjs`, `.ts`) are bundled, so they can import packages.
Files in sub-folders are copied as they are. Screens can be `.html .js .mjs .css .json .svg .txt`
files for now; images and fonts are not served yet.

### `teralo-app.json`

```json
{
	"id": "hello",
	"name": "Hello",
	"version": "0.1.0",
	"teraloApi": 1,
	"publisher": "Teralo",
	"description": "One or two sentences shown to the organisation installing it.",
	"scopes": ["project:read", "database"],
	"egress": [],
	"card": true,
	"server": "server/index.js"
}
```

| Field         | Meaning                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `id`          | Stable across versions: lower-case words joined by hyphens                                                |
| `version`     | `major.minor.patch`. A version is published once and never changed                                        |
| `teraloApi`   | The plugin API contract the app is built for. This SDK speaks `1`                                         |
| `scopes`      | What the app asks to do, shown to the administrator who installs it (below)                               |
| `egress`      | Outside hosts the server code may call, such as `api.example.com`. Empty: no internet at all              |
| `card`        | The app offers a card for project dashboards: the same screens, told they are a card                      |
| `server`      | The server entry                                                                                          |
| `ui`, `migrations` | Optional folder names, `ui` and `migrations` by default                                              |

| Scope          | Lets the app                                                                         |
| -------------- | ------------------------------------------------------------------------------------ |
| `project:read` | See the name, currency, locale and time zone of the projects it is switched on for   |
| `person:read`  | See the name of the person using it, and whether they hold the app's higher level    |
| `locations:read` | See the names of the locations (buildings, levels, areas) set up on the projects it is switched on for |
| `database`     | Keep its own data in Teralo, in a separate database for each project                 |

## Server: `@teralo-co/apps/server`

```js
import { defineApp } from '@teralo-co/apps/server';

export default defineApp(async ({ request, url, teralo, db }) => {
	if (url.pathname === '/summary') {
		const project = await teralo.project();
		const row = await db.one('SELECT count(*) AS n FROM visits');
		return Response.json({ project: project.name, visits: row.n });
	}
	return Response.json({ error: 'Not found' }, { status: 404 });
});
```

- `teralo.project()`: `{ id, name, currency, locale, timeZone }` (`project:read`). Format dates and
  money with the project's `locale`, `timeZone` and `currency`, not the device's.
- `teralo.person()`: `{ id, name, canManage }` (`person:read`). `canManage` is the app's higher
  level, which an organisation grants in its permission templates (Apps: manage).
- `teralo.locations()`: `[{ id, name, parentId }]` (`locations:read`), the project's location tree
  flat, in Teralo's order; a top-level location has `parentId: null`.
- `db.all(sql, params)`, `db.one(sql, params)`, `db.run(sql, params)` (`{ rowsWritten }`) and
  `db.batch([{ sql, params }])` (all saved or none). Parameters are strings, numbers, `null` or
  `ArrayBuffer`s; always pass values as parameters, never in the SQL text.

Limits: 100 MB per project database (a write past it is rolled back; deletes always work),
5 seconds of CPU per request, and an archived project is read-only. An exception is logged by
Teralo and answered 502.

## Screens: `@teralo-co/apps/client`

```js
import { api, connect, toast } from '@teralo-co/apps/client';

const { surface, path } = await connect(); // 'page' or 'card'; the theme is applied
const response = await api('/summary'); // the app's own server, with the session token
toast('Saved', 'success');
```

| Function                   | Does                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `connect()`                | Tells Teralo the screen is ready. Resolves with `{ surface, path, theme }`. Call first |
| `api(path, init)`          | `fetch` to the app's server with the session token, renewed when it runs out          |
| `navigate(path)`           | Puts a screen in Teralo's URL (`/deliveries/12`), so Back, reload and links reach it  |
| `onNavigate(fn)`           | Back or Forward in Teralo moved to a screen                                           |
| `toast(message, kind)`     | A short message under the app's name: `success`, `error` or `info`                    |
| `saveFile(name, data)`     | Saves a `.csv .xlsx .pdf .json .txt` file, up to 25 MB                                 |
| `openPage(path)`           | From a dashboard card, opens the app's page                                           |
| `onTheme(fn)`              | Teralo switched between light and dark                                               |

Teralo's theme arrives as CSS custom properties on `:root`, light or dark with Teralo:
`--background --foreground --card --card-foreground --popover --popover-foreground --primary
--primary-foreground --secondary --secondary-foreground --muted --muted-foreground --accent
--accent-foreground --destructive --destructive-foreground --border --input --ring --link
--radius --chart-1` to `--chart-5` and `--font-sans`. `:root[data-theme]` is `light` or `dark`.

## Build and publish: `teralo-app`

```sh
npx teralo-app build                 # dist/bundle.json and its sha256
npx teralo-app publish               # to app.teralo.co, with TERALO_PUBLISH_SECRET
npx teralo-app publish --dev --to http://localhost:5173
```

`build` packs the app into one JSON file, `{ mainModule, modules, ui, migrations }`, named by the
sha256 of its bytes. Code is bundled with esbuild and left readable, and the same folder builds
the same bytes on any machine, so anyone can rebuild a tagged release and compare.

`publish` builds, then sends the bundle to Teralo, which checks it, stores it under its hash and
registers the version. Publishing never changes an install: each organisation's administrator
updates in **Tool Settings > Apps**. A version that asks for nothing new updates in one click;
one that asks for more scopes or hosts shows the consent dialog again, with what is new marked.

`--dev` publishes `{version}-dev.{time}` to a local Teralo, which moves its installs to it straight
away (when it asks for nothing new). Rerun it after a change, then reload the app.

## Versions

- The package follows semver. `teraloApi` is the contract number: a breaking change to the bridge,
  the server capabilities or the bundle format raises it, and Teralo says which it accepts.
- An app's version is published once. Fix forward with a new version.

## Licence

MIT
