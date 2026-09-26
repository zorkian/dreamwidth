// userpics.ts
//
// Owner-scoped native userpic keyword, redirect and fallback selection.
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

// Source ports: cgi-bin/LJ/User/Icons.pm and cgi-bin/LJ/Entry.pm. Those files
// were forked from LiveJournal, owned and operated by Live Journal, Inc., and
// modified by Dreamwidth Studios, LLC. The inherited license can be found at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// These ports and modifications are provided under the GNU General Public
// License. See the LICENSE file included with this distribution.

import type {RawUserpics} from "../contracts";
import type {ApprovedUserpic} from "../render/types";
import {SnapshotError} from "../data/errors";

export const USERPIC_ROW_LIMIT = 10000;

export class UserpicSelection {
    private readonly pictures = new Map<number, RawUserpics["pictures"][number]>();
    private readonly keywords = new Map<string, number>();
    private readonly mapKeywords = new Map<number, string>();
    private readonly redirects = new Map<number, number>();

    constructor(raw: RawUserpics, private readonly owner: number,
        private readonly defaultId: number, private readonly dversion: number) {
        const fail = (): never => {throw new SnapshotError("unsupported");};
        const uint = (value: number): boolean => Number.isInteger(value) && value >= 0 && value <= 4294967295;
        if (!raw || raw.pictures.length > USERPIC_ROW_LIMIT || raw.mappings.length > USERPIC_ROW_LIMIT ||
            !uint(defaultId)) fail();
        for (const picture of raw.pictures) {
            if (picture.userid !== owner || !uint(picture.picid) || !picture.picid ||
                this.pictures.has(picture.picid) || !uint(picture.width) || !uint(picture.height) ||
                picture.width > 65535 || picture.height > 65535 ||
                typeof picture.state !== "string" || picture.state.length !== 1 ||
                typeof picture.description !== "string" || Buffer.byteLength(picture.description) > 4096 ||
                /[\x00]/.test(picture.description)) fail();
            this.pictures.set(picture.picid, picture);
        }
        const mapIds = new Set<number>();
        for (const mapping of raw.mappings) {
            for (const id of [mapping.mapid, mapping.picid, mapping.redirectMapid]) {
                if (id !== null && !uint(id)) fail();
            }
            if (mapping.keyword !== null && typeof mapping.keyword !== "string") fail();
            const keyword = mapping.keyword;
            // Native skips these malformed keyword rows before creating redirects.
            if (keyword !== null && (keyword === "" || /[\r\n\x00]/.test(keyword))) continue;
            if (dversion >= 9) {
                if (!mapping.mapid || mapIds.has(mapping.mapid)) fail();
                mapIds.add(mapping.mapid!);
                if (mapping.redirectMapid) {
                    this.redirects.set(mapping.mapid!, mapping.redirectMapid);
                } else {
                    this.mapKeywords.set(mapping.mapid!, keyword ?? "pic#" + (mapping.picid ?? ""));
                }
            }
            const picture = mapping.picid && this.pictures.get(mapping.picid);
            if (!picture || picture.state === "X" || picture.state === "S" || keyword === null) continue;
            if (this.keywords.has(keyword) && this.keywords.get(keyword) !== picture.picid) fail();
            this.keywords.set(keyword, picture.picid);
        }
    }

    defaultPicture(): ApprovedUserpic | null { return this.picture(this.defaultId, null); }

    forEntry(props: Readonly<Record<string, string | null>>): ApprovedUserpic | null {
        let keyword: string | null = null;
        if (this.dversion >= 9) {
            const value = props.picture_mapid;
            if (value && value !== "0") {
                if (!/^[0-9]+$/.test(value) || Number(value) > 4294967295) throw new SnapshotError("unsupported");
                // Native map hash lookup preserves spelling; an uncanonical decimal
                // key such as 01 does not address mapid1.
                let id = String(Number(value)) === value ? Number(value) : 0;
                const seen = new Set<number>([id]);
                while (this.redirects.has(id)) {
                    id = this.redirects.get(id)!;
                    if (seen.has(id)) {id = 0; break;}
                    seen.add(id);
                }
                keyword = this.mapKeywords.get(id) ?? null;
            }
        } else {
            keyword = props.picture_keyword ?? null;
        }
        let picid = keyword === null ? this.defaultId : this.keywords.get(keyword) ?? 0;
        if (!picid && keyword !== null) {
            const match = /^pic#([0-9]+)$/.exec(keyword);
            const picture = match && String(Number(match[1])) === match[1] &&
                this.pictures.get(Number(match[1]));
            if (picture && picture.state !== "X" && picture.state !== "S") picid = picture.picid;
        }
        return this.picture(picid || this.defaultId, keyword);
    }

    private picture(id: number, keyword: string | null): ApprovedUserpic | null {
        if (!id) return null;
        const row = this.pictures.get(id);
        // Native constructs a skeleton even for a missing default row. Its
        // dimensions become empty/zero; its URL and default label still exist.
        return {picid: id, width: row?.width ?? 0, height: row?.height ?? 0,
            description: row?.description ?? "", keyword};
    }
}
