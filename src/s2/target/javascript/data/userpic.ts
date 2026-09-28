// userpic.ts
//
// A user's icons and their keywords, as LJ::Userpic and LJ::User::Icons
// load them.
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

export interface Userpic {
    readonly picid: number;
    readonly width: number;
    readonly height: number;
    readonly description: string;
    readonly comment: string;
    // N for active, I for inactive.
    readonly state: string;
    // Sorted without regard to case.
    readonly keywords: readonly string[];
}

export class Userpics {
    private constructor(
        readonly user: User,
        private readonly pics: Map<number, Userpic>,
        private readonly byKeyword: Map<string, number>,
        private readonly keywordByMapid: Map<number, string>,
    ) {}

    static async load(db: Databases, user: User): Promise<Userpics> {
        const [pics, maps] = await Promise.all([
            user.cluster(db, `SELECT picid, width, height, description, comment, state FROM userpic2
                WHERE userid = ? AND state <> 'X'`, [user.userid]),
            user.cluster(db, `SELECT m.mapid, m.picid, m.redirect_mapid, k.keyword FROM userpicmap3 m
                LEFT JOIN userkeywords k ON k.userid = m.userid AND k.kwid = m.kwid WHERE m.userid = ?`, [user.userid]),
        ]);
        const byKeyword = new Map<string, number>();
        const keywords = new Map<number, string[]>();
        const keywordByMapid = new Map<number, string>();
        const rows = new Map(maps.map(row => [int(row.mapid), row]));
        for (const row of maps) {
            const keyword = row.keyword === null ? undefined : text(row.keyword);
            if (keyword !== undefined && int(row.picid)) {
                byKeyword.set(keyword, int(row.picid));
                keywords.set(int(row.picid), [...keywords.get(int(row.picid)) ?? [], keyword]);
            }
        }
        for (const [mapid, row] of rows) {
            // A renamed keyword's mapping redirects to its replacement.
            const target = int(row.redirect_mapid) ? rows.get(int(row.redirect_mapid)) : row;
            if (target && target.keyword !== null) keywordByMapid.set(mapid, text(target.keyword));
        }
        const byCase = (a: string, b: string) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
        return new Userpics(user, new Map(pics.map(row => [int(row.picid), {
            picid: int(row.picid), width: int(row.width), height: int(row.height), description: text(row.description),
            comment: text(row.comment), state: text(row.state), keywords: (keywords.get(int(row.picid)) ?? []).sort(byCase),
        }])), byKeyword, keywordByMapid);
    }

    // In picid order.
    all(): Userpic[] {
        return [...this.pics.values()].sort((a, b) => a.picid - b.picid);
    }

    get(picid: number): Userpic | undefined {
        return this.pics.get(picid);
    }

    // LJ::User::get_picid_from_keyword
    picidFromKeyword(keyword: string | undefined): number {
        const fallback = this.user.defaultpicid;
        if (keyword === undefined) return fallback;
        const picid = this.byKeyword.get(keyword);
        if (picid) return picid;
        const numbered = /^pic#(\d+)$/.exec(keyword);
        return numbered && this.pics.has(int(numbered[1])) ? int(numbered[1]) : fallback;
    }

    keywordFromMapid(mapid: number): string | undefined {
        return this.keywordByMapid.get(mapid);
    }
}
