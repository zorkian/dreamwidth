// comments.ts
//
// Native anonymous comment tree selection without private text.
//
// Authors:
//     Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.
//
// Source port: LJ/Talk.pm load_comments, inherited LiveJournal GPL terms.
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// See LICENSE for the GNU General Public License covering that inherited port.

import type {CommentQuery,RawCommentHeader,PublicAppConfig} from '../contracts';
import {SnapshotError} from '../data/errors';
import {UserpicSelection} from './userpics';

export interface CommentNode {
    readonly header:RawCommentHeader;
    readonly children:CommentNode[];
    readonly show:boolean;
    full:boolean;
    subject:boolean;
    showableChildren:number;
}
export interface CommentSelection {
    readonly roots:CommentNode[];
    readonly fullIds:readonly number[];
    readonly subjectIds:readonly number[];
    readonly page:number; readonly pages:number; readonly first:number;
    readonly last:number; readonly items:number; readonly collapsed:boolean;
    readonly thread:number;
}
export function validateCommentQuery(query:CommentQuery|undefined):CommentQuery {
    const q=query??{};
    if(!q||typeof q!=='object'||Object.keys(q).some(key=>!['page','thread','destinationThread','expandAll'].includes(key)))throw new SnapshotError('unsupported');
    for(const key of ['page','thread','destinationThread'] as const) {
        const value=q[key];
        if(value!==undefined&&(!Number.isSafeInteger(value)||value<0||value>(key==='page'?4294967295:1099511627775)))throw new SnapshotError('unsupported');
    }
    if(q.expandAll!==undefined&&typeof q.expandAll!=='boolean')throw new SnapshotError('unsupported');
    return q;
}
export function selectComments(headers:readonly RawCommentHeader[],query:CommentQuery|undefined,
    settings:NonNullable<PublicAppConfig['commentSettings']>,expandAllowed:boolean):CommentSelection {
    const fail=():never=>{throw new SnapshotError('unsupported');};
    const q=validateCommentQuery(query);
    if(headers.length>10000||[settings.pageSize,settings.threadPoint,settings.maxSubjects].some(n=>!Number.isSafeInteger(n)||n<1||n>10000))fail();
    const nodes=new Map<number,CommentNode>();
    for(const h of headers) {
        if(!Number.isSafeInteger(h.jtalkid)||h.jtalkid<1||h.jtalkid>4294967295||
            !Number.isSafeInteger(h.parenttalkid)||h.parenttalkid<0||!Number.isSafeInteger(h.posterid)||h.posterid<0||
            !['A','F','S','D'].includes(h.state)||nodes.has(h.jtalkid))fail();
        nodes.set(h.jtalkid,{header:h,children:[],show:h.state==='A'||h.state==='F',full:false,subject:false,showableChildren:0});
    }
    // Root edge-depth is zero. Check the complete target graph iteratively
    // before any recursive projection or request serialization can consume it.
    const depths=new Map<number,number>();
    for(const node of [...nodes.values()].sort((a,b)=>a.header.jtalkid-b.header.jtalkid)) {
        const parent=nodes.has(node.header.parenttalkid)?node.header.parenttalkid:0;
        if(parent>=node.header.jtalkid&&parent!==0)fail();
        const depth=parent?(depths.get(parent)??fail())+1:0;
        if(depth>1000)fail();depths.set(node.header.jtalkid,depth);
    }
    const children=new Map<number,CommentNode[]>();let count=0;
    for(const node of [...nodes.values()].sort((a,b)=>b.header.jtalkid-a.header.jtalkid)) {
        const parent=nodes.has(node.header.parenttalkid)?node.header.parenttalkid:0;
        if(parent>=node.header.jtalkid&&parent!==0)fail();
        node.children.push(...children.get(node.header.jtalkid)??[]);
        if(node.show)count++;
        const sum=Number(node.show)+node.showableChildren;
        if(sum) {
            const siblings=children.get(parent)??[];siblings.unshift(node);children.set(parent,siblings);
            const ancestor=nodes.get(parent);if(ancestor)ancestor.showableChildren+=sum;
        }
    }
    const requested=Math.floor((q.thread??0)/256),thread=nodes.has(requested)?requested:0;
    const all=thread?[nodes.get(thread)!]:children.get(0)??[];
    const pageSize=count<settings.threadPoint?settings.threadPoint:settings.pageSize;
    const pages=Math.max(1,Math.ceil(all.length/pageSize));
    const page=Math.min(pages,Math.max(1,q.page??1));
    const first=all.length?pageSize*(page-1)+1:0,last=Math.min(all.length,pageSize*page);
    const roots=all.slice(first?first-1:0,last);
    const full=[...roots],subjects:CommentNode[]=[];let collapsed=false;
    const queue=[...roots],firstChildren=new Set(roots);
    for(let index=0;index<queue.length;index++) {
        for(const child of queue[index]!.children) {
            if(full.length<pageSize||firstChildren.has(queue[index]!)||(q.expandAll&&expandAllowed)) {
                full.push(child);firstChildren.delete(queue[index]!);
            } else {collapsed=true;subjects.push(child);}
            queue.push(child);
        }
    }
    for(const node of full)node.full=node.show;
    for(const node of subjects.slice(0,settings.maxSubjects))node.subject=node.show;
    return {roots,fullIds:full.filter(n=>n.show).map(n=>n.header.jtalkid),
        subjectIds:subjects.slice(0,settings.maxSubjects).filter(n=>n.show).map(n=>n.header.jtalkid),
        page,pages,first,last,items:all.length,collapsed,thread};
}

