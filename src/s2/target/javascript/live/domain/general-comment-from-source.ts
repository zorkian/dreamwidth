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
    /** From the witnessed page-wide %user load, not the comment's hidden text. */
    readonly state:"A"|"F"|"S"|"D";readonly show:boolean;
    readonly posterId:unknown;readonly posterLoaded:boolean;readonly posterSuspended:boolean;
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
    readonly kind:"shown";readonly loaded:boolean;
    readonly body:NativeString|undefined;readonly subject:NativeString|undefined;
    readonly noHtml:unknown;readonly anonymous:boolean;readonly preformatted:unknown;
    readonly editor:NativeString|undefined;readonly datepost:NativeString|undefined;
    readonly importSourceDefined:boolean;readonly importedFrom:NativeString|undefined;
    readonly pictureKeyword:NativeString|undefined;
    readonly subjectIcon:unknown;readonly hasPicture:boolean;
    readonly adminPost:unknown;
}
export interface GeneralCommentStubInput extends CommentCommon {
    readonly kind:"stub";
}
/** Native suspended redaction leaves loaded edit and metadata fields intact. */
export interface GeneralSuspendedCommentInput extends CommentCommon {
    readonly kind:"suspended-loaded";readonly loaded:boolean;
    readonly pictureKeyword:NativeString|undefined;
    readonly importedFrom:NativeString|undefined;readonly adminPost:unknown;
}
export type GeneralCommentSourceInput=GeneralPublicCommentInput|GeneralSuspendedCommentInput|GeneralCommentStubInput;
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
        Omit<GeneralSuspendedCommentInput,"depth"|"hasChildren">|
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
    // EntryPage applies all three redactions in source order. D/S can overlap
    // a suspended poster loaded through a separate shown comment on this page.
    const fromSuspended=input.posterLoaded&&input.posterSuspended;
    const deleted=input.state==="D",screenedHidden=input.state==="S"&&!input.show;
    const visible=!fromSuspended&&!deleted&&!screenedHidden;
    const suspendedOnly=fromSuspended&&!deleted&&!screenedHidden;
    if(visible!==(input.kind==="shown")||
        suspendedOnly!==(input.kind==="suspended-loaded"))throw Error("Invalid approved comment visibility");
    const shown=input.kind==="shown"?input:undefined;
    const loadedInput=input.kind==="shown"||input.kind==="suspended-loaded"?input:undefined;
    let text:NativeString|undefined=pv(""),subject:NativeString|undefined=pv(""),poster:GeneralModel|undefined,
        userpic:GeneralModel|undefined,subjectIcon:GeneralModel|undefined,posterTime:GeneralModel|undefined,
        edited:unknown,editUrl:NativeString|undefined,editReason:NativeString|undefined,
        editTime:GeneralModel|undefined,editTimePoster:GeneralModel|undefined,threadroot=input.threadrootUrl;
    if(shown) {
        text=operations.cleanComment(quoteGeneralEntryHtml(shown.body,shown.noHtml),{
            preformatted:shown.preformatted,anonymous:shown.anonymous,noCss:shown.anonymous,
            editor:shown.editor,datepost:shown.datepost,isImported:shown.importSourceDefined});
    }
    const time=operations.dateTimeUnix(input.datepostUnix);
    const seconds=arithmetic("-",scalarNumber(input.datepostUnix),scalarNumber(input.entryLogtimeUnix));
    // DateTime_tz(datepost,$pu) runs before all three redactions; hidden-only
    // posters never enter %user, while a page-shared loaded poster can.
    posterTime=input.posterLoaded?operations.posterTime(input.datepostUnix):undefined;
    if(loadedInput) {
        if(loadedInput.loaded) {
            const edit=operations.edit();edited=edit.edited;editUrl=edit.url;threadroot=edit.threadrootUrl;
            if(scalarTruthy(edited)) {
                editReason=escapeNativeHtml(scalarPV(edit.reason));editTime=operations.dateTimeUnix(edit.time);
                editTimePoster=operations.posterTime(edit.time);
            }
        }
    }
    if(shown) {
        if(scalarTruthy(shown.subjectIcon))subjectIcon=operations.subjectImage();
        if(!runtime.scalarCompare("string","==",context.prop._userpics_position,pv("none"))&&shown.hasPicture) {
            const style=context.prop._comment_userpic_style;
            userpic=operations.picture(runtime.scalarCompare("string","==",style,pv("small"))?"small":
                runtime.scalarCompare("string","==",style,pv("smaller"))?"smaller":"full");
        }
        if(scalarTruthy(input.posterId))poster=input.posterLoaded?operations.poster():
            {".type":"UserLite",_username:undefined,_user:undefined,_name:undefined,_journal_type:pv("P")};
    }
    if(shown)subject=escapeNativeHtml(scalarPV(shown.subject));
    const screened=screenedHidden?1:fromSuspended||deleted?undefined:input.state==="S"?1:0;
    const links=[pv("delete_comment"),pv(screened?"unscreen_comment":"screen_comment"),
        pv(input.state==="F"?"unfreeze_thread":"freeze_thread")];
    const metadata=runtime.makeHash([[pv("picture_keyword"),loadedInput?.pictureKeyword]]);
    const anchor=scalarTruthy(input.talkid)?concatStrings(pv("cmt"),scalarPV(input.talkid)):pv("");
    const model:GeneralModel={".type":"Comment",_journal:input.journal,_metadata:metadata,
        _permalink_url:input.permalinkUrl,_reply_url:input.replyUrl,_poster:poster,_replies:[],
        _subject:subject,_subject_icon:subjectIcon,_talkid:runtime.scalarCopy(input.talkid),
        _ditemid:runtime.scalarCopy(input.ditemid),_text:text,_userpic:userpic,_time:time,_system_time:time,
        _edittime:editTime,_editreason:editReason,_tags:[],_full:shown?.loaded?1:0,
        _depth:runtime.scalarCopy(input.depth),_parent_url:input.parentUrl,_threadroot_url:threadroot,
        _screened:screened,
        _screened_noshow:screenedHidden?1:0,_frozen:input.state==="F"?1:0,
        _deleted:deleted?1:0,_fromsuspended:fromSuspended?1:0,
        _link_keyseq:links,_anchor:anchor,_dom_id:anchor,
        _comment_posted:runtime.scalarCompare("numeric","==",scalarTruthy(input.lastTalkid)?input.lastTalkid:0,
            scalarTruthy(input.talkid)?input.talkid:0)&&
            runtime.scalarCompare("numeric","==",scalarTruthy(input.lastJournalId)?input.lastJournalId:0,0)?1:pv(""),
        _edited:scalarTruthy(edited)?1:0,_time_remote:undefined,_time_poster:posterTime,
        _seconds_since_entry:seconds,
        _edittime_remote:undefined,_edittime_poster:editTimePoster,_edit_url:editUrl,_timeformat24:undefined,
        _showable_children:runtime.scalarCopy(input.showableChildren),_hide_children:runtime.scalarCopy(input.hideChildren),
        _hidden_child:runtime.scalarCopy(input.hiddenChild),_echi:runtime.scalarCopy(input.echi),
        _admin_post:loadedInput&&scalarTruthy(loadedInput.adminPost)?1:0};
    // Native feature CODE may have effects: preserve all three calls and their
    // position after the model scalar copies, rather than snapshotting once.
    if(scalarTruthy(operations.esnEnabled()))links.push(pv("watch_thread"));
    if(scalarTruthy(operations.esnEnabled()))links.push(pv("unwatch_thread"));
    if(scalarTruthy(operations.esnEnabled()))links.push(pv("watching_parent"));
    if(scalarTruthy(operations.editCommentsEnabled()))links.unshift(pv("edit_comment"));
    model._expand_url=input.expandUrl;model._js_expand_url=input.jsExpandUrl;
    model._thread_url=input.hasChildren?input.expandUrl:undefined;
    if(loadedInput&&scalarTruthy(loadedInput.importedFrom))
        runtime.memberSlot(metadata,pv("imported_from"),"hash").set(loadedInput.importedFrom);
    return model;
}
