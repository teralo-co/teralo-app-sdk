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

/**
 * Somebody on the project now, with a Teralo account. Needs the `people:read` scope. `id` is
 * the id `person()` answers for the same person.
 */
export type ProjectPerson = {
	id: string;
	name: string;
	company: string;
};

/**
 * An inducted worker signed in on site on `day`. Needs the `attendance:read` scope. One row per
 * worker per day, however often they signed in and out. Site workers are not Teralo accounts:
 * `workerId` is the same for a worker every day in this install of the app and means nothing
 * anywhere else, and it is never an id of `people()`.
 */
export type AttendanceDay = {
	workerId: string;
	name: string;
	/** The worker's employer. */
	company: string;
	/** `YYYY-MM-DD` on the project's own clock (`project().timeZone`). */
	day: string;
};

/** An item on the project's equipment and plant register. Needs the `equipment:read` scope. */
export type Equipment = {
	id: string;
	make: string | null;
	model: string | null;
	serialNumber: string | null;
	registrationNumber: string | null;
	category: string | null;
	type: string | null;
	/** The company the equipment belongs to. */
	owner: string;
	status: 'draft' | 'pending_review' | 'on_site' | 'rejected' | 'removed';
};

/**
 * Teralo data, read with the person's own permissions. A missing scope rejects, and so does a
 * list the person may not see in Teralo itself.
 */
export interface Teralo {
	project(): Promise<Project>;
	person(): Promise<Person>;
	/** The project's locations, in the order Teralo shows them. */
	locations(): Promise<Location[]>;
	/** The people on the project now, by name. At most 2,000. */
	people(): Promise<ProjectPerson[]>;
	/**
	 * Who signed in on site on each of the project's last 14 days, today included, newest day
	 * first. At most 5,000 rows.
	 */
	attendance(): Promise<AttendanceDay[]>;
	/** The project's equipment register, newest first. At most 2,000. */
	equipment(): Promise<Equipment[]>;
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