export function commentCapabilityValue(cap:import('../startup-types').SourceCapability|undefined,caps:string):number|null {
    if(!cap||cap.hookConfigured||!/^\d+$/.test(caps))throw new SnapshotError('unsupported');
    let value:number|null=null;const seen=new Set<number>();
    for(const item of cap.byBit) {
        if(!Number.isSafeInteger(item.bit)||item.bit<0||item.bit>31||seen.has(item.bit)||!Number.isFinite(item.value))throw new SnapshotError('unsupported');
        seen.add(item.bit);
        if(BigInt(caps)&(1n<<BigInt(item.bit)))value=value===null?item.value:Math.max(value,item.value);
    }
    return value??cap.defaultValue;
}

export function commentCapability(cap:import('../startup-types').SourceCapability|undefined,caps:string):boolean {
    return !!commentCapabilityValue(cap,caps);
}

/** Source badge presentation, independent of journal-owner admission. */
export function authorBadge(author:import('../contracts').RawCommentAuthor,config:PublicAppConfig,
    caps:import('../startup-types').SourceCapabilities):{badgeKind:"personal"|"staff";badgeDeleted:boolean} {
    if(config.headIconHookConfigured!==false)throw new SnapshotError('unsupported');
    let readonly=false;
    // Native visible/memorial/locked/read-only labels short-circuit get_cap.
    if(!['V','M','L','O'].includes(author.statusvis)) {
        const clusters=caps.authorReadonlyClusters;
        if(!clusters||clusters.length>4096)throw new SnapshotError('unsupported');
        const seen=new Set<number>();
        for(const row of clusters) {
            if(!Number.isSafeInteger(row.clusterId)||row.clusterId<0||seen.has(row.clusterId)||
                typeof row.forced!=='boolean'||!['off','on','when-needed'].includes(row.advisory))
                throw new SnapshotError('unsupported');
            seen.add(row.clusterId);
        }
        const cluster=clusters.find(row=>row.clusterId===author.clusterid);
        const override=!!cluster&&(cluster.forced||(cluster.advisory!=='off'&&
            !commentCapability(caps.authorAvoidReadonly,author.caps)));
        if(override) {
            if(cluster!.advisory==='when-needed')throw new SnapshotError('unsupported');
            readonly=true;
        } else readonly=commentCapability(caps.authorReadonly,author.caps);
    }
    return {badgeKind:commentCapability(caps.authorStaffHeadicon,author.caps)?'staff':'personal',
        badgeDeleted:!['V','M','L','O'].includes(author.statusvis)&&!readonly};
}

export const PUBLIC_COMMENT_PROPS=['editor','opt_preformatted','unknown8bit','import_source','imported_from',
    'edit_time','edit_reason','subjecticon','admin_post','picture_mapid','picture_keyword'] as const;

