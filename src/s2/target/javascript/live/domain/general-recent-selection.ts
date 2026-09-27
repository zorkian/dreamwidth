// general-recent-selection.ts
//
// Named parent projection of source-counted Recent headers and public Entry descriptors.
//
// Portions adapted from LJ::S2 object constructors, forked from the
// LiveJournal project owned and operated by Live Journal, Inc., and modified
// and expanded by Dreamwidth Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, this code and its modifications are provided
// under the GNU General Public License. See LICENSE in this distribution.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//

// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.
// The inherited notice above applies to adapted LiveJournal portions.
//

import type {NativeSelectedSnapshot,RawEntry} from "../contracts";
import {NativeString} from "../../runtime/native-string";

export interface GeneralRecentSourceSelection<T> {
    readonly skip:number;readonly itemshow:number;readonly maxskip:number;
    readonly hasLookahead:boolean;readonly showStickies:boolean;
    readonly stickyEntries:readonly T[];
    readonly window:readonly {readonly entry:T|undefined;readonly datePrefix:NativeString;
        readonly countedSticky:boolean}[];
}
/** Parent supplies named public descriptors; original byte/property bags stay here. */
export function projectGeneralRecentSelection<T>(snapshot:NativeSelectedSnapshot,
    project:(entry:RawEntry)=>T):GeneralRecentSourceSelection<T> {
    const selection=snapshot.facts.selection,recent=snapshot.recentSelection;
    if(selection.kind!=="recent"||!recent)throw Error("Missing source-counted Recent selection");
    const count=snapshot.stickyEntryCount??0;
    const sticky=snapshot.facts.entries.slice(0,count);
    const normal=new Map(snapshot.facts.entries.slice(count).map(entry=>[entry.jitemid,entry]));
    if(recent.window.length!==selection.selectedJitemids.length||recent.window.some((cell,index)=>
        cell.jitemid!==selection.selectedJitemids[index]))throw Error("Inconsistent Recent window projection");
    return Object.freeze({skip:selection.pageSkip,itemshow:selection.itemshow,maxskip:selection.maxScrollback-selection.itemshow,
        hasLookahead:selection.window.length>selection.itemshow,showStickies:recent.showStickies,
        stickyEntries:Object.freeze(sticky.map(project)),window:Object.freeze(recent.window.map(cell=>Object.freeze({
            entry:normal.has(cell.jitemid)?project(normal.get(cell.jitemid)!):undefined,
            datePrefix:NativeString.bytes(Buffer.from(cell.eventtime.slice(0,10).replace(/-/g," "),"ascii")),
            countedSticky:cell.countedSticky})))});
}
