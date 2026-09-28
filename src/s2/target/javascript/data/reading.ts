// reading.ts
//
// The entries on a reading page, as DW::Logic::LogItems::watch_items finds
// them for a logged-out viewer, and the content filters that narrow them.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import type { SiteConfig } from "../server/config";
import { type Databases, type Row, int, text } from "./db";
import { Entry } from "./entry";
import { type Thawed, thaw } from "./storable";
import { User } from "./user";

// $LJ::EndOfTime, which rlogtime counts back from.
const END_OF_TIME = 2147483647;

export interface Watched {
    readonly user: User;
    readonly fgcolor: string;
    readonly bgcolor: string;
}

// A saved reading filter. `data` maps the userids it includes to their options.
export class ContentFilter {
    constructor(readonly owner: User, readonly name: string, readonly isPublic: boolean,
        private readonly data: Record<string, Thawed>) {}

    // DW::User::ContentFilters::content_filters with a name, compared case-insensitively.
    static async named(db: Databases, owner: User, name: string): Promise<ContentFilter | undefined> {
        const rows = await owner.cluster(db, `SELECT f.filtername, f.is_public, d.data FROM content_filters f
            LEFT JOIN content_filter_data d USING (userid, filterid) WHERE f.userid = ? AND LOWER(f.filtername) = LOWER(?)
            ORDER BY f.sortorder LIMIT 1`, [owner.userid, name]);
        const row = rows[0];
        if (!row) return undefined;
        const data = row.data ? thaw(row.data as Buffer) : {};
        return new ContentFilter(owner, text(row.filtername), text(row.is_public) === "1",
            data && typeof data === "object" && !Array.isArray(data) ? data : {});
    }

    isDefault(): boolean {
        return /^default( view)?$/i.test(this.name);
    }

    contains(userid: number): boolean {
        return String(userid) in this.data;
    }

    // DW::User::ContentFilters::Filter::show_entry
    async showEntry(db: Databases, config: SiteConfig, entry: Entry): Promise<boolean> {
        if (!await isPaid(db, config, this.owner)) return true;
        const journal = entry.journal;
        const opts = (this.data[String(journal.userid)] ?? {}) as Record<string, Thawed>;
        if (journal.journaltype === "C" && opts.postertype && opts.postertype !== "any") {
            const [admins, moderators] = await Promise.all(["A", "M"].map(type =>
                db.global("SELECT targetid FROM reluser WHERE userid = ? AND type = ?", [journal.userid, type])));
            const isAdmin = admins!.some(row => int(row.targetid) === entry.posterid);
            const isModerator = moderators!.some(row => int(row.targetid) === entry.posterid);
            if (opts.postertype === "maintainer" && !isAdmin) return false;
            if (opts.postertype === "moderator" && !(isAdmin || isModerator)) return false;
        }
        if (opts.adultcontent && opts.adultcontent !== "any") {
            await Entry.fill(db, journal, [entry]);
            const level = entry.props.adult_content_maintainer || entry.props.adult_content || journal.props.adult_content;
            if (level) {
                if (opts.adultcontent === "nonexplicit" && level === "explicit") return false;
                if (opts.adultcontent === "sfw" && level !== "none") return false;
            }
        }
        const tagids = Array.isArray(opts.tags) ? opts.tags.map(Number) : [];
        if (tagids.length) {
            const mode = String(opts.tagmode || "any_of");
            if (!["none_of", "any_of", "all_of"].includes(mode)) return false;
            await Entry.fill(db, journal, [entry]);
            const tags = new Set(entry.tags.map(tag => tag.kwid));
            const matched = tagids.filter(id => tags.has(id)).length;
            if (mode === "all_of") return matched === tagids.length;
            if (mode === "any_of") return matched > 0;
            return matched === 0;
        }
        return true;
    }
}

// LJ::User::is_paid
async function isPaid(db: Databases, config: SiteConfig, u: User): Promise<boolean> {
    if (u.journaltype === "I" || u.journaltype === "Y") return false;
    const rows = await db.global(`SELECT typeid, permanent, IFNULL(expiretime, 0) - UNIX_TIMESTAMP() AS expiresin
        FROM dw_paidstatus WHERE userid = ?`, [u.userid]);
    const row = rows[0];
    if (!row || !(int(row.permanent) || int(row.expiresin) > 0)) return false;
    return config.capBits[text(row.typeid)]?._account_type !== "free";
}

