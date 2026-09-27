// general-selected-text.ts
//
// Parent-only post-source text cells for selected entries and visible comments.
//
// Portions adapted from LJ::Entry::_load_text / LJ::Talk::load_comments, forked from the
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

import type {NativeSelectedSnapshot,RawEntry,RawCommentText} from "../contracts";
import {NativeString} from "../../runtime/native-string";
import {scalarTruthy,NativeNumber} from "../../runtime/native-scalar";
import type {GeneralEntryContentInput} from "./general-entry-content";
import type {GeneralEntrySourceInput} from "./general-entry-from-source";
import type {GeneralEntryPageEntryInput} from "./general-entry-page-source";
import {generalMysqlDateParts} from "./general-model-date";
import type {GeneralTextEncoding,ConvertedNativeItem} from "./general-text-encoding";
import type {GeneralPublicSession} from "./general-public-session";

/** This source bag remains parent-only; only named approved values may be projected. */
export class GeneralSelectedText {
    private readonly sources=new Map<string,NativeString|undefined>();
    private readonly entries=new WeakMap<RawEntry,ConvertedNativeItem>();
    private readonly comments=new WeakMap<RawCommentText,ConvertedNativeItem>();
    private readonly official=new WeakMap<RawEntry,boolean>();
    private constructor(private readonly snapshot:NativeSelectedSnapshot) {
        if(snapshot.encoding!=="dbi-byte-view")throw Error("Invalid selected source encoding");
        for(const cell of snapshot.sources) {
            const value=cell.value===null?undefined:NativeString.bytes(Buffer.from(cell.value.base64,"base64"));
            if(cell.value!==null&&(cell.value.utf8!==false||value!.bytes().toString("base64")!==cell.value.base64))
                throw Error("Invalid selected source frame");
            if(this.sources.has(cell.key)) {
                const previous=this.sources.get(cell.key);
                if((previous===undefined)!==(value===undefined)||previous&&value&&!previous.bytes().equals(value.bytes()))
                    throw Error("Inconsistent selected source witness");
            }
            this.sources.set(cell.key,value);
        }
    }
    private source(key:string):NativeString|undefined {
        if(!this.sources.has(key))throw Error("Missing selected source witness");
        return this.sources.get(key);
    }
    static async prepare(snapshot:NativeSelectedSnapshot,encoding:GeneralTextEncoding,
        authority?:GeneralPublicSession):Promise<GeneralSelectedText> {
        const prepared=new GeneralSelectedText(snapshot);
        for(const entry of snapshot.facts.entries) {
            const prefix="entry:"+entry.jitemid;
            const props:Record<string,NativeString|undefined>=Object.create(null);
            for(const key of Object.keys(entry.props))props[key]=prepared.source(prefix+":prop:"+key);
            const subject=prepared.source(prefix+":subject"),text=prepared.source(prefix+":event");
            const converted=scalarTruthy(props.unknown8bit)?await encoding.item(subject,text,props):
                Object.freeze({subject,text,props:Object.freeze(props)});
            prepared.entries.set(entry,converted);
            let official=false;
            if(snapshot.facts.owner.journaltype==="C") {
                if(!authority)throw Error("Community maintainer authority is not installed");
                const manages=await authority.entryMaintainer(entry.journalid,entry.posterid);
                official=manages&&scalarTruthy(converted.props.admin_post);
            }
            prepared.official.set(entry,official);
        }
        for(const comment of snapshot.facts.comments?.texts??[]) {
            const prefix="comment:"+comment.jtalkid;
            const props:Record<string,NativeString|undefined>=Object.create(null);
            for(const key of Object.keys(comment.props))props[key]=prepared.source(prefix+":"+key);
            const subject=prepared.source(prefix+":subject");
            const text=comment.body===null?undefined:prepared.source(prefix+":body");
            // Native Talk passes an EMPTY prop hash to item_toutf8. Public
            // talkprops are retained, not converted with entry property rules.
            const converted=scalarTruthy(props.unknown8bit)?await encoding.item(subject,text):{subject,text};
            prepared.comments.set(comment,Object.freeze({...converted,props:Object.freeze(props)}));
        }
        return prepared;
    }
    /** Native load_linkobj stably sorts numeric ordernum after SQL receipt. */
    publicLinks():readonly {readonly title:NativeString|undefined;readonly url:NativeString|undefined;
        readonly hover:NativeString|undefined}[] {
        const owner=this.snapshot.facts.owner.userid;
        return Object.freeze(this.snapshot.facts.links.map((link,index)=>({link,index}))
            .sort((left,right)=>left.link.ordernum-right.link.ordernum)
            .map(({index})=>Object.freeze({
            title:this.source(`link:${owner}:${index}:title`),
            url:this.source(`link:${owner}:${index}:url`),
            hover:this.source(`link:${owner}:${index}:hover`)})));
    }
    /** Raw user props have no charset transform in Account.pm preload_props. */
    pageText():{readonly ownerName:NativeString|undefined;readonly journalTitle:NativeString|undefined;
        readonly journalSubtitle:NativeString|undefined;
        readonly website:{readonly url:NativeString|undefined;readonly name:NativeString|undefined};
        readonly customtext:{readonly title:NativeString|undefined;readonly url:NativeString|undefined;
            readonly content:NativeString|undefined}} {
        const owner=this.snapshot.facts.owner;
        const prop=(name:"url"|"urlname"|"journaltitle"|"journalsubtitle"|"customtext_title"|"customtext_url"|"customtext_content")=>
            owner.publicSettings[name]===null?undefined:this.source(`user:${owner.userid}:prop:${name}`);
        return Object.freeze({ownerName:this.source(`user:${owner.userid}:name`),
            journalTitle:prop("journaltitle"),journalSubtitle:prop("journalsubtitle"),
            website:Object.freeze({url:prop("url"),name:prop("urlname")}),
            customtext:Object.freeze({title:prop("customtext_title"),url:prop("customtext_url"),content:prop("customtext_content")})});
    }
    /** Only fields reached by Entry event_html, not its parent-only property bag. */
    entryFormatting(entry:RawEntry):Pick<GeneralEntryContentInput,
        "subject"|"event"|"editor"|"preformatted"|"importSourceDefined"|"logtimeMysql"> {
        const converted=this.entry(entry);
        return Object.freeze({subject:converted.subject?.clone(),event:converted.text?.clone(),
            editor:converted.props.editor?.clone(),preformatted:converted.props.opt_preformatted?.clone(),
            importSourceDefined:converted.props.import_source!==undefined,
            // This civil timestamp was validated from the authoritative header;
            // DBI and this projection both produce unflagged ASCII payloads.
            logtimeMysql:NativeString.bytes(Buffer.from(entry.logtime,"ascii"))});
    }
    /** Only named Entry constructor/cleaner inputs cross the worker boundary. */
    entrySource(entry:RawEntry,options:{
        readonly permalinkUrl:NativeString;readonly adultContentLevel:NativeString;
        readonly content:Pick<GeneralEntryContentInput,"suspendMessage"|"noEntryBody"|"noHtml"|"cutUrl"|"cutDisable">;
    }):GeneralEntrySourceInput {
        const owner=this.snapshot.facts.owner;
        const bytes=(value:string)=>NativeString.bytes(Buffer.from(value,"latin1"));
        return Object.freeze({journalId:entry.journalid,posterId:entry.posterid,
            ...this.entryHeader(entry,options.permalinkUrl,options.adultContentLevel),
            forceMoodtheme:bytes(owner.optForceMoodtheme),
            content:Object.freeze({...this.entryFormatting(entry),
                suspendMessage:options.content.suspendMessage,noEntryBody:options.content.noEntryBody,
                noHtml:options.content.noHtml,cutUrl:options.content.cutUrl.clone(),cutDisable:options.content.cutDisable,
                journalName:bytes(owner.user),jitemid:entry.jitemid,ditemid:entry.jitemid*256+entry.anum,
                isSyndicated:NativeNumber.integer(owner.journaltype==="Y"?1n:0n)})});
    }
    /** Direct Entry omits Recent-only cut/no-body/forced-mood inputs. */
    entryPageSource(entry:RawEntry,options:{
        readonly permalinkUrl:NativeString;readonly adultContentLevel:NativeString;
        readonly mode:unknown;readonly suspendMessage:unknown;readonly noHtml:unknown;
    }):GeneralEntryPageEntryInput {
        const owner=this.snapshot.facts.owner,bytes=(value:string)=>NativeString.bytes(Buffer.from(value,"latin1"));
        return Object.freeze({...this.entryHeader(entry,options.permalinkUrl,options.adultContentLevel),mode:options.mode,
            content:Object.freeze({...this.entryFormatting(entry),suspendMessage:options.suspendMessage,noHtml:options.noHtml,
                journalName:bytes(owner.user),jitemid:entry.jitemid,ditemid:entry.jitemid*256+entry.anum,
                isSyndicated:NativeNumber.integer(owner.journaltype==="Y"?1n:0n)})});
    }
    private entryHeader(entry:RawEntry,permalinkUrl:NativeString,adultContentLevel:NativeString):
        Omit<GeneralEntrySourceInput,"journalId"|"posterId"|"forceMoodtheme"|"content"> {
        this.entry(entry);
        if(entry.journalid!==this.snapshot.facts.owner.userid)throw Error("Selected entry journal mismatch");
        const bytes=(value:string)=>NativeString.bytes(Buffer.from(value,"latin1"));
        return {permalinkUrl:permalinkUrl.clone(),adultContentLevel:adultContentLevel.clone(),
            dateparts:generalMysqlDateParts(entry.eventtime),systemDateparts:generalMysqlDateParts(entry.logtime),
            security:bytes(entry.security),allowmask:bytes(entry.allowmask),
            adminPost:NativeNumber.integer(this.official.get(entry)?1n:0n)};
    }
    entry(entry:RawEntry):ConvertedNativeItem {
        const value=this.entries.get(entry);if(!value)throw Error("Unselected entry text reference");return value;
    }
    comment(comment:RawCommentText):ConvertedNativeItem {
        const value=this.comments.get(comment);if(!value)throw Error("Unselected comment text reference");return value;
    }
}
