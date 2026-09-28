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

import { type Databases, int, text } from "./db";
import type { User } from "./user";

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