export interface ReadingOptions {
    readonly itemshow: number;
    readonly skip: number;
    readonly filter?: ContentFilter;
    // Journal types to show, from ?show=.
    readonly showtypes?: string;
    // The network page: the journals watched by those this journal watches.
    readonly network: boolean;
    readonly security?: string;
}

// DW::Logic::LogItems::watch_items. Returns the page's entries, newest first,
// and the journals they come from.
export async function watchItems(db: Databases, config: SiteConfig, u: User, options: ReadingOptions):
    Promise<{ entries: Entry[]; watched: Map<number, Watched> }> {
    const { itemshow, filter, security } = options;
    const skip = Math.max(0, options.skip);
    const getitems = itemshow + skip;
    const now = Math.floor(Date.now() / 1000);
    const maxAge = config.maxFriendsViewAge;
    let lastmax = END_OF_TIME - (now - maxAge);

    // Journals to read, most recently updated first.
    const buffer = await (options.network ? networkJournals(db, u, filter, options.showtypes)
        : watchedJournals(db, u, filter, options.showtypes, lastmax));

    const watched = new Map<number, Watched>();
    let items: { entry: Entry; rlogtime: number; evtime: number }[] = [];
    let itemsleft = getitems;
    while (buffer.length) {
        const friend = buffer.shift()!;
        watched.set(friend.user.userid, friend);
        const log = await recentLog(db, friend.user, maxAge, lastmax);
        const found: typeof items = [];
        for (const item of log) {
            // get_log2_recent_user checks the count it was given but never lowers it.
            if (!itemsleft) break;
            if (item.rlogtime > lastmax) break;
            if (item.entry.security !== "public") continue;
            if (security && security !== "public") continue;
            if (filter && !await filter.showEntry(db, config, item.entry)) continue;
            found.push(item);
        }
        if (found.length) {
            items.push(...found);
            itemsleft--;
            items.sort((a, b) => a.rlogtime - b.rlogtime || b.evtime - a.evtime || b.entry.jitemid - a.entry.jitemid);
            items = items.slice(0, getitems);
        }
        if (items.length === getitems) {
            lastmax = items.at(-1)!.rlogtime;
            if (buffer.length && buffer[0]!.rupdate > lastmax) break;
        }
    }
    return { entries: items.slice(skip).map(item => item.entry), watched };
}

interface Candidate extends Watched {
    readonly rupdate: number;
}

// The journals this one watches, as watch_items' first get_next_friend loads them.
async function watchedJournals(db: Databases, u: User, filter: ContentFilter | undefined, showtypes: string | undefined,
    lastmax: number): Promise<Candidate[]> {
    const list = await watchList(db, u, true);
    for (const id of list.keys()) if (filter && !filter.contains(id)) list.delete(id);
    const users = await visibleJournals(db, list, showtypes);
    const updated = await timeupdates(db, [...users.keys()]);
    return [...users.values()]
        .filter(user => (updated.get(user.userid) ?? 0) >= lastmax)
        .map(user => ({ user, ...list.get(user.userid)!, rupdate: END_OF_TIME - (updated.get(user.userid) ?? 0) }))
        .sort((a, b) => a.rupdate - b.rupdate);
}

// The journals watched by the personal journals this one watches, as the
// network page's get_next_friend finds them.
async function networkJournals(db: Databases, u: User, filter: ContentFilter | undefined,
    showtypes: string | undefined): Promise<Candidate[]> {
    const list = await watchList(db, u, false);
    const all = new Set(list.keys());
    for (const id of list.keys()) if (filter && !filter.contains(id)) list.delete(id);
    const friends = await visibleJournals(db, list, "P");
    const updated = await timeupdates(db, [...friends.keys()]);
    const others = new Map<number, { fgcolor: string; bgcolor: string }>();
    const byUpdate = [...friends.values()].sort((a, b) => (updated.get(b.userid) ?? 0) - (updated.get(a.userid) ?? 0));
    for (const friend of byUpdate.slice(0, 51)) {
        let count = 0;
        for (const id of (await watchList(db, friend, true)).keys()) {
            if (count > 100) break;
            if (all.has(id) || id === u.userid) continue;
            others.set(id, { fgcolor: "#000000", bgcolor: "#ffffff" });
            count++;
        }
    }
    const users = await visibleJournals(db, others, showtypes);
    const otherUpdated = await timeupdates(db, [...users.keys()]);
    return [...users.values()]
        .map(user => ({ user, ...others.get(user.userid)!, rupdate: END_OF_TIME - (otherUpdated.get(user.userid) ?? 0) }))
        .sort((a, b) => a.rupdate - b.rupdate);
}

