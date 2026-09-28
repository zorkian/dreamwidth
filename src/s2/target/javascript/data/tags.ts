// tags.ts
//
// A journal's tags, as LJ::Tags::get_usertags returns them for a
// logged-out viewer.
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

export interface UserTag {
    readonly kwid: number;
    readonly name: string;
    readonly display: boolean;
    // Uses on public entries, from logkwsum.
    readonly publicUses: number;
}

// Tags used on at least one public entry; get_usertags drops the rest for
// a viewer with no access.
export async function publicTags(db: Databases, journal: User): Promise<UserTag[]> {
    const rows = await journal.cluster(db,
        `SELECT t.kwid, k.keyword, t.display, SUM(s.entryct) AS uses FROM usertags t
         JOIN userkeywords k ON k.userid = t.journalid AND k.kwid = t.kwid
         JOIN logkwsum s ON s.journalid = t.journalid AND s.kwid = t.kwid AND s.security & (1 << 63)
         WHERE t.journalid = ? GROUP BY t.kwid, k.keyword, t.display`, [journal.userid]);
    return rows.map(row => ({
        kwid: int(row.kwid), name: text(row.keyword), display: int(row.display) !== 0, publicUses: int(row.uses),
    }));
}

// LJ::Tags::is_valid_tagstring: the canonical tags in a filter, or undefined
// if any is invalid.
export function parseTagFilter(filter: string): string[] | undefined {
    const tags = filter.split(/\s*,\s*/).map(tag => tag.trim()).filter(Boolean)
        .map(tag => canonicalTag(tag));
    if (!tags.length || tags.some(tag => !tag || /[<>\r\n\t]/.test(tag))) return undefined;
    return tags;
}

// LJ::Tags::canonical_tag: at most 40 characters and 80 UTF-8 bytes.
function canonicalTag(tag: string): string {
    let bytes = 0;
    const kept: string[] = [];
    for (const char of Array.from(tag.replace(/\s+/g, " ").trim()).slice(0, 40)) {
        bytes += Buffer.byteLength(char);
        if (bytes > 80) break;
        kept.push(char);
    }
    return kept.join("").trim().toLowerCase();
}
