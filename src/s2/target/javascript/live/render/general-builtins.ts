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

import type {BuiltinFunction, Context} from "../../runtime/s2runtime";
import {NativeString, scalarPV, nativeProgramError} from "../../runtime/native-scalar";
import {concatStrings, hashKeyBytes, caseString, replaceString, stringIndex} from "../../runtime/native-string";
import {escapeNativeHtml} from "./general-diagnostics";
import {generalCssCallbacks} from "./general-css-builtins";

const bytes = (value: string): NativeString => NativeString.hostUtf8Bytes(value);
function stripTags(value: NativeString): NativeString {
    // Exact source LJ/S2.pm striphtml regex, not an HTML parser or sanitizer.
    const view = value.bytes().toString("latin1").replace(/<[^\n]*?>/g, "");
    return NativeString.fromFrame({bytes: Buffer.from(view,"latin1"), utf8:value.flagged()});
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
