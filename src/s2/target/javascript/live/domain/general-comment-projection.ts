// general-comment-projection.ts
//
// Parent-only selected Comment tree and named public field projection.
//
// Portions adapted from LJ::Talk::load_comments, forked from the LiveJournal
// project owned and operated by Live Journal, Inc., and modified and expanded
// by Dreamwidth Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, adapted portions and their modifications
// are provided under the GNU General Public License. See LICENSE.
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

import type {NativeSelectedSnapshot,RawCommentText} from "../contracts";
import type {LiveStoreConfig} from "../startup-types";
import {SnapshotError} from "../data/errors";
import {NativeString} from "../../runtime/native-string";
import {commentCapability,selectComments,type CommentNode,type CommentSelection} from "./comments";
import type {GeneralSelectedText} from "./general-selected-text";
import {generalCommentUrls,type GeneralCommentUrls} from "./general-comment-urls";

type PublicFields=ReturnType<GeneralSelectedText["commentPublicFields"]>;
export interface GeneralSelectedComment {
    readonly id:number;readonly parentId:number;readonly state:"A"|"F"|"S"|"D";
    readonly show:boolean;readonly full:boolean;readonly subjectOnly:boolean;
    readonly showableChildren:number;readonly posterId:number;
    readonly posterLoaded:boolean;readonly posterSuspended:boolean;
    /** Selected shown author's canonical public user key for same-Context UserLite. */
    readonly posterUsername:NativeString|undefined;
    /** Parent-issued native treat_as_anon result for shown, nonredacted authors. */
    readonly anonymous:boolean|undefined;
    readonly datepost:NativeString;readonly datepostUnix:string|null;
    readonly urls:GeneralCommentUrls;
    /** Exact selected full/subject or suspended metadata cells; absent on structural stubs. */
    readonly fields:(Omit<PublicFields,"loaded">&{readonly loaded:boolean})|undefined;
    readonly children:readonly GeneralSelectedComment[];
}
export interface GeneralSelectedCommentPage {
    readonly roots:readonly GeneralSelectedComment[];
    readonly selection:Pick<CommentSelection,"page"|"pages"|"first"|"last"|"items"|"collapsed"|"thread">;
}
export interface GeneralSelectedCommentNavigation {
    /** Source-qualified Entry->url for this selected public Entry. */
    readonly permalink:NativeString;
    readonly styleArgument:NativeString|undefined;
}

/** No raw talkprop, hidden body, or author record crosses this parent projection. */
export function generalSelectedComments(snapshot:NativeSelectedSnapshot,
    config:Pick<LiveStoreConfig,"commentSettings"|"capabilities">,
    prepared:GeneralSelectedText,navigation:GeneralSelectedCommentNavigation):GeneralSelectedCommentPage|undefined {
    const raw=snapshot.facts.comments;
    if(!raw)return undefined;
    if(snapshot.facts.request.page.kind!=="entry"||!config.commentSettings)
        throw new SnapshotError("unsupported");
    const entry=snapshot.facts.entries[0];
    if(!entry||entry.jitemid*256+entry.anum!==snapshot.facts.request.page.ditemid)
        throw new SnapshotError("unsupported");
    const selection=selectComments(raw.headers,snapshot.facts.request.page.comments,
        config.commentSettings,commentCapability(config.capabilities.threadExpandAll,snapshot.facts.owner.caps));
    const authors=new Map(raw.authors.map(author=>[author.userid,author]));
    const headerIds=new Set(raw.headers.map(header=>header.jtalkid));
    const texts=new Map(raw.texts.map(text=>[text.jtalkid,text]));
    if(authors.size!==raw.authors.length||texts.size!==raw.texts.length)
        throw new SnapshotError("unsupported");
    const consumed=new Set<number>(),roots:GeneralSelectedComment[]=[];
    type Work={node:CommentNode;dest:GeneralSelectedComment[]};
    const work:Work[]=selection.roots.slice().reverse().map(node=>({node,dest:roots}));
    const created:GeneralSelectedComment[]=[];
    while(work.length) {
        const {node,dest}=work.pop()!,header=node.header;
        const author=authors.get(header.posterid);
        if(node.show&&author?.statusvis!=="S"&&author&&
            !/^[a-z0-9_]+$/.test(author.user))throw new SnapshotError("unavailable");
        const text:RawCommentText|undefined=texts.get(header.jtalkid);
        const selected=node.full||node.subject;
        // Native omits a suspended poster's subject-only text, while a full
        // selected suspended comment still carries its retained metadata.
        const expectsText=selected&&!(author?.statusvis==="S"&&!node.full);
        if((expectsText&&!text)||(!expectsText&&text)||
            (!node.show&&text)||header.datepostUnix===undefined)
            throw new SnapshotError("unsupported");
        if(text)consumed.add(header.jtalkid);
        const fields=text?prepared.commentPublicFields(text):undefined;
        if(fields&&(fields.state!==header.state||fields.posterId!==header.posterid||
            fields.show!==node.show))throw new SnapshotError("unsupported");
        const children:GeneralSelectedComment[]=[];
        const parentId=headerIds.has(header.parenttalkid)?header.parenttalkid:0;
        const urls=generalCommentUrls({permalink:navigation.permalink,styleArgument:navigation.styleArgument,
            talkId:header.jtalkid,parentTalkId:parentId,entryAnum:entry.anum,
            viewingThread:snapshot.facts.request.page.comments?.thread,
            destinationThread:snapshot.facts.request.page.comments?.destinationThread});
        const result:GeneralSelectedComment={id:header.jtalkid,parentId,
            state:header.state as GeneralSelectedComment["state"],show:node.show,full:node.full,
            subjectOnly:node.subject&&!node.full,showableChildren:node.showableChildren,
            posterId:header.posterid,posterLoaded:!!author,posterSuspended:author?.statusvis==="S",
            posterUsername:node.show&&author?.statusvis!=="S"&&author?
                NativeString.bytes(Buffer.from(author.user,"ascii")):undefined,
            anonymous:node.show&&author?.statusvis!=="S"?
                prepared.commentAnonymous(header.posterid):undefined,
            datepost:NativeString.bytes(Buffer.from(header.datepost,"ascii")),
            datepostUnix:header.datepostUnix,urls,
            fields:fields?Object.freeze({...fields,loaded:node.full}):undefined,
            children};
        dest.push(result);created.push(result);
        for(let index=node.children.length-1;index>=0;index--)
            work.push({node:node.children[index]!,dest:children});
    }
    if(consumed.size!==texts.size)throw new SnapshotError("unsupported");
    for(const row of created){Object.freeze(row.children);Object.freeze(row);}
    return Object.freeze({roots:Object.freeze(roots),selection:Object.freeze({page:selection.page,
        pages:selection.pages,first:selection.first,last:selection.last,items:selection.items,
        collapsed:selection.collapsed,thread:selection.thread})});
}
