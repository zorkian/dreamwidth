// general-comment-info-source.ts
//
// Anonymous source CommentInfo from approved Entry fields.
//
// Portions adapted from LJ::Entry::comment_info, forked from LiveJournal and
// modified by Dreamwidth Studios, LLC. The inherited license is available at
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, adapted portions are provided under the
// GNU General Public License. See LICENSE.
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

import {NativeString,scalarNumber,scalarTruthy} from "../../runtime/native-scalar";
import {NativeNumber,numericCompare} from "../../runtime/native-number";
import {SnapshotError} from "../data/errors";
import {generalCommentInfo,type GeneralModel} from "./general-model-primitives";
import {generalTalkArgs} from "./general-comment-urls";

export interface GeneralCommentInfoSourceInput {
    readonly permalink:NativeString;
    readonly styleArgument:NativeString|undefined;
    readonly showTalkLinks:string;
    readonly noComments:NativeString|undefined;
    readonly noCommentsMaintainer:NativeString|undefined;
    /** Selected reply_count: defined logprop takes precedence over log2. */
    readonly replyCount:NativeString|NativeNumber;
    /** Null is compatible only with a zero effective count. */
    readonly maxComments:number|null;
}

/** LJ::Entry::comment_info with anonymous remote and source talkargs ordering. */
export function generalCommentInfoFromSource(input:GeneralCommentInfoSourceInput):GeneralModel {
    const enabled=input.showTalkLinks==="Y"&&!scalarTruthy(input.noComments)&&
        !scalarTruthy(input.noCommentsMaintainer);
    const count=enabled?input.replyCount:NativeNumber.integer(0n);
    if(input.maxComments===null&&scalarTruthy(count))throw new SnapshotError("unavailable");
    const maximum=input.maxComments??0;
    if(!Number.isSafeInteger(maximum)||maximum<0)throw new SnapshotError("unavailable");
    const maintainer=scalarTruthy(input.noCommentsMaintainer)?
        scalarTruthy(input.noComments)?NativeString.bytes(Buffer.alloc(0)):1:
        input.noCommentsMaintainer;
    const mode=NativeString.hostUtf8Bytes("mode=reply");
    return generalCommentInfo({_read_url:generalTalkArgs(input.permalink,[input.styleArgument]),
        _post_url:generalTalkArgs(input.permalink,[mode,input.styleArgument]),
        _permalink_url:generalTalkArgs(input.permalink,[input.styleArgument]),
        _count:count,_maxcomments:numericCompare(scalarNumber(count),NativeNumber.integer(BigInt(maximum)))>=0?1:0,
        _enabled:enabled?1:0,_comments_disabled_maintainer:maintainer,_screened:0,_screened_count:0,
        _show_readlink:enabled&&scalarTruthy(count)?count:0,_show_readlink_hidden:enabled?1:0,
        _show_postlink:enabled?1:0});
}
