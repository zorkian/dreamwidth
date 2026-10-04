// comment.ts
//
// Comments on an entry, as LJ::Talk::get_talk_data and get_talktext2 load
// them.
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
import { Entry } from "./entry";
import { User } from "./user";

// One comment, as LJ::Comment loads it.
export class Comment {
    readonly jtalkid: number;
    // L for a comment on an entry.
    readonly nodetype: string;
    readonly nodeid: number;
    readonly parenttalkid: number;
    readonly posterid: number;
    // A active, S screened, D deleted, F frozen.
    readonly state: string;

    private constructor(readonly journal: User, row: Row) {
        this.jtalkid = int(row.jtalkid);
        this.nodetype = text(row.nodetype);
        this.nodeid = int(row.nodeid);
        this.parenttalkid = int(row.parenttalkid);
        this.posterid = int(row.posterid);
        this.state = text(row.state) || "A";
    }

    static async byJtalkid(db: Databases, journal: User, jtalkid: number): Promise<Comment | undefined> {
        if (!journal.clusterid) return undefined;
        const [row] = await journal.cluster(db, `SELECT jtalkid, nodetype, nodeid, parenttalkid, posterid, state
            FROM talk2 WHERE journalid = ? AND jtalkid = ?`, [journal.userid, jtalkid]);
        return row ? new Comment(journal, row) : undefined;
    }

    // LJ::Comment::is_active
    isActive(): boolean {
        return this.state === "A";
    }

    // LJ::Comment::is_screened
    isScreened(): boolean {
        return this.state === "S";
    }

    // LJ::Comment::is_deleted
    isDeleted(): boolean {
        return this.state === "D";
    }

    // LJ::Comment::is_frozen
    isFrozen(): boolean {
        return this.state === "F";
    }

    // LJ::Comment::entry
    entry(db: Databases): Promise<Entry | null> {
        return Entry.byJitemid(db, this.journal, this.nodeid);
    }

    // LJ::Comment::poster: undefined for an anonymous comment.
    async poster(db: Databases): Promise<User | undefined> {
        return this.posterid ? (await User.byIds(db, [this.posterid])).get(this.posterid) : undefined;
    }

    // LJ::Comment::parent
    parent(db: Databases): Promise<Comment | undefined> {
        return this.parenttalkid ? Comment.byJtalkid(db, this.journal, this.parenttalkid) : Promise.resolve(undefined);
    }

    // LJ::Comment::visible_to: whether `remote`, who must be logged in, may see
    // this comment. Screened comments are for the journal's managers, the
    // commenter, the entry's poster, and the parent comment's poster when a
    // manager wrote the reply. Deleted comments are left to the caller.
    async visibleTo(db: Databases, remote: User | null): Promise<boolean> {
        if (!remote) return false;
        const entry = await this.entry(db);
        if (!entry || !await entry.visibleTo(db, remote)) return false;
        const poster = await this.poster(db);
        if (this.isScreened()) {
            const parentPoster = await (await this.parent(db))?.poster(db);
            const allowed = await remote.canManage(db, this.journal)
                || remote.equals(poster)
                || remote.userid === entry.posterid
                || remote.equals(parentPoster) && !!poster && await poster.canManage(db, this.journal);
            if (!allowed) return false;
        }
        return !poster?.isSuspended();
    }
}

export interface CommentRow {
    readonly talkid: number;
    parenttalkid: number;
    readonly posterid: number;
    readonly datepost: string;
    readonly datepostUnix: number;
    readonly state: string;
}

const talkpropNames = new WeakMap<Databases, Promise<Map<number, string>>>();

export async function commentRows(db: Databases, journal: User, jitemid: number): Promise<Map<number, CommentRow>> {
    const rows = await journal.cluster(db,
        `SELECT jtalkid, parenttalkid, posterid, datepost, UNIX_TIMESTAMP(datepost) AS unixtime, state
         FROM talk2 WHERE journalid = ? AND nodetype = 'L' AND nodeid = ?`, [journal.userid, jitemid]);
    return new Map(rows.map(row => [int(row.jtalkid), {
        talkid: int(row.jtalkid), parenttalkid: int(row.parenttalkid), posterid: int(row.posterid),
        datepost: text(row.datepost), datepostUnix: int(row.unixtime), state: text(row.state) || "A",
    }]));
}

// Subjects and bodies, or only subjects, by talkid.
export async function commentTexts(db: Databases, journal: User, ids: readonly number[],
    subjectsOnly = false): Promise<Map<number, { subject: string; body: string }>> {
    if (!ids.length) return new Map();
    const rows = await journal.cluster(db,
        `SELECT jtalkid, subject${subjectsOnly ? "" : ", body"} FROM talktext2 WHERE journalid = ? AND jtalkid IN (?)`,
        [journal.userid, ids]);
    return new Map(rows.map(row => [int(row.jtalkid), { subject: text(row.subject), body: text(row.body) }]));
}

export async function commentProps(db: Databases, journal: User,
    ids: readonly number[]): Promise<Map<number, Record<string, string>>> {
    const props = new Map<number, Record<string, string>>();
    if (!ids.length) return props;
    let names = talkpropNames.get(db);
    if (!names) {
        names = db.global("SELECT tpropid, name FROM talkproplist")
            .then(rows => new Map(rows.map(row => [int(row.tpropid), text(row.name)])));
        talkpropNames.set(db, names);
    }
    const [rows, byId] = await Promise.all([
        journal.cluster(db, "SELECT jtalkid, tpropid, value FROM talkprop2 WHERE journalid = ? AND jtalkid IN (?)",
            [journal.userid, ids]),
        names,
    ]);
    for (const row of rows) {
        const name = byId.get(int(row.tpropid));
        if (!name) continue;
        const id = int(row.jtalkid);
        props.set(id, { ...props.get(id), [name]: text(row.value) });
    }
    return props;
}
