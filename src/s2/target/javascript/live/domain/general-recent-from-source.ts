// general-recent-from-source.ts
//
// Native Recent graph preparation from authorized window and installed Page helpers.
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

import {runtime} from "../../runtime/s2runtime";
import {NativeString,scalarPV} from "../../runtime/native-scalar";
import {concatStrings} from "../../runtime/native-string";
import {generalLink,type GeneralModel} from "./general-model-primitives";

export interface GeneralRecentWindowItem<T=GeneralModel> {
    // An absent prepared entry means a source visibility check skipped it.
    // It still contributes to the source pagination count.
    readonly entry:T|undefined;
    readonly datePrefix:NativeString;
    readonly countedSticky:boolean;
}
export interface GeneralRecentInput<T=GeneralModel> {
    readonly page:GeneralModel;
    readonly skip:number;readonly itemshow:number;readonly maxskip:number;
    readonly hasLookahead:boolean;
    readonly showStickies:boolean;
    readonly stickyEntries:readonly T[];
    readonly window:readonly GeneralRecentWindowItem<T>[];
    readonly filterActive:unknown;readonly filterName:NativeString;readonly filterTags:unknown;
    // Source head helpers run before the selection/entry loop. This is their
    // complete prepared contribution, not stored HTML authorized by this model.
    readonly selectionHead:NativeString;
    readonly feedTagQuery:NativeString;
    // Values already prepared by source eurl/style/mode/poster semantics.
    readonly linkAttributes:readonly (readonly [NativeString,NativeString])[];
}
export interface GeneralRecentOperations {
    standardImage(kind:"rss"|"atom"|"sticky-entry"):GeneralModel;
    makeLink(url:NativeString,values:readonly (readonly [NativeString,unknown])[]):NativeString;
    eventDisplayed(entry:GeneralModel):void;
}
const pv=NativeString.hostUtf8Bytes;
const add=(left:unknown,right:unknown)=>concatStrings(scalarPV(left),scalarPV(right));
/** No SQL or content callbacks here: only authorized prepared Entry references. */
export function generalRecentFromSource(input:GeneralRecentInput,operations:GeneralRecentOperations):GeneralModel {
    return prepareGeneralRecentFromSource(input,{...operations,prepareEntry:entry=>entry});
}
export interface GeneralRecentPreparationOperations<T> extends GeneralRecentOperations {
    /** Installed Entry_from_entryobj operation, never a callback from IPC. */
    prepareEntry(input:T):GeneralModel;
}
/** Prepare entries in native source order, interleaved with display notification. */
export function prepareGeneralRecentFromSource<T>(input:GeneralRecentInput<T>,
    operations:GeneralRecentPreparationOperations<T>):GeneralModel {
    const page=input.page;
    page[".type"]="RecentPage";page._view=pv("recent");page._entries=[];
    page._filter_active=input.filterActive;page._filter_name=input.filterName;page._filter_tags=input.filterTags;
    page._head_content=add(page._head_content,input.selectionHead);
    page._data_link=runtime.makeHash(["rss","atom"].map(kind=>[pv(kind),generalLink(
        add(add(page._base_url,pv("/data/"+kind)),input.feedTagQuery),pv(kind==="rss"?"RSS":"Atom"),
        operations.standardImage(kind as "rss"|"atom"))]));
    page._data_links_order=[pv("rss"),pv("atom")];
    const entries=page._entries as GeneralModel[];
    if(input.showStickies)for(const source of input.stickyEntries) {
        const entry=operations.prepareEntry(source);
        entry[".type"]="StickyEntry";entry._sticky_entry_icon=operations.standardImage("sticky-entry");entries.push(entry);
    }
    let lastdate=pv(""),itemnum=0;
    for(const item of input.window) {
        itemnum++;
        if(input.showStickies&&item.countedSticky||item.entry===undefined)continue;
        const entry=operations.prepareEntry(item.entry);
        // RecentPage.pm assigns $lastentry to the CURRENT entry before the
        // day comparison. Preserve that source behavior, not an inferred fix.
        const changed=!runtime.scalarCompare("string","==",item.datePrefix,lastdate);
        if(changed){lastdate=item.datePrefix;entry._end_day=1;}
        entry._new_day=changed?1:0;entries.push(entry);operations.eventDisplayed(entry);
    }
    if(entries.length)entries[entries.length-1]!._end_day=1;
    const nav:GeneralModel={".type":"RecentNav",_version:1,_skip:input.skip,_count:itemnum};
    const link=(skip:number)=>operations.makeLink(add(page._base_url,pv("/")),
        [[pv("skip"),skip||pv("")],...input.linkAttributes]);
    if(input.skip) {
        const next=Math.max(0,input.skip-input.itemshow);
        nav._forward_skip=next;nav._forward_url=link(next);nav._forward_count=input.itemshow;
        page._head_content=add(page._head_content,add(add(pv('<link rel="next" href="'),nav._forward_url),pv('" />\n')));
    }
    if(itemnum===input.itemshow) {
        nav._backward_count=input.itemshow;
        if(input.skip===input.maxskip)nav._backward_url=add(add(page._base_url,pv("/")),
            NativeString.fromFrame({bytes:Buffer.from(lastdate.bytes().toString("latin1").replace(/ /g,"/"),"latin1"),utf8:lastdate.flagged()}));
        else if(input.hasLookahead){nav._backward_skip=input.skip+input.itemshow;nav._backward_url=link(input.skip+input.itemshow);}
        page._head_content=add(page._head_content,add(add(pv('<link rel="prev" href="'),nav._backward_url),pv('" />\n')));
    }
    page._nav=nav;return page;
}
