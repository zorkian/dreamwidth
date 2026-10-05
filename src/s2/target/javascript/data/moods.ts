// moods.ts
//
// Mood names and mood theme pictures, as DW::Mood provides them.
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
import { type Databases, int, text } from "./db";

export interface MoodPicture {
    readonly url: string;
    readonly width: number;
    readonly height: number;
}

interface MoodRow {
    readonly name: string;
    readonly parent: number;
}

const moodTables = new WeakMap<Databases, Promise<Map<number, MoodRow>>>();

export class Moods {
    private constructor(
        private readonly moods: Map<number, MoodRow>,
        private readonly pictures: Map<string, MoodPicture>,
    ) {}

    static async load(db: Databases, themeIds: readonly number[]): Promise<Moods> {
        let moods = moodTables.get(db);
        if (!moods) {
            moods = db.global("SELECT moodid, mood, parentmood FROM moods").then(rows =>
                new Map(rows.map(row => [int(row.moodid), { name: text(row.mood), parent: int(row.parentmood) }])));
            moodTables.set(db, moods);
        }
        const ids = themeIds.filter(Boolean);
        const rows = ids.length
            ? await db.global("SELECT moodthemeid, moodid, picurl, width, height FROM moodthemedata WHERE moodthemeid IN (?)", [ids])
            : [];
        return new Moods(await moods, new Map(rows.map(row => [`${int(row.moodthemeid)}:${int(row.moodid)}`,
            { url: text(row.picurl), width: int(row.width), height: int(row.height) }])));
    }

    name(moodid: number): string {
        return this.moods.get(moodid)?.name ?? "";
    }

    // DW::Mood::get_picture: a mood without its own picture uses its parent's.
    picture(config: SiteConfig, themeid: number, moodid: number): MoodPicture | undefined {
        const seen = new Set<number>();
        while (moodid && !seen.has(moodid)) {
            seen.add(moodid);
            const picture = this.pictures.get(`${themeid}:${moodid}`);
            if (picture) {
                let url = picture.url;
                if (url.startsWith("/")) url = config.imgPrefix + url.replace(/^\/img/, "");
                if (!/^https?:\/\/[^'"\0\s]+$/.test(url)) url = "#invalid";
                return { ...picture, url };
            }
            moodid = this.moods.get(moodid)?.parent ?? 0;
        }
        return undefined;
    }
}
