// general-comment-from-source.ts
//
// Native approved Comment projection with explicit original-comment cleaning.
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

import {runtime,type Context} from "../../runtime/s2runtime";
import {NativeString,scalarPV,scalarTruthy,scalarNumber} from "../../runtime/native-scalar";
import {arithmetic} from "../../runtime/native-number";
import {concatStrings} from "../../runtime/native-string";
import {escapeNativeHtml} from "../render/general-diagnostics";
import {quoteGeneralEntryHtml} from "./general-entry-content";
import type {GeneralModel} from "./general-model-primitives";

const pv=NativeString.hostUtf8Bytes;
interface CommentCommon {
    readonly talkid:unknown;readonly ditemid:unknown;readonly depth:unknown;
    readonly journal:GeneralModel;readonly datepostUnix:unknown;readonly entryLogtimeUnix:unknown;
    readonly permalinkUrl:NativeString;readonly replyUrl:NativeString;
    readonly parentUrl:NativeString|undefined;readonly threadrootUrl:NativeString|undefined;
    readonly expandUrl:NativeString;readonly jsExpandUrl:NativeString;
    readonly hasChildren:boolean;readonly showableChildren:unknown;readonly hideChildren:unknown;
    readonly hiddenChild:unknown;readonly echi:unknown;
    readonly lastTalkid:unknown;readonly lastJournalId:unknown;
}
export interface GeneralPublicCommentInput extends CommentCommon {
    readonly visibility:"public";readonly frozen:boolean;readonly screened:boolean;
    readonly loaded:boolean;readonly posterId:unknown;readonly posterExists:boolean;
    readonly body:NativeString|undefined;readonly subject:NativeString|undefined;
    readonly noHtml:unknown;readonly anonymous:boolean;readonly preformatted:unknown;
    readonly editor:NativeString|undefined;readonly datepost:NativeString|undefined;
    readonly importSourceDefined:boolean;readonly importedFrom:NativeString|undefined;
    readonly pictureKeyword:NativeString|undefined;
    readonly subjectIcon:unknown;readonly hasPicture:boolean;
    readonly adminPost:unknown;
}
export interface GeneralCommentStubInput extends CommentCommon {
    readonly visibility:"deleted"|"suspended"|"screened";readonly frozen:boolean;
}
export type GeneralCommentSourceInput=GeneralPublicCommentInput|GeneralCommentStubInput;
export interface GeneralCommentCleanOptions {
    readonly preformatted:unknown;readonly anonymous:boolean;readonly noCss:boolean;
    readonly editor:NativeString|undefined;readonly datepost:NativeString|undefined;
    readonly isImported:boolean;
}
export interface GeneralCommentSourceOperations {
    /** Actual original-source clean_comment; owns native eval effects, never identity fallback. */
    cleanComment(input:NativeString|undefined,options:GeneralCommentCleanOptions):NativeString|undefined;
    // Date/time operations also own their source eval-register effects.
    dateTimeUnix(value:unknown):GeneralModel;
    posterTime(value:unknown):GeneralModel|undefined;
    poster():GeneralModel;
    /** Named source providers operate only on this approved public record. */
    edit():{readonly edited:unknown;readonly url:NativeString|undefined;
        readonly reason:NativeString|undefined;readonly time:unknown;readonly threadrootUrl:NativeString|undefined};
    subjectImage():GeneralModel|undefined;
    picture(style:"full"|"small"|"smaller"):GeneralModel|undefined;
    esnEnabled():unknown;
    editCommentsEnabled():unknown;
}
export interface GeneralApprovedCommentNode {
    readonly input:Omit<GeneralPublicCommentInput,"depth"|"hasChildren">|
        Omit<GeneralCommentStubInput,"depth"|"hasChildren">;
    readonly children:readonly GeneralApprovedCommentNode[];
}
/** EntryPage's pre-comment enabled gate precedes even approved-record access. */
export function generalCommentTreeFromSource(context:Context,enabled:unknown,
    records:()=>readonly GeneralApprovedCommentNode[],
    operations:(input:GeneralCommentSourceInput)=>GeneralCommentSourceOperations):GeneralModel[] {
    const result:GeneralModel[]=[];
    if(!scalarTruthy(enabled))return result;
    type Work={node:GeneralApprovedCommentNode;depth:number;dest:GeneralModel[];leave?:boolean};
    const roots=records(),work:Work[]=[],active=new WeakSet<object>();
    for(let index=roots.length-1;index>=0;index--)work.push({node:roots[index]!,depth:1,dest:result});
    // Native recursive pre-order, using an iterative stack so approved deep
    // threads do not depend on the JavaScript implementation's call stack.
    while(work.length) {
        const item=work.pop()!;
        if(item.leave){active.delete(item.node);continue;}
        if(active.has(item.node))throw Error("Invalid approved comment tree");
        active.add(item.node);
        const input={...item.node.input,depth:item.depth,hasChildren:item.node.children.length>0};
        const model=generalCommentFromSource(context,input,operations(input));
        item.dest.push(model);
        work.push({...item,leave:true});
        const replies=model._replies as GeneralModel[];
        for(let index=item.node.children.length-1;index>=0;index--)
            work.push({node:item.node.children[index]!,depth:item.depth+1,dest:replies});
    }
    return result;
}
/** Hidden variants carry no body/author fields and invoke no corresponding providers. */
export function generalCommentFromSource(context:Context,input:GeneralCommentSourceInput,
    operations:GeneralCommentSourceOperations):GeneralModel {
    const visible=input.visibility==="public";
    let text:NativeString|undefined=pv(""),subject:NativeString|undefined=pv(""),poster:GeneralModel|undefined,
        userpic:GeneralModel|undefined,subjectIcon:GeneralModel|undefined,posterTime:GeneralModel|undefined,
        edited:unknown,editUrl:NativeString|undefined,editReason:NativeString|undefined,
        editTime:GeneralModel|undefined,editTimePoster:GeneralModel|undefined,threadroot=input.threadrootUrl;
    if(visible) {
        text=operations.cleanComment(quoteGeneralEntryHtml(input.body,input.noHtml),{
            preformatted:input.preformatted,anonymous:input.anonymous,noCss:input.anonymous,
            editor:input.editor,datepost:input.datepost,isImported:input.importSourceDefined});
    }
    const time=operations.dateTimeUnix(input.datepostUnix);
    const seconds=arithmetic("-",scalarNumber(input.datepostUnix),scalarNumber(input.entryLogtimeUnix));
    if(visible) {
        posterTime=operations.posterTime(input.datepostUnix);
        if(input.loaded) {
            const edit=operations.edit();edited=edit.edited;editUrl=edit.url;threadroot=edit.threadrootUrl;
            if(scalarTruthy(edited)) {
                editReason=escapeNativeHtml(scalarPV(edit.reason));editTime=operations.dateTimeUnix(edit.time);
                editTimePoster=operations.posterTime(edit.time);
            }
        }
        if(scalarTruthy(input.subjectIcon))subjectIcon=operations.subjectImage();
        if(!runtime.scalarCompare("string","==",context.prop._userpics_position,pv("none"))&&input.hasPicture) {
            const style=context.prop._comment_userpic_style;
            userpic=operations.picture(runtime.scalarCompare("string","==",style,pv("small"))?"small":
                runtime.scalarCompare("string","==",style,pv("smaller"))?"smaller":"full");
        }
        if(scalarTruthy(input.posterId))poster=input.posterExists?operations.poster():
            {".type":"UserLite",_username:undefined,_user:undefined,_name:undefined,_journal_type:pv("P")};
    }
    if(visible)subject=escapeNativeHtml(scalarPV(input.subject));
    const screened=input.visibility==="screened"||(visible&&input.screened);
    const links=[pv("delete_comment"),pv(screened?"unscreen_comment":"screen_comment"),
        pv(input.frozen?"unfreeze_thread":"freeze_thread")];
    const metadata=runtime.makeHash([[pv("picture_keyword"),visible?input.pictureKeyword:undefined]]);
    const anchor=scalarTruthy(input.talkid)?concatStrings(pv("cmt"),scalarPV(input.talkid)):pv("");
    const model:GeneralModel={".type":"Comment",_journal:input.journal,_metadata:metadata,
        _permalink_url:input.permalinkUrl,_reply_url:input.replyUrl,_poster:poster,_replies:[],
        _subject:subject,_subject_icon:subjectIcon,_talkid:runtime.scalarCopy(input.talkid),
        _ditemid:runtime.scalarCopy(input.ditemid),_text:text,_userpic:userpic,_time:time,_system_time:time,
        _edittime:editTime,_editreason:editReason,_tags:[],_full:visible&&input.loaded?1:0,
        _depth:runtime.scalarCopy(input.depth),_parent_url:input.parentUrl,_threadroot_url:threadroot,
        _screened:input.visibility==="deleted"||input.visibility==="suspended"?undefined:screened?1:0,
        _screened_noshow:input.visibility==="screened"?1:0,_frozen:input.frozen?1:0,
        _deleted:input.visibility==="deleted"?1:0,_fromsuspended:input.visibility==="suspended"?1:0,
        _link_keyseq:links,_anchor:anchor,_dom_id:anchor,
        _comment_posted:runtime.scalarCompare("numeric","==",scalarTruthy(input.lastTalkid)?input.lastTalkid:0,
            scalarTruthy(input.talkid)?input.talkid:0)&&
            runtime.scalarCompare("numeric","==",scalarTruthy(input.lastJournalId)?input.lastJournalId:0,0)?1:pv(""),
        _edited:scalarTruthy(edited)?1:0,_time_remote:undefined,_time_poster:posterTime,
        _seconds_since_entry:seconds,
        _edittime_remote:undefined,_edittime_poster:editTimePoster,_edit_url:editUrl,_timeformat24:undefined,
        _showable_children:runtime.scalarCopy(input.showableChildren),_hide_children:runtime.scalarCopy(input.hideChildren),
        _hidden_child:runtime.scalarCopy(input.hiddenChild),_echi:runtime.scalarCopy(input.echi),
        _admin_post:visible&&scalarTruthy(input.adminPost)?1:0};
    // Native feature CODE may have effects: preserve all three calls and their
    // position after the model scalar copies, rather than snapshotting once.
    if(scalarTruthy(operations.esnEnabled()))links.push(pv("watch_thread"));
    if(scalarTruthy(operations.esnEnabled()))links.push(pv("unwatch_thread"));
    if(scalarTruthy(operations.esnEnabled()))links.push(pv("watching_parent"));
    if(scalarTruthy(operations.editCommentsEnabled()))links.unshift(pv("edit_comment"));
    model._expand_url=input.expandUrl;model._js_expand_url=input.jsExpandUrl;
    model._thread_url=input.hasChildren?input.expandUrl:undefined;
    if(visible&&scalarTruthy(input.importedFrom))runtime.memberSlot(metadata,pv("imported_from"),"hash").set(input.importedFrom);
    return model;
}
