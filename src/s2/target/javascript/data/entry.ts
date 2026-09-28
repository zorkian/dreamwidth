// entry.ts
//
// Journal entries, as LJ::Entry and DW::Logic::LogItems load them.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { type Databases, type Row, int, text } from "./db";
import type { Site, User } from "./user";

const S2_DATE_FORMAT = "%Y %m %d %H %i %s %w";
const COLUMNS = `jitemid, anum, posterid, security, allowmask, eventtime, logtime, replycount,
    DATE_FORMAT(eventtime, '${S2_DATE_FORMAT}') AS alldatepart,
    DATE_FORMAT(logtime, '${S2_DATE_FORMAT}') AS system_alldatepart`;

export interface RecentOptions {
    readonly itemshow: number;
    readonly skip: number;
    readonly maxScrollback: number;
    readonly tagids?: readonly number[];
    readonly tagmode?: "and" | "or";
    // $LJ::TAG_INTERSECTION: an "and" filter on more tags than this matches nothing.
    readonly tagIntersection: number;
    readonly security?: string;
    readonly posterid?: number;
}

const logpropNames = new WeakMap<Databases, Promise<Map<number, string>>>();

export interface Tag {
    readonly kwid: number;
    readonly name: string;
}

export class Entry {
    readonly jitemid: number;
    readonly anum: number;
    readonly posterid: number;
    readonly security: string;
    readonly allowmask: number;
    readonly eventtime: string;
    readonly logtime: string;
    readonly alldatepart: string;
    readonly systemAlldatepart: string;
    readonly replycount: number;
    subject = "";
    event = "";
    props: Record<string, string> = {};
    tags: Tag[] = [];
    slug = "";

    constructor(readonly journal: User, row: Row) {
        this.jitemid = int(row.jitemid);
        this.anum = int(row.anum);
        this.posterid = int(row.posterid);
        this.security = text(row.security);
        this.allowmask = int(row.allowmask);
        this.eventtime = text(row.eventtime);
        this.logtime = text(row.logtime);
        this.alldatepart = text(row.alldatepart);
        this.systemAlldatepart = text(row.system_alldatepart);
        this.replycount = int(row.replycount);
    }

    get ditemid(): number {
        return this.jitemid * 256 + this.anum;
    }

    isSuspended(): boolean {
        return this.props.statusvis === "S";
    }

    // Anonymous visitors see only public, unsuspended entries.
    isPublic(): boolean {
        return this.security === "public" && !this.isSuspended();
    }

    // LJ::Entry::url
    url(site: Site): string {
        const base = this.journal.journalBase(site);
        if (this.slug) return `${base}/${this.eventtime.slice(0, 10).replaceAll("-", "/")}/${this.slug}.html`;
        return `${base}/${this.ditemid}.html`;
    }

    // LJ::Entry::reply_count prefers the cached prop.
    replyCount(): number {
        return this.props.replycount !== undefined ? int(this.props.replycount) : this.replycount;
    }

    commentsDisabled(): boolean {
        return !!(truthy(this.props.opt_nocomments) || truthy(this.props.opt_nocomments_maintainer));
    }

    // DW::Logic::LogItems::recent_items for an anonymous viewer. Returns up to
    // `itemshow` entries after skipping `skip`, newest first.
    static async recent(db: Databases, journal: User, options: RecentOptions): Promise<Entry[]> {
        const { maxScrollback, tagmode, security, posterid } = options;
        const tagids = tagmode === "and" ? options.tagids?.slice(0, options.tagIntersection) : options.tagids;
        const itemshow = Math.min(options.itemshow, maxScrollback);
        const skip = Math.max(0, Math.min(options.skip, maxScrollback - itemshow));
        const sortKey = journal.journaltype === "C" ? "rlogtime" : "revttime";

        let where = "";
        const params: unknown[] = [journal.userid];
        if (tagids?.length) {
            const rows = await journal.cluster(db,
                "SELECT jitemid, kwid FROM logtagsrecent WHERE journalid = ? AND kwid IN (?)", [journal.userid, tagids]);
            const counts = new Map<number, number>();
            for (const row of rows) counts.set(int(row.jitemid), (counts.get(int(row.jitemid)) ?? 0) + 1);
            const need = tagmode === "and" ? options.tagids!.length : 1;
            const jitemids = [...counts].filter(([, count]) => count >= need).map(([jitemid]) => jitemid);
            if (!jitemids.length) return [];
            where += " AND jitemid IN (?)";
            params.push(jitemids);
        }
        if (security === "public" || security === "private") {
            where += " AND security = ?";
            params.push(security);
        } else if (security === "access") {
            where += " AND security = 'usemask' AND allowmask = 1";
        }
        if (posterid) {
            where += " AND posterid = ?";
            params.push(posterid);
        }
        const rows = await journal.cluster(db,
            `SELECT ${COLUMNS} FROM log2 USE INDEX (${sortKey})
             WHERE journalid = ? AND ${sortKey} <= 2147483647 AND security = 'public'${where}
             ORDER BY journalid, ${sortKey} LIMIT ?, ?`, [...params, skip, itemshow]);

        // Entries at the same time are shown in descending itemid order.
        const sortDate = sortKey === "rlogtime" ? "system_alldatepart" : "alldatepart";
        const entries: Entry[] = [];
        let group: Entry[] = [];
        const flush = () => entries.push(...group.sort((a, b) => b.jitemid - a.jitemid).splice(0));
        let last: string | undefined;
        for (const row of rows) {
            const date = text(row[sortDate]);
            if (date !== last) flush();
            group.push(new Entry(journal, row));
            last = date;
        }
        flush();
        return entries;
    }

