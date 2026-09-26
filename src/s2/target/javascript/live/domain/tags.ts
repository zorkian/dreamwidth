// tags.ts
//
// Owner taxonomy projection for anonymous sidebar and selected public entries.
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

// Source ports: cgi-bin/LJ/Tags.pm and cgi-bin/LJ/S2.pm. Those files
// were forked from LiveJournal, owned and operated by Live Journal, Inc., and
// modified by Dreamwidth Studios, LLC. The inherited license can be found at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// These ports and modifications are provided under the GNU General Public
// License. See the LICENSE file included with this distribution.

import type {RawTags} from "../contracts";
import type {ApprovedTag,ApprovedTagDetail} from "../render/types";
import {SnapshotError} from "../data/errors";

export function approveTags(raw: RawTags, selected: readonly number[], enabled: boolean): {
    sidebar: readonly ApprovedTagDetail[]; entries: ReadonlyMap<number,readonly ApprovedTag[]>;
} {
    const fail = ():never=>{throw new SnapshotError("unsupported");};
    if ([raw.definitions,raw.summaries,raw.associations].some(rows=>rows.length>10000)) fail();
    const names=new Map<number,RawTags["definitions"][number]>();
    for(const row of raw.definitions){
        if(!Number.isSafeInteger(row.kwid)||row.kwid<=0||names.has(row.kwid)||
            typeof row.display!=="boolean"||Buffer.byteLength(row.name)>4096||/[\x00-\x1f\x7f]/.test(row.name))fail();
        names.set(row.kwid,row);
    }
    const counts=new Map<number,number>(), publicIds=new Set<number>(), masks=new Set<string>();
    for(const row of raw.summaries){
        if(!/^(0|[1-9][0-9]{0,19})$/.test(row.security)||BigInt(row.security)>18446744073709551615n||
            !Number.isSafeInteger(row.count)||row.count<0||row.count>4294967295)fail();
        const key=row.kwid+":"+row.security;if(masks.has(key))fail();masks.add(key);
        // Presence of bit63 authorizes sidebar visibility even when count=0.
        if((BigInt(row.security)&(1n<<63n))!==0n){
            publicIds.add(row.kwid);const sum=(counts.get(row.kwid)??0)+row.count;
            if(!Number.isSafeInteger(sum))fail();counts.set(row.kwid,sum);
        }
    }
    const entries=new Map<number,ApprovedTag[]>(), tuples=new Set<string>();
    for(const id of selected)entries.set(id,[]);
    for(const row of raw.associations){
        const key=row.jitemid+":"+row.kwid;
        const target=entries.get(row.jitemid), definition=names.get(row.kwid);
        if(!target||!definition||tuples.has(key))fail();tuples.add(key);
        // get_logtagsmulti uses the unfiltered taxonomy: no display/count gate.
        if(enabled){if(!definition!.name||definition!.name==="0")fail();
            target!.push({id:row.kwid,name:definition!.name});}
    }
    // False native names produce a TagDetail with an undefined URL. Refuse
    // that malformed displayed result rather than invent a /tag/0 endpoint.
    if(enabled&&raw.definitions.some(row=>row.display&&publicIds.has(row.kwid)&&(!row.name||row.name==="0")))fail();
    return {entries,sidebar:enabled?raw.definitions.filter(row=>row.display&&publicIds.has(row.kwid))
        .map(row=>({id:row.kwid,name:row.name,count:counts.get(row.kwid)??0})):[]};
}
