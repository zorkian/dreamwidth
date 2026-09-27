// general-builtins.ts
//
// Scalar-aware anonymous and pure application host operations.
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
// Semantic ports from LJ/S2.pm, originally forked from the LiveJournal project
// owned and operated by Live Journal, Inc., and subsequently modified by
// Dreamwidth Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, the adapted portions and their modifications
// are provided under the GNU General Public License. A copy of that license is
// included in the LICENSE file in this distribution.
//

import {runtime,type BuiltinFunction,type Context} from "../../runtime/s2runtime";
import {NativeString, scalarPV, nativeProgramError} from "../../runtime/native-scalar";
import {concatStrings, hashKeyBytes, caseString, replaceString, stringIndex,
    byteCharacters,characterCodepoint} from "../../runtime/native-string";
import {nativeCharacterClass} from "../../runtime/native-profile";
import {escapeNativeHtml} from "./general-diagnostics";
import {generalCssCallbacks} from "./general-css-builtins";
import {generalEscapeUrl} from "../domain/general-navigation-url";

const bytes = (value: string): NativeString => NativeString.hostUtf8Bytes(value);
function stripTags(value: NativeString): NativeString {
    // Exact source LJ/S2.pm striphtml regex, not an HTML parser or sanitizer.
    const view = value.bytes().toString("latin1").replace(/<[^\n]*?>/g, "");
    return NativeString.fromFrame({bytes: Buffer.from(view,"latin1"), utf8:value.flagged()});
}
/** Native whitespace-delimited double-slash split, preserving flags and trailing empties. */
function pluralForms(ctx:Context,value:NativeString):NativeString[] {
    if(!ctx.scalarProfile)throw Error("Missing admitted native character profile");
    const characters=byteCharacters(value),result:NativeString[]=[];
    const space=(index:number)=>index>=0&&index<characters.length&&nativeCharacterClass(
        ctx.scalarProfile!,"space",Number(characterCodepoint(characters[index]!)),value.flagged());
    const slash=(index:number)=>index<characters.length&&characterCodepoint(characters[index]!)===47n;
    const part=(from:number,to:number)=>NativeString.fromFrame({
        bytes:Buffer.concat(characters.slice(from,to).map(character=>character.bytes())),utf8:value.flagged()});
    let start=0;
    for(let index=0;index+1<characters.length;index++) {
        if(!slash(index)||!slash(index+1))continue;
        let end=index;while(end>start&&space(end-1))end--;
        result.push(part(start,end));index+=2;
        while(space(index))index++;
        start=index;index--;
    }
    result.push(part(start,characters.length));
    while(result.length&&!result[result.length-1]!.bytes().length)result.pop();
    return result;
}
function pluralPhrase(ctx:Context,n:unknown,property:unknown):NativeString {
    if(n===undefined||n===null)n=0;
    const form=ctx.runNativeFunction("lang_map_plural(int)",[n],"plural");
    const key=hashKeyBytes(scalarPV(property));
    // Registration names are native byte-view metadata. A non-downgradeable
    // flagged key is distinct from those byte keys; retain its full identity
    // for the internal plural cache instead of decoding invalid/wide UTF8.
    const name=key.utf8?"\0native-wide:"+key.bytes.toString("hex"):key.bytes.toString("latin1");
    const cache="__plurals_"+name;
    let forms=ctx.prop[cache];
    if(!Array.isArray(forms))forms=ctx.prop[cache]=pluralForms(ctx,scalarPV(ctx.prop["_"+name]));
    const values=forms as unknown[];
    let text=runtime.memberSlot(values,form,"array").get();
    if(text===undefined||text===null)text=values[values.length-1];
    const original=scalarPV(text),characters=byteCharacters(original);
    const index=characters.findIndex(character=>characterCodepoint(character)===35n);
    if(index<0)return escapeNativeHtml(original);
    const part=(from:number,to:number)=>NativeString.fromFrame({
        bytes:Buffer.concat(characters.slice(from,to).map(character=>character.bytes())),utf8:original.flagged()});
    return escapeNativeHtml(concatStrings(concatStrings(part(0,index),scalarPV(n)),part(index+1,characters.length)));
}
export interface GeneralBuiltinEnvironment {
    page(): unknown;
    seesControlStrip(): unknown;
}
export function generalScalarCallbacks(environment: GeneralBuiltinEnvironment): Record<string, BuiltinFunction> {
    const alternate = new Map<string, boolean>();
    const anonymous = (): boolean => false;
    return {
        ...generalCssCallbacks(),
        _get_page: () => environment.page(),
        _get_plural_phrase:pluralPhrase,
        _eurl:(_ctx,value)=>generalEscapeUrl(value),
        _clean_url:(_ctx,input)=>{
            const value=scalarPV(input),view=value.bytes().toString("latin1");
            return /^https?:\/\/[^'"\\]*$/.test(view)?value:bytes("");
        },
        _ehtml: (_ctx, value) => escapeNativeHtml(value),
        _etags: (_ctx, value) => replaceString(replaceString(scalarPV(value),bytes("<"),bytes("&lt;")),bytes(">"),bytes("&gt;")),
        _striphtml: (_ctx, value) => stripTags(scalarPV(value)),
        _htmlattr: (ctx: Context, name, input) => {
            const value = scalarPV(input);
            if (!value.bytes().length) return bytes("");
            const lowered = caseString(scalarPV(name), "lower", ctx.scalarProfile);
            if (/[^a-z]/.test(lowered.bytes().toString("latin1"))) return bytes("");
            return concatStrings(concatStrings(concatStrings(bytes(" "), lowered), bytes("=\"")),
                concatStrings(escapeNativeHtml(value),bytes("\"")));
        },
        _alternate: (_ctx, one, two) => {
            const key = hashKeyBytes(concatStrings(concatStrings(scalarPV(one),bytes("\0")),scalarPV(two)));
            const identity = (key.utf8 ? "utf8:" : "pv:") + key.bytes.toString("hex");
            const next = !alternate.get(identity);
            alternate.set(identity, next);
            return next ? one : two;
        },
        _clean_css_classname: (_ctx, input) => {
            const value = scalarPV(input);
            return stringIndex(value,bytes("eval")) < 0 ? value :
                concatStrings(concatStrings(value,bytes(" ")),replaceString(value,bytes("eval"),bytes("ev-l")));
        },
        _set_content_type: () => {throw nativeProgramError("set_content_type is not yet implemented");},
        _viewer_logged_in: anonymous, _viewer_is_owner: anonymous, _viewer_is_friend: anonymous,
        _viewer_has_access: anonymous, _viewer_is_subscribed: anonymous, _viewer_is_member: anonymous,
        _viewer_is_admin: anonymous, _viewer_is_moderator: anonymous, _viewer_can_manage_tags: anonymous,
        _viewer_can_search: anonymous, _viewer_sees_vbox: anonymous, _viewer_sees_hbox_top: anonymous,
        _viewer_sees_hbox_bottom: anonymous, _viewer_sees_ad_box: anonymous, _viewer_sees_ebox: anonymous,
        _viewer_sees_ads: anonymous,
        _viewer_sees_control_strip: () => environment.seesControlStrip(),
    };
}
