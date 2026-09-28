// general-diagnostics.ts
//
// Encoded native program diagnostics without infrastructure stack disclosure.
//
// Portions adapted from LJ::User::Account and LJ::S2, forked from the
// LiveJournal project owned and operated by Live Journal, Inc., and modified
// and expanded by Dreamwidth Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, the adapted portions and their modifications
// are provided under the GNU General Public License. See LICENSE in this distribution.
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

import {NativeString, scalarPV, isNativeProgramError, nativeExecutionStopKind} from "../../runtime/native-scalar";
import {concatStrings} from "../../runtime/native-string";
import type {GeneralRunFailure} from "./general-session";

const bytes = (value: string): NativeString => NativeString.hostUtf8Bytes(value);

/** LJ::ehtml substitutions on PV bytes; the original scalar flag is retained. */
export function escapeNativeHtml(input: unknown): NativeString {
    const value = scalarPV(input);
    const replacement = new Map<number, string>([[38, "&amp;"], [34, "&quot;"],
        [39, "&#39;"], [60, "&lt;"], [62, "&gt;"]]);
    const parts: Buffer[] = [];
    let start = 0;
    const original = value.bytes();
    for (let offset = 0; offset < original.length; offset++) {
        const next = replacement.get(original[offset]!);
        if (next === undefined) continue;
        parts.push(original.subarray(start, offset), Buffer.from(next));
        start = offset + 1;
    }
    parts.push(original.subarray(start));
    return NativeString.fromFrame({bytes: Buffer.concat(parts), utf8: value.flagged()});
}
function errorText(error: Error | NativeString): NativeString {
    if (NativeString.is(error)) return error;
    if (!isNativeProgramError(error) && !nativeExecutionStopKind(error)) throw error;
    // Installed source registration metadata uses a reversible byte
    // view. Semantic error messages interpolate that metadata, not JS stacks.
    return NativeString.bytes(Buffer.from(error.message, "latin1"));
}
const deadlineTemplate = "Style code didn't finish running in a timely fashion.  " +
    "Possible causes: <ul><li>Infinite loop in style or layer</li>\n<li>Database busy</li></ul>\n";

export function preparationDiagnostic(error: Error | NativeString, signature?: "prop_init()" | "modules_init()"): NativeString {
    const kind = NativeString.is(error) ? undefined : nativeExecutionStopKind(error);
    if (kind === "deadline") return concatStrings(bytes("<b>Error preparing to run:</b> "), bytes(deadlineTemplate));
    const text = kind === "recursion" ? bytes((signature ? "Died in S2::run_code running " + signature + ": " : "") +
        "Excessive recursion detected and stopped.\n" + (signature ? "\n" : "")) : errorText(error);
    return concatStrings(bytes("<b>Error preparing to run:</b> "), escapeNativeHtml(text));
}
export function renderDiagnostic(failure: GeneralRunFailure): NativeString {
    // Source S2.pm473 owns this fixed trusted template; author text never gains
    // template authority merely by resembling its wording.
    if (failure.kind === "deadline") return concatStrings(bytes("<b>Error running style:</b> "), bytes(deadlineTemplate.replaceAll("\n", "<br />\n")));
    const text = failure.kind === "recursion" ? bytes("Died in S2::run_code running " + failure.signature + ": Excessive recursion detected and stopped.\n\n") : errorText(failure.error);
    const escaped = escapeNativeHtml(text);
    const original = escaped.bytes(), parts: Buffer[] = [];
    let start = 0;
    for (let offset = 0; offset < original.length; offset++) if (original[offset] === 10) {
        parts.push(original.subarray(start, offset), Buffer.from("<br />\n"));
        start = offset + 1;
    }
    parts.push(original.subarray(start));
    return concatStrings(bytes("<b>Error running style:</b> "),
        NativeString.fromFrame({bytes: Buffer.concat(parts), utf8: escaped.flagged()}));
}
