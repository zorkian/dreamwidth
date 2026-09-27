// general-page-assembly.ts
//
// Installed same-Context Page and selected Entry preparation in source order.
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
// Semantic ports from LJ/S2/EntryPage.pm, originally forked from LiveJournal,
// owned and operated by Live Journal, Inc., and modified by Dreamwidth Studios,
// LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, adapted portions and their modifications
// are provided under the GNU General Public License. See LICENSE.
//

import type {Context} from "../../runtime/s2runtime";
import {generalPage,type GeneralPageInput,type GeneralPageOperations} from "./general-page-model";
import {generalEntryFromSource,type GeneralEntrySourceInput,
    type GeneralEntrySourceOperations} from "./general-entry-from-source";
import {prepareGeneralRecentFromSource,type GeneralRecentInput,
    type GeneralRecentOperations} from "./general-recent-from-source";
import type {GeneralRecentSourceSelection} from "./general-recent-selection";
import type {GeneralModel} from "./general-model-primitives";
import type {GeneralCommentNavigation} from "./general-comment-navigation";
import {NativeString,scalarNumber,scalarPV,scalarTruthy} from "../../runtime/native-scalar";
import {arithmetic,intCast,numericCompare} from "../../runtime/native-number";
import {concatStrings} from "../../runtime/native-string";
import {generalEntryPageEntryFromSource,type GeneralEntryPageEntryInput,
    type GeneralEntryPageEntryOperations} from "./general-entry-page-source";

export interface GeneralRecentPageSourceInput {
    readonly page:GeneralPageInput;
    readonly selection:GeneralRecentSourceSelection<GeneralEntrySourceInput>;
    readonly navigation:Pick<GeneralRecentInput,"filterActive"|"filterName"|"filterTags"|
        "selectionHead"|"feedTagQuery"|"linkAttributes">;
}
export interface GeneralRecentPageOperations {
    readonly page:GeneralPageOperations;
    readonly recent:GeneralRecentOperations;
    entry(input:GeneralEntrySourceInput):GeneralEntrySourceOperations;
}

/**
 * The parent projects only authorized named public descriptors. Cleaner and
 * helper implementations remain installed child code, not IPC values. Page
 * cleaning is mandatory; it is not replaced by final output streaming.
 */
export function generalRecentPageFromSource(context:Context,input:GeneralRecentPageSourceInput,
    operations:GeneralRecentPageOperations):GeneralModel {
    const page=generalPage(input.page,operations.page);
    return prepareGeneralRecentFromSource({...input.selection,...input.navigation,page},{
        ...operations.recent,
        prepareEntry:source=>generalEntryFromSource(context,source,operations.entry(source)),
    });
}

export interface GeneralEntryCommentNavigationInput {
    readonly permalink:NativeString;
    readonly styledEntryUrl:NativeString;
    readonly styleArgument:NativeString|undefined;
    readonly flat:boolean;
    readonly topOnly:boolean;
    readonly pages:unknown;
    readonly current:unknown;
    readonly items:unknown;
    readonly first:unknown;
    readonly last:unknown;
    readonly comments:readonly GeneralModel[];
    readonly noPosts:boolean;
    readonly expandAll:unknown;
}

/** EntryPage.pm534-587. Use the same factory whose callbacks enter the Context. */
export function attachGeneralEntryCommentNavigation(page:GeneralModel,
    input:GeneralEntryCommentNavigationInput,navigation:GeneralCommentNavigation):void {
    const empty=input.noPosts||input.comments.length===0;
    const pages=empty?1:input.pages,current=empty?1:input.current;
    const pv=NativeString.hostUtf8Bytes;
    const mode=input.flat?"flat":input.topOnly?"top-only":"threaded";
    page._comment_nav=navigation.commentNav({_view_mode:pv(mode),
        _url:input.styledEntryUrl,_current_page:current,_show_expand_all:input.expandAll});
    page._comment_pages=navigation.itemRange({
        _all_subitems_displayed:numericCompare(scalarNumber(pages),scalarNumber(1))===0,
        _current:current,_from_subitem:empty?undefined:input.first,
        _num_subitems_displayed:input.comments.length,_to_subitem:empty?undefined:input.last,
        _total:pages,_total_subitems:empty?0:input.items,
    },n=>{
        let url=concatStrings(input.permalink,pv("?"+
            (input.flat?"view=flat&":input.topOnly?"view=top-only&":"")+"page="));
        url=concatStrings(url,scalarPV(intCast(scalarNumber(n))));
        if(scalarTruthy(input.styleArgument))url=concatStrings(concatStrings(url,pv("&")),input.styleArgument!);
        return url;
    });
}

export interface GeneralEntryPageSourceInput {
    readonly page:GeneralPageInput;
    readonly entry:GeneralEntryPageEntryInput;
    readonly thread:unknown;
}
export interface GeneralEntryPageOperations {
    readonly page:GeneralPageOperations;
    readonly entry:GeneralEntryPageEntryOperations;
    readonly navigation:GeneralCommentNavigation;
    /** Independent original-source OG/head helpers and native public event notification. */
    prepareHead(page:GeneralModel,entry:GeneralModel):void;
    /** Only called when the approved Entry's native comments.enabled is true. */
    comments(page:GeneralModel,entry:GeneralModel):GeneralEntryCommentNavigationInput;
    /** Native empty navigation still needs the validated permalink/style options. */
    emptyComments(page:GeneralModel,entry:GeneralModel):Omit<GeneralEntryCommentNavigationInput,
        "comments"|"noPosts">;
    /** LJ_cmtinfo/need_res contribution runs even when comment loading is disabled. */
    prepareCommentHead(page:GeneralModel,entry:GeneralModel):void;
}

/** Same admitted Context, with disabled comments gated before any comment helper reads. */
export function generalEntryPageFromSource(context:Context,input:GeneralEntryPageSourceInput,
    operations:GeneralEntryPageOperations):GeneralModel {
    const page=generalPage(input.page,operations.page);
    page[".type"]="EntryPage";page._view=NativeString.hostUtf8Bytes("entry");
    page._comment_pages=undefined;page._comment_navbar=undefined;page._comments=[];
    const entry=generalEntryPageEntryFromSource(context,input.entry,operations.entry);
    page._entry=entry;page._multiform_on=0;
    page._viewing_thread=scalarTruthy(input.thread)?1:0;
    page._viewing_thread_id=scalarTruthy(input.thread)?
        arithmetic("+",scalarNumber(input.thread),scalarNumber(0)):scalarNumber(0);
    operations.prepareHead(page,entry);
    const comments=entry._comments as GeneralModel;
    const selected:GeneralEntryCommentNavigationInput=scalarTruthy(comments._enabled)?
        operations.comments(page,entry):
        {...operations.emptyComments(page,entry),comments:[],noPosts:true};
    page._comments=selected.comments;
    operations.prepareCommentHead(page,entry);
    attachGeneralEntryCommentNavigation(page,selected,operations.navigation);
    return page;
}
