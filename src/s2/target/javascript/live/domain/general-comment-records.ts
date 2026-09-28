// general-comment-records.ts
//
// Named selected Comment records for the installed source model.
//
// Portions adapted from LJ::Talk::load_comments and LJ::S2::EntryPage, forked
// from the LiveJournal project owned and operated by Live Journal, Inc., and
// modified and expanded by Dreamwidth Studios, LLC. The original license is
// available at:
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

import type {NativeNumber} from "../../runtime/native-scalar";
import {NativeString} from "../../runtime/native-string";
import type {GeneralModel} from "./general-model-primitives";
import type {GeneralApprovedCommentNode} from "./general-comment-from-source";
import type {GeneralSelectedComment,GeneralSelectedCommentPage} from "./general-comment-projection";

export interface GeneralCommentRecordAuthority {
    /** Same authorized selected Entry and source-issued logtime result. */
    readonly journal:GeneralModel;readonly ditemid:number;
    readonly entryLogtimeUnix:NativeNumber|undefined;
    readonly noHtml:unknown;
    /** Resolved by parent public picture witnesses, only on shown records. */
    shown(node:GeneralSelectedComment):{readonly hasPicture:boolean};
}

/** No raw talkprops, author rows or unselected bodies enter the source model. */
export function generalCommentRecords(page:GeneralSelectedCommentPage,
    authority:GeneralCommentRecordAuthority):readonly GeneralApprovedCommentNode[] {
    if(!Number.isSafeInteger(authority.ditemid)||authority.ditemid<1||
        authority.ditemid>1099511627775)throw Error("Invalid approved Comment entry");
    const roots:GeneralApprovedCommentNode[]=[];
    const work:{node:GeneralSelectedComment;dest:GeneralApprovedCommentNode[]}[]=
        page.roots.slice().reverse().map(node=>({node,dest:roots}));
    while(work.length) {
        const {node,dest}=work.pop()!,fields=node.fields;
        if((node.full||node.subjectOnly)&&node.show&&!node.posterSuspended&&!fields)
            throw Error("Missing selected Comment fields");
        const common={state:node.state,show:node.show,posterId:node.posterId,
            posterLoaded:node.posterLoaded,posterSuspended:node.posterSuspended,
            talkid:node.urls.talkId,ditemid:authority.ditemid,journal:authority.journal,
            datepostUnix:node.datepostUnix,entryLogtimeUnix:authority.entryLogtimeUnix,
            permalinkUrl:node.urls.permalink,replyUrl:node.urls.reply,
            parentUrl:node.urls.parent,threadrootUrl:undefined,
            expandUrl:node.urls.expand,jsExpandUrl:node.urls.jsExpand,
            showableChildren:node.showableChildren,
            // Anonymous admitted requests do not enable top-only/flat or
            // opt_echi_display. Native leaves these keys undefined here.
            hideChildren:undefined,hiddenChild:undefined,echi:undefined,
            // LJ::get_lastcomment reads MemCache only for a remote user. The
            // anonymous request has neither value and never emits the notice.
            lastTalkid:undefined,lastJournalId:undefined};
        let input:GeneralApprovedCommentNode["input"];
        if(!node.show||node.state==="D"||node.state==="S")input={kind:"stub",...common};
        else if(node.posterLoaded&&node.posterSuspended)input={kind:"suspended-loaded",...common,
            loaded:fields?.loaded??false,pictureKeyword:fields?.pictureKeyword,
            importedFrom:fields?.importedFrom,adminPost:fields?.adminPost};
        else {
            const presentation=authority.shown(node);
            if(typeof node.anonymous!=="boolean"||typeof presentation.hasPicture!=="boolean")
                throw Error("Invalid approved Comment presentation");
            input={kind:"shown",...common,loaded:fields?.loaded??false,
                subject:fields?.subject??(!node.full&&!node.subjectOnly?
                    NativeString.hostUtf8Bytes("..."):undefined),body:fields?.body,
                noHtml:authority.noHtml,anonymous:node.anonymous,
                preformatted:fields?.preformatted,editor:fields?.editor,datepost:node.datepost,
                importSourceDefined:fields?.importSourceDefined??false,
                importedFrom:fields?.importedFrom,pictureKeyword:fields?.pictureKeyword,
                subjectIcon:fields?.subjectIcon,hasPicture:presentation.hasPicture,
                adminPost:fields?.adminPost};
        }
        const children:GeneralApprovedCommentNode[]=[];
        dest.push({input,children});
        for(let index=node.children.length-1;index>=0;index--)
            work.push({node:node.children[index]!,dest:children});
    }
    return roots;
}