    // Public entries posted on one day, as DayPage loads them.
    static async onDay(db: Databases, journal: User, year: number, month: number, day: number): Promise<Entry[]> {
        const rows = await journal.cluster(db,
            `SELECT ${COLUMNS} FROM log2 WHERE journalid = ? AND year = ? AND month = ? AND day = ?
             AND security = 'public' ORDER BY eventtime, logtime LIMIT 2000`, [journal.userid, year, month, day]);
        return rows.map(row => new Entry(journal, row));
    }

    // Public entries posted in one month, as MonthPage loads them, by event time.
    static async inMonth(db: Databases, journal: User, year: number, month: number): Promise<Entry[]> {
        const rows = await journal.cluster(db,
            `SELECT ${COLUMNS} FROM log2 WHERE journalid = ? AND year = ? AND month = ?
             AND security = 'public' LIMIT 2000`, [journal.userid, year, month]);
        return rows.map(row => new Entry(journal, row))
            .sort((a, b) => a.alldatepart < b.alldatepart ? -1 : a.alldatepart > b.alldatepart ? 1 : 0);
    }

    static async byDitemid(db: Databases, journal: User, ditemid: number): Promise<Entry | null> {
        const rows = await journal.cluster(db, `SELECT ${COLUMNS} FROM log2 WHERE journalid = ? AND jitemid = ?`,
            [journal.userid, Math.floor(ditemid / 256)]);
        const entry = rows[0] ? new Entry(journal, rows[0]) : null;
        return entry && entry.anum === ditemid % 256 ? entry : null;
    }

    // An entry by its URL slug, if posted on `date` (YYYY/MM/DD).
    static async bySlug(db: Databases, journal: User, slug: string, date: string): Promise<Entry | null> {
        const rows = await journal.cluster(db, `SELECT ${COLUMNS} FROM log2 JOIN logslugs USING (journalid, jitemid)
            WHERE journalid = ? AND slug = ?`, [journal.userid, slug]);
        const entry = rows[0] ? new Entry(journal, rows[0]) : null;
        return entry && entry.eventtime.slice(0, 10).replaceAll("-", "/") === date ? entry : null;
    }

    // Load text, props, tags and slugs for entries of one journal.
    static async fill(db: Databases, journal: User, entries: readonly Entry[]): Promise<void> {
        if (!entries.length) return;
        const byId = new Map(entries.map(entry => [entry.jitemid, entry]));
        const ids = [...byId.keys()];
        const query = (sql: string) => journal.cluster(db, sql, [journal.userid, ids]);
        const [texts, props, tags, slugs, names] = await Promise.all([
            query("SELECT jitemid, subject, event FROM logtext2 WHERE journalid = ? AND jitemid IN (?)"),
            query("SELECT jitemid, propid, value FROM logprop2 WHERE journalid = ? AND jitemid IN (?)"),
            query(`SELECT t.jitemid, t.kwid, k.keyword FROM logtags t
                   JOIN userkeywords k ON k.userid = t.journalid AND k.kwid = t.kwid
                   WHERE t.journalid = ? AND t.jitemid IN (?)`),
            query("SELECT jitemid, slug FROM logslugs WHERE journalid = ? AND jitemid IN (?)"),
            logpropList(db),
        ]);
        for (const row of texts) {
            const entry = byId.get(int(row.jitemid))!;
            entry.subject = text(row.subject);
            entry.event = text(row.event);
        }
        for (const row of props) {
            const name = names.get(int(row.propid));
            if (name) byId.get(int(row.jitemid))!.props[name] = text(row.value);
        }
        for (const row of tags) byId.get(int(row.jitemid))!.tags.push({ kwid: int(row.kwid), name: text(row.keyword) });
        for (const row of slugs) byId.get(int(row.jitemid))!.slug = text(row.slug);
    }
}

function logpropList(db: Databases): Promise<Map<number, string>> {
    let names = logpropNames.get(db);
    if (!names) {
        names = db.global("SELECT propid, name FROM logproplist")
            .then(rows => new Map(rows.map(row => [int(row.propid), text(row.name)])));
        logpropNames.set(db, names);
    }
    return names;
}

// LJ::User::get_daycounts for a logged-out viewer: [year, month, day, count]
// for each day with public entries, in date order.
export async function dayCounts(db: Databases, journal: User): Promise<[number, number, number, number][]> {
    const rows = await journal.cluster(db,
        `SELECT year, month, day, COUNT(*) AS n FROM log2 WHERE journalid = ? AND security = 'public'
         GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`, [journal.userid]);
    return rows.map(row => [int(row.year), int(row.month), int(row.day), int(row.n)]);
}

// Perl truthiness of a stored string.
export function truthy(value: string | undefined): boolean {
    return value !== undefined && value !== "" && value !== "0";
}
