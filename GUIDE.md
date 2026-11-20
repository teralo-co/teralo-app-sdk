# Building a Teralo app

This guide walks through building an app for [Teralo](https://teralo.co), using a real one as the
worked example: [Concrete and Reinforcement][tracker], which tracks materials on a project and
forecasts the final cost against budget. Each step links to the file in that app that does the
job. The [README](README.md) is the API reference: this guide says when and why, the README says
exactly what.

> **Today only Teralo publishes apps.** You can build and test an app with this SDK now.
> Publishing your own comes later, from a public GitHub repository with a review (see
> [Publishing and versions](#11-publishing-and-versions)).

## 1. How an app runs

An app has three parts, and Teralo keeps them apart:

- **Screens** run in a sandboxed frame on the app's own address. They have no cookies, no browser
  storage and no access to Teralo's page, and they talk to Teralo over a message bridge
  (`@teralo-co/apps/client`).
- **Server code** runs on Teralo's infrastructure, one isolate per install, with no keys and no
  internet unless an administrator agreed to named hosts. Each request gets two objects: `teralo`
  (Teralo data, read as the person using the app) and `db` (the app's own database for this
  project).
- **The app's data** lives in a SQLite database for each project the app is switched on for.

Who does what in Teralo: an organisation administrator installs the app in **Tool Settings >
Apps**, agreeing to what it asks for, and switches it on for projects. People in that organisation
who hold the **Apps** permission open it under **Apps** in the project. Apps are for the
organisation's own staff, not other companies on the project, and they run in a web browser
(phones included); Teralo's iOS, Android and desktop apps do not show them yet.

More in the README: [How an app runs](README.md#how-an-app-runs).

## 2. Start from Hello

```sh
git clone https://github.com/teralo-co/teralo-app-hello my-app
cd my-app
npm install
```

[Hello](https://github.com/teralo-co/teralo-app-hello) is the smallest complete app: it shows the
project's name, counts visits in its own database, saves them as a CSV, has a second screen that
lives in Teralo's URL, and offers a dashboard card. Its folder is the layout every app uses
([An app folder](README.md#an-app-folder)):

```
teralo-app.json        the manifest
server/index.js        server code
ui/index.html          the screen Teralo opens (plus app.js, styles.css)
migrations/0001_x.sql  the app's tables
```

Change `id`, `name` and `description` in `teralo-app.json` first. The tracker grew from the same
layout and adds two folders: [`screens/`][screens] for its screen modules (step 6) and
[`test/`][test] for its tests (step 10).

## 3. The manifest: `teralo-app.json`

The tracker's manifest is [`teralo-app.json`][manifest]. Every field is in the README
([`teralo-app.json`](README.md#teralo-appjson)); what matters when you write one:

- **`id`** never changes once published. **`version`** is `major.minor.patch`, and each number is
  published once.
- **`description`** is what the administrator reads before installing: say what the app does and
  what data it keeps.
- **`scopes`**: ask only for what the app uses. The administrator sees each one in plain words
  before installing, and a call that needs a scope the install did not agree to is refused. The
  tracker asks for four and its README says why for each ([What it asks for][tracker-asks]).
  Adding a scope in a later version means every organisation's administrator agrees again before
  updating; a scope you drop stops working for an install as soon as it updates.
- **`egress`**: the outside hosts your server code may call, as bare host names
  (`api.example.com`). Calls go over https only and the host must match exactly, so
  `api.example.com` does not cover `example.com`. Empty means no internet at all; the tracker
  needs none. A new host in a later version also means agreeing again. Screens can never call
  outside hosts, only your server can.
- **`card`**: `true` if the app offers a project dashboard card (step 7).
- **`server`**: the server entry file.

## 4. Server code

The tracker's server is [`server/index.js`][server]; the API is in the README
([Server](README.md#server-teralo-coappsserver)). What it shows:

- **One handler.** `defineApp(async ({ request, url, teralo, db }) => ...)` routes on method and
  path and returns a `Response`. Expected refusals are JSON with a status and a message a person
  can read (its `Refusal` class); anything thrown and not caught becomes a 502 that Teralo logs.
- **Teralo data once per request, in parallel.** `summary()` asks `teralo.project()`,
  `teralo.person()`, `teralo.locations()` and the database together. Every `teralo` call is a round
  trip to Teralo made as the signed-in person, and they are rate limited per person (about 60 a
  minute), so ask for what a request needs, once.
- **Authority on the server.** `writer()` refuses a change to materials, rates or budget unless
  `person.canManage` is true (the person holds the Apps "manage" level on the project). The screens
  hide those controls too, but hiding is not a check.
- **Every value checked.** Text lengths, numbers and dates are parsed and bounded, rows per request
  are capped, and a location id the screen sends must be one of `teralo.locations()`
  (`text()`, `locationOf()`).
- **The project's clock.** "Today" is `todayIn(project.timeZone)` in [`server/forecast.js`][forecast],
  never the server's clock or the device's.
- **Pure rules apart.** [`server/forecast.js`][forecast] holds the money rules with no `teralo` or
  `db`, so [`test/forecast.test.js`][test-forecast] can test them with `node --test`.

Things to know about the runtime:

- It has web-standard APIs (`fetch`, `Request`, `Response`, `URL`, `crypto.subtle`, `Intl`), the
  same as Cloudflare Workers. There are no Node.js built-ins and no file system; `teralo-app build`
  bundles your imports, and a package that needs Node will not run.
- **Module memory is shared** by everyone in the organisation using the app: one isolate serves
  them all. Never keep one person's data in a module-level variable. Keep state in the database.
- `env` is empty and the request arrives without its session token: the app holds no keys.
- With agreed hosts, `fetch('https://api.example.com/...')` works and any other address answers 403. With none, `fetch` throws.

## 5. The database and migrations

The tracker's tables are [`migrations/0001_tracker.sql`][migration].

- **One database per project.** The app never filters by project, and can never see another
  project's rows or another organisation's.
- **`db.all`, `db.one`, `db.run`, `db.batch`**, always with parameters, never values pasted into
  the SQL text ([Server](README.md#server-teralo-coappsserver)). Parameters are strings, numbers,
  `null` or `ArrayBuffer`s: store a boolean as `0` or `1`. A statement takes at most 100
  parameters and 100 KB, so write many rows as a batch of statements.
- **`db.batch` is one transaction:** all saved or none. The tracker writes each change and its
  change-log row in the same batch, and the log row names the row just inserted with
  `last_insert_rowid()` (`log()` in [`server/index.js`][server]).
- **Money as integer cents, quantities as integers** of a small unit (the tracker uses thousandths),
  so totals never drift; dates as `YYYY-MM-DD` on the project's clock. The migration's header says
  so for anyone reading the tables.
- **Migrations** are `migrations/*.sql` files (no folders). They run in name order on each
  project's database, the first time the app uses it after a new version, every pending file in
  one transaction.
  - Never change or rename a migration once it is published: add a new file.
  - Name new files so they sort last, with zero-padded numbers (`0002_add_supplier.sql`). A new
    file that sorts before one that already ran is refused.
  - If one fails, nothing is changed and the error names it. Your new code then runs against the
    old tables until you publish a fixed version, so try each migration on data shaped like the
    real thing first.
- **Archived project:** the database is read-only. Reads work; any write, `CREATE TABLE`
  included, is refused with a message written for people. Show it rather than hide it.
  Migrations still run.
- **Full:** 100 MB per project. A write that would grow it past that is rolled back with a
  message; deleting always works.
- **Slow:** a query is stopped after 5 seconds of work.
- **Your tables are the export.** An organisation administrator can download all of an app's data
  as CSV files, one per table and a folder per project, so give tables and columns names a person
  can read. When an organisation removes an app its data is kept for 30 days (installing again
  brings it back), then deleted.

## 6. Screens and the bridge

The tracker's screens: [`ui/index.html`][index-html] (the page), [`ui/app.js`][app-js] (the entry
point) and the modules in [`screens/`][screens]. The functions are in the README
([Screens](README.md#screens-teralo-coappsclient)).

**Files.** `ui/index.html` is required: Teralo opens it for the page and for the card. Scripts at
the top level of `ui/` are bundled, so they can import the SDK and npm packages; files in
sub-folders are copied as they are. So keep shared screen modules **outside** `ui/`: the tracker's
are in `screens/`, imported by `ui/app.js`, which bundles them in. Screens can be
`.html .js .mjs .css .json .svg .txt` files; images and fonts are not served yet, so use SVG, CSS or
`data:` URLs, and Teralo's font (`--font-sans`).

**What a screen may load.** Scripts only from the app's own files: no inline `<script>` blocks, no
`onclick="..."` attributes, no CDN. Inline styles are fine. Network calls go only to the app's own
server. Bundle any library you use: the tracker bundles Chart.js into `app.js`
([`screens/overview.js`][overview]).

**Talking to Teralo** (all in [`ui/app.js`][app-js]):

- **`connect()` first.** It resolves with `surface` (`'page'` or `'card'`), the `path` in Teralo's
  URL and the theme, already applied.
- **`api(path, init)`** for every call to the app's server. It adds the session token and renews
  it; the tracker's `send()` in [`screens/lib.js`][lib] wraps it and shows the server's refusal.
- **Navigation.** `navigate(path)` puts a screen in Teralo's URL, so Back, reload and shared links
  reach it; `onNavigate()` hears Back and Forward; after a reload `connect()` hands back the path.
  Paths are plain segments (`/deliveries`, `/deliveries/12`), at most 300 characters, with no query
  string and no `..`: anything else is ignored. The tracker keeps a `SCREENS` list, and its menu
  links call `preventDefault()` and then `go()`, which calls `navigate()`.
- **Toasts.** `toast(message, kind)`: plain text under the app's name, at most 200 characters and
  one a second.
- **Errors.** An uncaught error, an unhandled rejection and a server answer of 500 or more are
  reported to Teralo for you: the person sees that the app has a problem and Teralo keeps the
  message (at most 500 characters, one every ten seconds) for whoever looks after the app. A
  failed `fetch` with no connection is not reported. Call `reportError(message)` for a failure
  you catch and cannot recover from. Never put a person's data in the message.
- **Saving files.** The frame cannot download. `saveFile(name, data)` hands Teralo a
  `.csv .xlsx .pdf .json .txt` file of up to 25 MB to save. The tracker's CSV exports are in
  [`screens/overview.js`][overview]; `csv()` in [`screens/lib.js`][lib] puts a quote before any text
  a spreadsheet would run as a formula.
- **Theme.** Teralo's colours arrive as CSS variables on `:root`, light or dark with Teralo, and
  `:root[data-theme]` says which ([list](README.md#screens-teralo-coappsclient)). Style with them, as
  [`ui/styles.css`][styles] does; use `onTheme()` for anything drawn in JavaScript (the tracker
  redraws its chart).
- **The project's formats.** Show money, numbers and dates with the project's `locale`, `currency`
  and `timeZone` from `teralo.project()`, never the device's: `formatter()` in
  [`screens/lib.js`][lib].

**What the frame will not do.** `alert()`, `confirm()` and `prompt()` never open, pop-ups are
blocked, and a link that loads another page makes Teralo close the app. A form fires its
`submit` event: in the `onsubmit` handler call `event.preventDefault()` and save the data
yourself. A form left to submit sends nothing, but Teralo closes the app as for a link. For a
destructive action use a two-click button (`confirmButton()` in [`screens/lib.js`][lib]); for a
link inside the app, call `navigate()`.

**Size.** The frame fills the page; there is no height to report. People open apps on phones, so
make every screen work at 390 px wide.

## 7. The dashboard card

With `"card": true` in the manifest, people can add the app's card to a project dashboard
(**Add widget**). It is the same `ui/index.html`: `connect()` says `surface: 'card'`, and the
screen draws a compact summary, with `openPage(path)` to open the full app. The tracker's
`render()` in [`ui/app.js`][app-js] picks [`screens/card.js`][card] for the card: forecast final
cost against budget, the materials furthest over, and an Open button. A card shows only where the
app is switched on, to people who may open apps on that project.

## 8. What an app cannot do

| An app cannot                                                 | Because                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Reach the internet, except agreed https hosts from its server | Server code has no outbound access beyond the `egress` list; screens only reach their own server |
| Read Teralo's cookies, storage or page                        | Screens run in a sandboxed frame on their own address                                            |
| Keep data in the browser                                      | The frame has no cookies or storage: use the database                                            |
| See more Teralo data than the person using it                 | Every `teralo` call is checked as that person, every time                                        |
| See Teralo data its scopes do not name                        | A call needing a scope the install did not agree to is refused                                   |
| Change Teralo's records                                       | Teralo data is read-only to apps for now                                                         |
| Read another project's or another organisation's app data     | Each install has a separate database for each project                                            |
| Hold keys or secrets                                          | `env` is empty and the session token is removed before the request reaches the app               |

When Teralo switches an app off, an organisation removes it, or a person loses access, the app
stops: Teralo data calls are refused at once, database calls within a minute, and the app closes
when its session next renews.

## 9. Limits

| Limit                        | Value                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------- |
| Bundle                       | 10 MB                                                                            |
| App data                     | 100 MB per project                                                               |
| Query                        | stopped after 5 seconds of work                                                  |
| SQL statement                | 100 parameters, 100 KB                                                           |
| Teralo data calls            | about 60 a minute per person                                                     |
| Session token                | 10 minutes, renewed for you by `api()`                                           |
| Toast                        | 200 characters, one a second                                                     |
| Saved file                   | 25 MB; `.csv .xlsx .pdf .json .txt`                                              |
| Screen path                  | 300 characters, plain segments                                                   |
| Screen files                 | `.html .js .mjs .css .json .svg .txt`                                            |
| Manifest text                | `id` 60, `name` 80, `publisher` 120, `description` 500 characters; no `<` or `>` |
| Data after an app is removed | kept 30 days                                                                     |

## 10. Build and test locally

- **Build:** `npx teralo-app build` writes `dist/bundle.json` and prints its size and sha256. The
  same folder builds the same bytes on any machine, so anyone can rebuild a tagged release and
  compare it with what Teralo runs. The build refuses files Teralo cannot serve and a missing
  `ui/index.html` ([Build and publish](README.md#build-and-publish-teralo-app)).
- **Test the rules:** `npm test` in the tracker runs [`test/forecast.test.js`][test-forecast]
  with `node --test`. Keep testable code in modules that import neither
  `@teralo-co/apps/server` nor `cloudflare:*`, as [`server/forecast.js`][forecast] does. To test
  request handling too, keep the function you pass to `defineApp` in its own module and call it
  with stand-ins for `teralo` and `db`.
- **Run it inside Teralo:** this needs a Teralo you can publish to. Teralo's own developers run one
  locally and use `npm run dev` (`teralo-app publish --dev --to http://localhost:5173`): each run
  publishes a `-dev` build that moves the installs to it, then a reload shows it. This is not open
  to outside authors yet.

## 11. Publishing and versions

- **Today Teralo publishes**, with its own key: `TERALO_PUBLISH_SECRET=... npx teralo-app publish`.
  Teralo checks the bundle, stores it under its hash and registers the version. Outside authors
  will publish later, from a public GitHub repository, with a review before any organisation can
  install the app.
- **A version is published once.** Fix forward with a new number.
- **Publishing never changes an install.** Each organisation's administrator clicks **Update** in
  Tool Settings > Apps. A version that asks for nothing new updates in one click; one that asks
  for more scopes or hosts shows the consent dialog again, with what is new marked.
- **Teralo can switch an app off** for every organisation at once.
- **Keep the repository public and the code readable.** The build is not minified so the people
  who install an app can read what it does; the tracker's README explains its rules with a worked
  example by hand ([How the numbers work][tracker-numbers]).

## Where next

- The [README](README.md): every function, field and scope.
- [teralo-app-hello](https://github.com/teralo-co/teralo-app-hello): the starting point.
- [Concrete and Reinforcement][tracker]: the whole worked example, with its README.

[tracker]: https://github.com/teralo-co/teralo-app-concrete-reinforcement
[tracker-asks]: https://github.com/teralo-co/teralo-app-concrete-reinforcement#what-it-asks-for
[tracker-numbers]: https://github.com/teralo-co/teralo-app-concrete-reinforcement#how-the-numbers-work
[manifest]: https://github.com/teralo-co/teralo-app-concrete-reinforcement/blob/main/teralo-app.json
[server]: https://github.com/teralo-co/teralo-app-concrete-reinforcement/blob/main/server/index.js
[forecast]: https://github.com/teralo-co/teralo-app-concrete-reinforcement/blob/main/server/forecast.js
[migration]: https://github.com/teralo-co/teralo-app-concrete-reinforcement/blob/main/migrations/0001_tracker.sql
[index-html]: https://github.com/teralo-co/teralo-app-concrete-reinforcement/blob/main/ui/index.html
[app-js]: https://github.com/teralo-co/teralo-app-concrete-reinforcement/blob/main/ui/app.js
[styles]: https://github.com/teralo-co/teralo-app-concrete-reinforcement/blob/main/ui/styles.css
[screens]: https://github.com/teralo-co/teralo-app-concrete-reinforcement/tree/main/screens
[lib]: https://github.com/teralo-co/teralo-app-concrete-reinforcement/blob/main/screens/lib.js
[overview]: https://github.com/teralo-co/teralo-app-concrete-reinforcement/blob/main/screens/overview.js
[card]: https://github.com/teralo-co/teralo-app-concrete-reinforcement/blob/main/screens/card.js
[test]: https://github.com/teralo-co/teralo-app-concrete-reinforcement/tree/main/test
[test-forecast]: https://github.com/teralo-co/teralo-app-concrete-reinforcement/blob/main/test/forecast.test.js
