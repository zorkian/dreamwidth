// general-comment-edit.ts
//
// Loaded public Comment edit and thread-root metadata from selected facts.
//
// Portions adapted from LJ::S2::EntryPage and LJ::Comment, forked from the
// LiveJournal project owned and operated by Live Journal, Inc., and modified
// and expanded by Dreamwidth Studios, LLC. The original license is available at:
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

import {NativeString,scalarTruthy} from "../../runtime/native-scalar";
import {concatStrings} from "../../runtime/native-string";
import {generalTalkArgs} from "./general-comment-urls";
import type {GeneralSelectedComment} from "./general-comment-projection";
import type {GeneralCommentSourceOperations} from "./general-comment-from-source";

const pv=(value:string)=>NativeString.bytes(Buffer.from(value,"ascii"));
export interface GeneralCommentEditContext {
    /** Parent-approved Entry->url, site root, raw journal user, and style arg. */
    readonly permalink:NativeString;readonly siteRoot:NativeString;
    readonly journalName:NativeString;readonly styleArgument:NativeString|undefined;
}

/** EntryPage only constructs these URLs after a selected full Comment load. */
export function generalCommentEdit(node:GeneralSelectedComment,
    context:GeneralCommentEditContext):ReturnType<GeneralCommentSourceOperations["edit"]> {
    const fields=node.fields;
    if(!fields?.loaded)throw Error("Unloaded selected Comment edit");
    if(!/^[a-z0-9_]{1,25}$/.test(context.journalName.bytes().toString("latin1")))
        throw Error("Invalid selected journal name");
    const id=node.urls.talkId;
    const url=generalTalkArgs(concatStrings(context.permalink,pv("?edit="+id)),
        [context.styleArgument,node.urls.linkThreadArgument]);
    let threadrootUrl:NativeString|undefined;
    if(node.parentId) {
        threadrootUrl=concatStrings(context.siteRoot,pv("/go?redir_type=threadroot&journal="));
        threadrootUrl=concatStrings(threadrootUrl,context.journalName);
        threadrootUrl=concatStrings(threadrootUrl,pv("&talkid="+id));
        if(scalarTruthy(context.styleArgument))
            threadrootUrl=concatStrings(concatStrings(threadrootUrl,pv("&")),context.styleArgument!);
    }
    const edited=scalarTruthy(fields.editTime)?1:0;
    return Object.freeze({edited,url,reason:edited?fields.editReason:undefined,
        time:edited?fields.editTime:undefined,threadrootUrl});
}
