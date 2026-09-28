// general-comment-urls.ts
//
// Source-ordered public Comment navigation URLs from approved entry context.
//
// Portions adapted from LJ::Talk::talkargs and LJ::S2::EntryPage, forked from
// the LiveJournal project owned and operated by Live Journal, Inc., and
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

import {NativeString,scalarTruthy} from "../../runtime/native-scalar";
import {concatStrings} from "../../runtime/native-string";

const pv=(value:string)=>NativeString.bytes(Buffer.from(value,"ascii"));
export interface GeneralCommentUrlInput {
    /** Entry->url, already authorized against this selected public Entry. */
    readonly permalink:NativeString;
    readonly styleArgument:NativeString|undefined;
    readonly talkId:number;readonly parentTalkId:number;readonly entryAnum:number;
    /** Already parsed and admitted external dtalkid; defined zero is distinct. */
    readonly viewingThread:number|undefined;
    readonly destinationThread:number|undefined;
}
export interface GeneralCommentUrls {
    readonly talkId:number;readonly permalink:NativeString;readonly reply:NativeString;
    readonly parent:NativeString|undefined;readonly expand:NativeString;readonly jsExpand:NativeString;
}

/** Native talkargs joins truthy arguments and chooses ? or & from the input URL. */
export function generalTalkArgs(url:NativeString,args:readonly (NativeString|undefined)[]):NativeString {
    const included=args.filter((arg):arg is NativeString=>arg!==undefined&&scalarTruthy(arg));
    if(!included.length)return url.clone();
    let result=concatStrings(url,pv(url.bytes().includes(63)?"&":"?"));
    for(let index=0;index<included.length;index++) {
        if(index)result=concatStrings(result,pv("&"));
        result=concatStrings(result,included[index]!);
    }
    return result;
}

/** EntryPage keeps permalink's raw ?thread append separate from talkargs. */
export function generalCommentUrls(input:GeneralCommentUrlInput):GeneralCommentUrls {
    const valid=(value:number,max:number)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
    if(!valid(input.talkId,4294967295)||!valid(input.parentTalkId,4294967295)||
        !valid(input.entryAnum,255)||input.viewingThread!==undefined&&
        !valid(input.viewingThread,1099511627775)||input.destinationThread!==undefined&&
        !valid(input.destinationThread,1099511627775))throw Error("Invalid selected comment URL identity");
    const external=input.talkId*256+input.entryAnum;
    const parent=input.parentTalkId*256+input.entryAnum;
    const anchor=pv(external?"#cmt"+external:"");
    const style=input.styleArgument;
    const linkThread=input.destinationThread!==undefined?
        input.destinationThread||0:input.viewingThread||0;
    const link=linkThread?pv("thread="+linkThread):undefined;
    const permalink=concatStrings(concatStrings(input.permalink,pv("?thread="+external)),anchor);
    const reply=generalTalkArgs(input.permalink,[pv("replyto="+external),style,link]);
    const parentUrl=input.parentTalkId?
        concatStrings(generalTalkArgs(input.permalink,[pv("thread="+parent),style]),pv("#cmt"+parent)):
        undefined;
    const expand=concatStrings(generalTalkArgs(input.permalink,[pv("thread="+external),style]),anchor);
    const destination=input.destinationThread!==undefined?input.destinationThread:input.viewingThread||0;
    const jsExpand=concatStrings(generalTalkArgs(input.permalink,
        [pv("thread="+external),pv("destination_thread="+destination),style]),anchor);
    return Object.freeze({talkId:external,permalink,reply,parent:parentUrl,expand,jsExpand});
}
