// moods.ts
//
// Selected native mood names, inherited theme icons and URL preparation.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.
//

// Source ports: cgi-bin/DW/Mood.pm and cgi-bin/LJ/Entry.pm. Those files
// were forked from LiveJournal, owned and operated by Live Journal, Inc., and
// modified by Dreamwidth Studios, LLC. The inherited license can be found at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// These ports and modifications are provided under the GNU General Public
// License. See the LICENSE file included with this distribution.

import type {RawMoods, PublicAppConfig} from "../contracts";
import {SnapshotError} from "../data/errors";
export function moodSelection(raw: RawMoods, id: number, config: PublicAppConfig):
    {name:string; icon?:{url:string;width:number;height:number}} {
    const fail = (): never => {throw new SnapshotError("unsupported");};
    if (!raw || raw.moods.length > 10000 || raw.pictures.length > 10000) fail();
    if (raw.theme && (!Number.isInteger(raw.theme.id) || raw.theme.id<=0 || raw.theme.id>4294967295 ||
        (raw.theme.name!==null&&typeof raw.theme.name!=="string"))) fail();
    const uint = (value:number):boolean => Number.isInteger(value)&&value>=0&&value<=4294967295;
    if (!uint(id) || raw.moods.some(row=>!uint(row.id)||!row.id||!uint(row.parent)||
        (row.name!==null&&typeof row.name!=="string")) || raw.pictures.some(row=>!uint(row.moodid)||
        (row.url!==null&&typeof row.url!=="string"))) fail();
    const moods = new Map(raw.moods.map(row=>[row.id,row]));
    const pictures = new Map(raw.pictures.map(row=>[row.moodid,row]));
    if (moods.size !== raw.moods.length || pictures.size !== raw.pictures.length) fail();
    const name = moods.get(id)?.name ?? "";
    // Numeric names are native vocabulary text, not clean_subject input. Reject
    // malformed active markup rather than silently change that distinct path.
    if (Buffer.byteLength(name)>1024 || /[<>\x00-\x1f\x7f]/.test(name)) fail();
    if (!raw.theme?.name || raw.theme.name === "0") return {name};
    const seen = new Set<number>();
    while (id) {
        if (seen.has(id) || seen.size >= 10000) fail();
        seen.add(id);
        const picture = pictures.get(id);
        if (picture) {
            let url = picture.url ?? "";
            if (url.startsWith("/")) url = config.imgPrefix + url.replace(/^\/img/, "");
            if (!/^https?:\/\/[^'"\x00\s]+$/.test(url)) url = "#invalid";
            const domain = /^http:\/\/[^/]*?([^.]+\.\w{2,3})\//.exec(url)?.[1];
            if (domain && (domain === config.entryContent.urls.siteDomain ||
                config.entryContent.urls.knownHttpsSites.includes(domain))) url = url.replace(/^http:/,"https:");
            if (![picture.width,picture.height].every(value=>Number.isInteger(value)&&value>=0&&value<=255)) fail();
            return {name,icon:{url,width:picture.width,height:picture.height}};
        }
        id = moods.get(id)?.parent ?? 0;
    }
    return {name};
}
