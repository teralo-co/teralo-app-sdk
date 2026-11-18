/** The project the app is open on. Needs the `project:read` scope. */
export type Project = {
	id: string;
	name: string;
	/** ISO 4217, such as `AUD`: the currency the project's money is shown in. */
	currency: string;
	/** BCP 47, such as `en-AU`: format dates and numbers with it, not the device's. */
	locale: string;
	/** IANA, such as `Australia/Sydney`: the project's own clock. */
	timeZone: string;
};

/** The person using the app. Needs the `person:read` scope. */
export type Person = {
	id: string;
	name: string;
	/** Holds the app's higher level ("manage") on this project. */
	canManage: boolean;
};

/**
 * A location set up on the project (a building, level, area, ...). Needs the `locations:read`
 * scope. The tree is flat: a top-level location has `parentId: null`.
 */
export type Location = {
	id: string;
	name: string;
	parentId: string | null;
};

/** Teralo data, read with the person's own permissions. A missing scope rejects. */
export interface Teralo {
	project(): Promise<Project>;
	person(): Promise<Person>;
	/** The project's locations, in the order Teralo shows them. */
	locations(): Promise<Location[]>;
}

export type SqlValue = string | number | null | ArrayBuffer;
export type Row = Record<string, SqlValue>;

/**
 * The app's own SQLite database for this project (needs the `database` scope). Tables come from
 * the app's `migrations/*.sql`, run in name order. Every call is one transaction; an archived
 * project is read-only.
 */
export interface Database {
	all<T = Row>(sql: string, params?: SqlValue[]): Promise<T[]>;
	one<T = Row>(sql: string, params?: SqlValue[]): Promise<T | null>;
	run(sql: string, params?: SqlValue[]): Promise<{ rowsWritten: number }>;
	/** All saved or none. Resolves with each statement's rows. */
	batch(statements: { sql: string; params?: SqlValue[] }[]): Promise<Row[][]>;
}

export type AppRequest = {
	request: Request;
	url: URL;
	teralo: Teralo;
	db: Database;
};

/** The app's server: `export default defineApp(async ({ request, url, teralo, db }) => ...)`. */
export function defineApp(
	handle: (context: AppRequest) => Response | Promise<Response>
): new (...args: never[]) => { fetch(request: Request): Promise<Response> };
