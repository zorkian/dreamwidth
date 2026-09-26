// links.ts
//
// Owner-scoped flat link ordering and stored navigation approval.
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

// Source ports: cgi-bin/LJ/Links.pm and cgi-bin/LJ/S2.pm. Those files
// were forked from LiveJournal, owned and operated by Live Journal, Inc., and
// modified by Dreamwidth Studios, LLC. The inherited license can be found at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// These ports and modifications are provided under the GNU General Public
// License. See the LICENSE file included with this distribution.

import type {RawLink} from "../contracts";
import type {ApprovedLink} from "../render/types";
import {SnapshotError} from "../data/errors";

export function navigationUrl(value: string): string {
    // Stored links are not save-time canonicalized again. Reject active/control
    // destinations explicitly instead of reproducing the native data URL gap.
    if (Buffer.byteLength(value,"utf8") > 4096 || /[\s\x00-\x1f\x7f]/.test(value) ||
        /(?:(?:java|vb)script|about):/i.test(value) ||
        /^(?:data|blob|file|filesystem):/i.test(value)) throw new SnapshotError("unsupported");
    return value;
}

export function websiteName(value: string): string {
    if (Buffer.byteLength(value,"utf8")>4096 || /[\x00-\x1f\x7f]/.test(value)) throw new SnapshotError("unsupported");
    return value;
}

export function approveLinks(rows: readonly RawLink[]): readonly ApprovedLink[] {
    if (rows.length > 10000) throw new SnapshotError("unsupported");
    return rows.map((row,index)=>({row,index})).sort((a,b)=>a.row.ordernum-b.row.ordernum || a.index-b.index)
        .map(({row})=>{
            if (!Number.isInteger(row.ordernum) || row.ordernum<0 || row.ordernum>255 ||
                !Number.isInteger(row.parentnum) || row.parentnum<0 || row.parentnum>255 ||
                [row.title,row.hover ?? ""].some(value=>Buffer.byteLength(value,"utf8")>4096 || /[\x00-\x1f\x7f]/.test(value))) {
                throw new SnapshotError("unsupported");
            }
            const url=row.url ?? "", hover=row.hover ?? "";
            if (/((?:java|vb)script|about):/i.test(hover.replace(/\s/g,""))) throw new SnapshotError("unsupported");
            return {title:row.title==="-"?"":row.title,url:navigationUrl(url),hover,
                isHeading:url==="" || url==="0"};
        });
}