// DW::User::Edges::WatchTrust::watch_list: userid to colours. With
// `communities`, a community's list is its members.
async function watchList(db: Databases, u: User, communities: boolean):
    Promise<Map<number, { fgcolor: string; bgcolor: string }>> {
    const list = new Map<number, { fgcolor: string; bgcolor: string }>();
    if (u.journaltype === "C" && communities) {
        for (const row of await db.global("SELECT targetid FROM reluser WHERE userid = ? AND type = 'E'", [u.userid])) {
            list.set(int(row.targetid), { fgcolor: "#000000", bgcolor: "#ffffff" });
        }
        return list;
    }
    if (u.journaltype !== "P" && u.journaltype !== "I") return list;
    const hex = (value: unknown) => `#${int(value).toString(16).padStart(6, "0")}`;
    for (const row of await db.global(
        "SELECT to_userid, fgcolor, bgcolor FROM wt_edges WHERE from_userid = ? AND groupmask & (1 << 61)", [u.userid])) {
        list.set(int(row.to_userid), { fgcolor: hex(row.fgcolor), bgcolor: hex(row.bgcolor) });
    }
    return list;
}

// Drop journals that are not visible or not of the types shown (F standing for Y).
async function visibleJournals(db: Databases, ids: Map<number, unknown>, types?: string): Promise<Map<number, User>> {
    const users = await User.byIds(db, [...ids.keys()]);
    const valid = types?.toUpperCase().replaceAll("F", "Y");
    for (const [id, user] of users) {
        if (!user.isVisible() || valid && !valid.includes(user.journaltype)) users.delete(id);
    }
    for (const id of ids.keys()) if (!users.has(id)) ids.delete(id);
    return users;
}

async function timeupdates(db: Databases, ids: number[]): Promise<Map<number, number>> {
    const rows = ids.length
        ? await db.global("SELECT userid, UNIX_TIMESTAMP(timeupdate) AS t FROM userusage WHERE userid IN (?)", [ids])
        : [];
    return new Map(rows.map(row => [int(row.userid), int(row.t)]));
}

// LJ::get_log2_recent_log: the journal's entries logged within the maximum
// age, oldest rlogtime (newest post) first.
async function recentLog(db: Databases, journal: User, maxAge: number, notafter: number):
    Promise<{ entry: Entry; rlogtime: number; evtime: number }[]> {
    const rows: Row[] = await journal.cluster(db,
        `SELECT jitemid, anum, posterid, security, allowmask, eventtime, replycount, rlogtime,
            DATE_FORMAT(eventtime, '%Y %m %d %H %i %s %w') AS alldatepart
         FROM log2 USE INDEX (rlogtime)
         WHERE journalid = ? AND rlogtime <= (${END_OF_TIME} - UNIX_TIMESTAMP()) + ?`, [journal.userid, maxAge]);
    return rows.map(row => {
        // The log time is kept as rlogtime; Perl reads both times as UTC.
        const logtime = new Date((END_OF_TIME - int(row.rlogtime)) * 1000);
        const parts = [logtime.getUTCFullYear(), logtime.getUTCMonth() + 1, logtime.getUTCDate(), logtime.getUTCHours(),
            logtime.getUTCMinutes(), logtime.getUTCSeconds()].map(n => String(n).padStart(2, "0"));
        const entry = new Entry(journal, {
            ...row, logtime: `${parts.slice(0, 3).join("-")} ${parts.slice(3).join(":")}`,
            system_alldatepart: `${parts.join(" ")} ${logtime.getUTCDay()}`,
        });
        return { entry, rlogtime: int(row.rlogtime), evtime: Date.parse(`${text(row.eventtime).replace(" ", "T")}Z`) / 1000 };
    }).filter(item => !notafter || item.rlogtime <= notafter).sort((a, b) => a.rlogtime - b.rlogtime);
}