/** Project only the selected public tree. Raw property digests never cross this boundary. */
export function approveComments(snapshot:import('../contracts').RawJournalSnapshot,
    config:PublicAppConfig,capabilities:import('../startup-types').SourceCapabilities):
    import('../render/types').ApprovedComments|undefined {
    const raw=snapshot.comments;if(!raw)return undefined;
    const entry=snapshot.entries[0];
    const truth=(value:string|null|undefined)=>!!value&&value!=='0';
    if(snapshot.owner.optShowTalkLinks!=='Y'||!entry||truth(entry.props.opt_nocomments)||
        truth(entry.props.opt_nocomments_maintainer))return undefined;
    const fail=():never=>{throw new SnapshotError('unsupported');};
    if(snapshot.request.page.kind!=='entry'||!config.commentSettings)return fail();
    const expandAllowed=commentCapability(capabilities.threadExpandAll,snapshot.owner.caps);
    const expanderAllowed=commentCapability(capabilities.threadExpander,snapshot.owner.caps);
    const selected=selectComments(raw.headers,snapshot.request.page.comments,config.commentSettings!,expandAllowed);
    const authors=new Map(raw.authors.map(a=>[a.userid,a]));
    const headerIds=new Set(raw.headers.map(h=>h.jtalkid));
    const texts=new Map(raw.texts.map(t=>[t.jtalkid,t]));
    if(authors.size!==raw.authors.length||texts.size!==raw.texts.length)fail();
    const required=new Set([...selected.fullIds,...selected.subjectIds]);
    const consumed=new Set<number>();let total=0;
    const trueValue=(value:string|null|undefined):boolean=>!!value&&value!=='0';
    const project=(node:CommentNode):import('../render/types').ApprovedComment=>{
        const h=node.header,author=h.posterid?authors.get(h.posterid):null;
        if(node.show&&h.posterid&&!author)fail();
        const suspended=author?.statusvis==='S';
        const visible=node.show&&!suspended;
        let safeAuthor:import('../render/types').ApprovedComment['author']=null;
        const text=visible&&required.has(h.jtalkid)?texts.get(h.jtalkid):undefined;
        const props:Record<string,string|null>=Object.create(null);
        if(text) {
            consumed.add(h.jtalkid);
            if(Object.keys(text.props).some(key=>!(PUBLIC_COMMENT_PROPS as readonly string[]).includes(key)))fail();
            // The first bundle does not silently omit native public icon/edit-time
            // behavior. Those reached paths need their own static/timezone port.
            if(trueValue(text.props.subjecticon)||trueValue(text.props.edit_time)||trueValue(text.props.unknown8bit))fail();
            for(const key of ['editor','opt_preformatted','import_source','imported_from','admin_post'] as const)
                if(Object.hasOwn(text.props,key))props[key]=text.props[key]??null;
            if(![undefined,null,'','0','1'].includes(props.opt_preformatted))fail();
            total+=Buffer.byteLength(text.subject)+Buffer.byteLength(text.body??'');
            if(total>2097152||Buffer.byteLength(text.subject)>8192||Buffer.byteLength(text.body??'')>65536)fail();
        } else if(visible&&required.has(h.jtalkid))fail();
        if(!visible&&texts.has(h.jtalkid))fail();
        if(visible&&author) {
            if(author.journaltype!=='P'||! /^[A-Z]$/.test(author.status)||!['V','D','X','L','M','O'].includes(author.statusvis)||
                !/^[a-z0-9_]{1,25}$/.test(author.user)||!/^\d+$/.test(author.caps)||
                BigInt(author.caps)&BigInt(capabilities.moveInProgressMask))fail();
            const selectedPicture=node.full&&author.clusterid>0?new UserpicSelection(author.pictures,author.userid,author.defaultpicid,author.dversion).forEntry(text?.props??{}):null;
            // EntryPage uses the loaded talk picture record, never an absent-row skeleton.
            const picture=selectedPicture&&author.pictures.pictures.some(row=>row.picid===selectedPicture.picid)?selectedPicture:null;
            if(config.userpicUrlHookConfigured&&picture)fail();
            safeAuthor={userid:author.userid,username:author.user,name:author.name,
                timezone:author.timezone,journalType:author.journaltype,userpic:picture,
                ...authorBadge(author,config,capabilities)};
        }
        const rawBody=visible&&node.full?text?.body:null;
        if(visible&&node.full&&rawBody===null)fail();
        return {id:h.jtalkid,parentId:headerIds.has(h.parenttalkid)?h.parenttalkid:0,state:h.state as 'A'|'F'|'S'|'D',suspended:!!suspended,
            full:visible&&node.full,subjectOnly:visible&&node.subject,
            subject:visible?(text?.subject??'...'):'',rawBody:rawBody??null,datepost:h.datepost,
            author:safeAuthor,props:Object.freeze(props),replies:node.children.map(project),
            showableChildren:node.showableChildren};
    };
    const roots=selected.roots.map(project);
    if(consumed.size!==texts.size)fail();
    return {roots,expandAllowed,expanderAllowed,page:selected.page,pages:selected.pages,
        first:selected.first,last:selected.last,items:selected.items,collapsed:selected.collapsed,thread:selected.thread};
}
