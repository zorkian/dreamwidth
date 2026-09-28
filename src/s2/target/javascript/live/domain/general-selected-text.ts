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

import type {NativeSelectedSnapshot,RawEntry,RawCommentText,RawUserpics} from "../contracts";
import {NativeString,hashKeyBytes} from "../../runtime/native-string";
import {scalarTruthy,scalarNumber,NativeNumber} from "../../runtime/native-scalar";
import {arithmetic,divide,exactHostInteger} from "../../runtime/native-number";
import type {GeneralEntryContentInput} from "./general-entry-content";
import type {GeneralEntrySourceInput} from "./general-entry-from-source";
import type {GeneralEntryPageEntryInput} from "./general-entry-page-source";
import {generalUserpicImage} from "./general-userpic-image";
import type {GeneralModel} from "./general-model-primitives";
import {generalMysqlDateParts} from "./general-model-date";
import type {GeneralTextEncoding,ConvertedNativeItem} from "./general-text-encoding";
import type {GeneralPublicSession} from "./general-public-session";
import type {GeneralSelectedComment} from "./general-comment-projection";

/** This source bag remains parent-only; only named approved values may be projected. */
export class GeneralSelectedText {
    private readonly sources=new Map<string,NativeString|undefined>();
    private readonly entries=new WeakMap<RawEntry,ConvertedNativeItem>();
    private readonly comments=new WeakMap<RawCommentText,ConvertedNativeItem>();
    private readonly official=new WeakMap<RawEntry,boolean>();
    private readonly officialComments=new WeakMap<RawCommentText,boolean>();
    private readonly metadataOnlyComments=new WeakSet<RawCommentText>();
    private readonly commentAnonymity=new Map<number,boolean>();
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
            const metadataOnly=!prepared.sources.has(prefix+":subject");
            const header=snapshot.facts.comments?.headers.find(row=>row.jtalkid===comment.jtalkid);
            if(!header)throw Error("Unselected comment header");
            if(metadataOnly) {
                const poster=snapshot.facts.comments?.authors.find(row=>row.userid===header.posterid);
                if(!poster||poster.statusvis!=="S"||!['A','F'].includes(header.state)||
                    comment.subject!==''||comment.body!==null)
                    throw Error("Invalid suspended comment metadata witness");
                prepared.metadataOnlyComments.add(comment);
            }
            const subject=metadataOnly?undefined:prepared.source(prefix+":subject");
            const text=comment.body===null?undefined:prepared.source(prefix+":body");
            // Native Talk passes an EMPTY prop hash to item_toutf8. Public
            // talkprops are retained, not converted with entry property rules.
            const converted=!metadataOnly&&scalarTruthy(props.unknown8bit)?
                await encoding.item(subject,text):{subject,text};
            prepared.comments.set(comment,Object.freeze({...converted,props:Object.freeze(props)}));
            let official=false;
            if(snapshot.facts.owner.journaltype==='C'&&scalarTruthy(props.admin_post)) {
                if(!authority)throw Error("Community maintainer authority is not installed");
                official=await authority.entryMaintainer(snapshot.facts.owner.userid,header.posterid);
            }
            prepared.officialComments.set(comment,official);
        }
        for(const author of snapshot.facts.comments?.authors??[]) {
            // Hidden-only posters are not loaded; S posters have their subject
            // and text redacted, so no relationship read may authorize them.
            if(author.statusvis==="S")continue;
            if(author.journaltype==="I") {
                if(!authority)throw Error("Comment identity authority is not installed");
                prepared.commentAnonymity.set(author.userid,await authority.commentAnonymous(
                    snapshot.facts.owner.userid,author.userid,snapshot.facts.owner.journaltype,author.user));
            } else prepared.commentAnonymity.set(author.userid,false);
        }
        return prepared;
    }
    /** Missing poster is anonymous; identities require the issued relation witness. */
    commentAnonymous(posterId:number):boolean {
        if(!posterId||!this.snapshot.facts.comments?.authors.some(row=>row.userid===posterId))return true;
        const answer=this.commentAnonymity.get(posterId);
        if(answer===undefined)throw Error("Unapproved Comment poster cleaner mode");
        return answer;
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
    /** Named direct Userpic row fields, retaining original DBI description bytes. */
    ownerPicture(picId:number):{readonly userid:number;readonly picid:number;
        readonly width:number|undefined;readonly height:number|undefined;
        readonly description:NativeString|undefined}|undefined {
        return this.pictureFields(this.snapshot.facts.owner.userid,picId);
    }
    /** Native get_picid_from_keyword: direct default differs from usable keyword rows. */
    pictureId(userid:number,keyword?:NativeString):number|NativeString {
        const account=userid===this.snapshot.facts.owner.userid?this.snapshot.facts.owner:
            this.snapshot.facts.posters.find(poster=>poster.userid===userid);
        if(!account)throw Error("Unselected picture account");
        const fallback=account.defaultpicid;
        if(keyword===undefined||account.clusterid===0)return fallback;
        const pictures=userid===this.snapshot.facts.owner.userid?this.snapshot.facts.userpics:
            this.snapshot.pictureAccounts?.find(selected=>selected.userid===userid)?.pictures;
        if(!pictures)throw Error("Selected picture facts are not installed");
        const usable=new Map(pictures.pictures.filter(row=>row.state!=="X"&&row.state!=="S")
            .map(row=>[String(row.picid),row.picid]));
        const key=(value:NativeString)=>{const native=hashKeyBytes(value);
            return (native.utf8?"utf8:":"bytes:")+native.bytes.toString("hex");};
        const keywords=new Map<string,number>();
        for(let index=0;index<pictures.mappings.length;index++) {
            const row=pictures.mappings[index]!;
            const name=this.source(`picture-map:${userid}:${index}`);
            // Source skips malformed rows before registering any mapping.
            if(name!==undefined&&(name.bytes().length===0||/[\r\n\0]/.test(name.bytes().toString("latin1"))))continue;
            if(name===undefined||!row.picid||!usable.has(String(row.picid)))continue;
            keywords.set(key(name),row.picid);
        }
        const selected=keywords.get(key(keyword));
        if(selected)return selected;
        // Native hash lookup keeps capture spelling: pic#001 is not pic#1.
        // Non-ASCII digit captures cannot equal canonical integer row keys.
        const capture=/^pic#([0-9]+)\n?(?![\s\S])/.exec(keyword.bytes().toString("latin1"));
        if(capture&&usable.has(capture[1]!)) {
            const bytes=Buffer.from(capture[1]!,"ascii");
            return keyword.flagged()?NativeString.flagged(bytes):NativeString.bytes(bytes);
        }
        return fallback;
    }
    /** Native map redirect traversal preserves hash-key spelling and cycle => mapid 0. */
    pictureMapKeyword(userid:number,mapid:NativeString):NativeString|undefined {
        const account=userid===this.snapshot.facts.owner.userid?this.snapshot.facts.owner:
            this.snapshot.facts.posters.find(poster=>poster.userid===userid);
        if(!account)throw Error("Unselected picture account");
        if(account.clusterid===0||account.dversion<9)return undefined;
        const pictures=userid===this.snapshot.facts.owner.userid?this.snapshot.facts.userpics:
            this.snapshot.pictureAccounts?.find(selected=>selected.userid===userid)?.pictures;
        if(!pictures)throw Error("Selected picture facts are not installed");
        return this.mapKeyword(userid,pictures,mapid);
    }
    private mapKeyword(userid:number,pictures:RawUserpics,mapid:NativeString):NativeString|undefined {
        const names=new Map<string,NativeString>(),redirects=new Map<string,string>();
        for(let index=0;index<pictures.mappings.length;index++) {
            const row=pictures.mappings[index]!,name=this.source(`picture-map:${userid}:${index}`);
            if(name!==undefined&&(name.bytes().length===0||/[\r\n\0]/.test(name.bytes().toString("latin1"))))continue;
            if(row.redirectMapid)redirects.set(String(row.mapid??""),String(row.redirectMapid));
            else names.set(String(row.mapid??""),name??NativeString.bytes(Buffer.from("pic#"+(row.picid??""))));
        }
        const native=hashKeyBytes(mapid);
        // All stored map IDs are canonical integer hash keys. A flagged wide
        // key is distinct; a downgradable flagged key uses its native bytes.
        let current=native.utf8?"":native.bytes.toString("latin1");
        const seen=new Set([current]);
        while(redirects.has(current)) {
            current=redirects.get(current)!;
            if(seen.has(current)){current="0";break;}
            seen.add(current);
        }
        return names.get(current)?.clone();
    }
    /** User construction and the Recent shared-picture branch use defaultpicid directly. */
    defaultPicture(userid:number,root:NativeString):GeneralModel {
        // Do not route through keyword resolution: the direct default can name
        // a row excluded from the usable keyword list (Userpic::get/load_row).
        return this.resolvedPictureImage(userid,this.pictureId(userid),root);
    }
    /** Entry::userpic_kw then new_from_keyword/default; no uploaded URL is involved. */
    entryPicture(entry:RawEntry,root:NativeString):{readonly image:GeneralModel;readonly keyword:NativeString|undefined} {
        const converted=this.entry(entry);
        const account=entry.posterid===this.snapshot.facts.owner.userid?this.snapshot.facts.owner:
            this.snapshot.facts.posters.find(poster=>poster.userid===entry.posterid);
        if(!account)throw Error("Unselected picture account");
        const keyword=account.dversion>=9?(scalarTruthy(converted.props.picture_mapid)?
            this.pictureMapKeyword(entry.posterid,converted.props.picture_mapid!):undefined):
            converted.props.picture_keyword;
        const id=this.pictureId(entry.posterid,keyword);
        return Object.freeze({image:this.resolvedPictureImage(entry.posterid,id,root,keyword),keyword});
    }
    /** Talk::load_comments resolves only this shown poster's selected picture. */
    commentPicture(node:GeneralSelectedComment,root:NativeString,
        style:"full"|"small"|"smaller"):{readonly hasPicture:boolean;readonly image:GeneralModel|undefined} {
        const comments=this.snapshot.facts.comments;
        if(!comments||!comments.headers.some(header=>header.jtalkid===node.id&&
            header.posterid===node.posterId)||!node.show||!['A','F'].includes(node.state))
            throw Error("Unselected Comment picture");
        const author=comments.authors.find(row=>row.userid===node.posterId);
        if(!author||author.statusvis==="S")return Object.freeze({hasPicture:false,image:undefined});
        const source=comments.texts.find(row=>row.jtalkid===node.id);
        const props=source?this.comment(source).props:Object.create(null) as Record<string,NativeString|undefined>;
        const pictures=author.pictures;
        const usable=new Map(pictures.pictures.filter(row=>row.state!=="X"&&row.state!=="S")
            .map(row=>[String(row.picid),row.picid]));
        const key=(value:NativeString)=>{const native=hashKeyBytes(value);
            return (native.utf8?"utf8:":"bytes:")+native.bytes.toString("hex");};
        const valid=(index:number)=>{const row=pictures.mappings[index]!;
            const name=this.source(`picture-map:${author.userid}:${index}`);
            return name===undefined||name.bytes().length>0&&
                !/[\r\n\0]/.test(name.bytes().toString("latin1"));};
        let picid:number|NativeString=author.defaultpicid;
        if(author.clusterid&&author.dversion>=9&&scalarTruthy(props.picture_mapid)) {
            const native=hashKeyBytes(props.picture_mapid!);
            let current=native.utf8?"":native.bytes.toString("latin1");
            const mappings=new Map<string,(typeof pictures.mappings)[number]>();
            pictures.mappings.forEach((row,index)=>{if(valid(index))mappings.set(String(row.mapid??""),row);});
            const seen=new Set([current]);
            while(mappings.get(current)?.redirectMapid) {
                current=String(mappings.get(current)!.redirectMapid);
                if(seen.has(current)){current="0";break;}
                seen.add(current);
            }
            const selected=mappings.get(current)?.picid;
            if(selected&&usable.has(String(selected)))picid=selected;
        } else if(author.clusterid&&author.dversion<9&&node.fields?.pictureKeyword!==undefined) {
            const keyword=node.fields.pictureKeyword;
            const keywords=new Map<string,number>();
            pictures.mappings.forEach((row,index)=>{
                const name=this.source(`picture-map:${author.userid}:${index}`);
                if(valid(index)&&name&&row.picid&&usable.has(String(row.picid)))
                    keywords.set(key(name),row.picid);
            });
            const matched=keywords.get(key(keyword));
            if(matched)picid=matched;
            else {
                const capture=/^pic#([0-9]+)\n?(?![\s\S])/.exec(keyword.bytes().toString("latin1"));
                if(capture&&usable.has(capture[1]!))
                    picid=keyword.flagged()?NativeString.flagged(Buffer.from(capture[1]!,"ascii")):
                        NativeString.bytes(Buffer.from(capture[1]!,"ascii"));
            }
        }
        const numeric=exactHostInteger(scalarNumber(picid),0,4294967295);
        // load_userpics checks actual userpic2 rows, including a direct
        // default X/S row. A resolved ID without that row emits no Image.
        const row=author.clusterid?pictures.pictures.find(picture=>picture.picid===numeric):undefined;
        if(!row)return Object.freeze({hasPicture:false,image:undefined});
        const width=NativeNumber.integer(BigInt(row.width)),height=NativeNumber.integer(BigInt(row.height));
        const scale=(value:NativeNumber)=>style==="full"?value:divide(
            style==="small"?arithmetic("*",value,NativeNumber.integer(3n)):value,
            NativeNumber.integer(style==="small"?4n:2n));
        const image=generalUserpicImage({userid:author.userid,picid,root,
            username:NativeString.bytes(Buffer.from(author.user,"latin1")),
            width:scale(width),height:scale(height),
            description:author.statusvis==="X"?undefined:
                this.source(`picture:${author.userid}:${numeric}`)?.clone(),
            keyword:node.fields?.pictureKeyword});
        return Object.freeze({hasPicture:true,image});
    }
    /** Selected owner/poster source only, never a raw account lookup from the worker. */
    pictureFields(userid:number,picId:number):{readonly userid:number;readonly picid:number;
        readonly width:number|undefined;readonly height:number|undefined;
        readonly description:NativeString|undefined}|undefined {
        if(!Number.isSafeInteger(picId)||picId<0||picId>4294967295)
            throw Error("Invalid selected picture identity");
        if(!picId)return undefined;
        const owner=this.snapshot.facts.owner.userid;
        if(userid!==owner&&!this.snapshot.facts.entries.some(entry=>entry.posterid===userid))
            throw Error("Unselected picture account");
        const pictures=userid===owner?this.snapshot.facts.userpics:
            this.snapshot.pictureAccounts?.find(account=>account.userid===userid)?.pictures;
        if(!pictures)throw Error("Selected picture facts are not installed");
        const row=pictures.pictures.find(picture=>picture.userid===userid&&picture.picid===picId);
        // Image_userpic constructs a skeleton for an absent direct row. Native
        // width/height/description are then undefined, not a default row's data.
        return Object.freeze({userid,picid:picId,width:row?.width,height:row?.height,
            description:row?this.source(`picture:${userid}:${picId}`)?.clone():undefined});
    }
    /** Parent caller resolved picid; native caller dimensions use || row fallback. */
    resolvedPictureImage(userid:number,picId:number|NativeString,root:NativeString,keyword?:NativeString,
        width?:unknown,height?:unknown):GeneralModel {
        const account=userid===this.snapshot.facts.owner.userid?this.snapshot.facts.owner:
            this.snapshot.facts.posters.find(poster=>poster.userid===userid);
        if(!account)throw Error("Unselected picture account");
        const fields=this.pictureFields(userid,exactHostInteger(scalarNumber(picId),0,4294967295));
        // Userpic::get returns before any direct row lookup for is_expunged
        // (status X OR cluster0) or suspended users. A newly-created skeleton
        // retains its picid/owner, but has no dimensions/description. Picture
        // state X/S itself is different and does not prevent its direct load.
        const readable=account.statusvis!=="X"&&account.statusvis!=="S"&&account.clusterid!==0;
        return generalUserpicImage({userid,picid:picId,root,
            // Display.pm aliases username to raw user, even ext_NNN identities;
            // neither display_name nor escaped UserLite text is substituted.
            username:NativeString.bytes(Buffer.from(account.user,"latin1")),
            width:scalarTruthy(width)?width:readable?fields?.width:undefined,
            height:scalarTruthy(height)?height:readable?fields?.height:undefined,
            description:readable?fields?.description:undefined,keyword});
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
    /** Comment::admin_post requires community, existing poster and current can_manage. */
    commentAdminPost(comment:RawCommentText):NativeNumber {
        if(!this.comments.has(comment))throw Error("Unselected comment text reference");
        return NativeNumber.integer(this.officialComments.get(comment)?1n:0n);
    }
    /** Parent-only selected fields; raw props and author account rows stay here. */
    commentPublicFields(comment:RawCommentText):{
        readonly state:'A'|'F'|'S'|'D';readonly show:boolean;readonly posterId:number;
        readonly posterLoaded:boolean;readonly posterSuspended:boolean;readonly loaded:boolean;
        readonly subject:NativeString|undefined;readonly body:NativeString|undefined;
        readonly editor:NativeString|undefined;readonly preformatted:NativeString|undefined;
        readonly importSourceDefined:boolean;readonly editTime:NativeString|undefined;
        readonly editReason:NativeString|undefined;readonly subjectIcon:NativeString|undefined;
        readonly importedFrom:NativeString|undefined;readonly pictureKeyword:NativeString|undefined;
        readonly adminPost:NativeNumber;
    } {
        const converted=this.comment(comment),raw=this.snapshot.facts.comments;
        const header=raw?.headers.find(row=>row.jtalkid===comment.jtalkid);
        if(!header)throw Error("Unselected comment header");
        if(!['A','F','S','D'].includes(header.state))throw Error("Invalid selected comment state");
        const author=raw?.authors.find(row=>row.userid===header.posterid);
        const props=converted.props;
        const pictureKeyword=author&&author.dversion>=9?
            scalarTruthy(props.picture_mapid)?this.mapKeyword(author.userid,author.pictures,props.picture_mapid!):
                undefined:props.picture_keyword;
        return Object.freeze({state:header.state as 'A'|'F'|'S'|'D',show:header.state==='A'||header.state==='F',
            posterId:header.posterid,posterLoaded:!!author,posterSuspended:author?.statusvis==='S',
            loaded:comment.body!==null||this.metadataOnlyComments.has(comment),
            subject:converted.subject?.clone(),body:converted.text?.clone(),
            editor:props.editor?.clone(),preformatted:props.opt_preformatted?.clone(),
            importSourceDefined:props.import_source!==undefined,editTime:props.edit_time?.clone(),
            editReason:props.edit_reason?.clone(),subjectIcon:props.subjecticon?.clone(),
            importedFrom:props.imported_from?.clone(),pictureKeyword:pictureKeyword?.clone(),
            adminPost:this.commentAdminPost(comment)});
    }
}
