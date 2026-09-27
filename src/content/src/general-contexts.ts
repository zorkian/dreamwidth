// general-contexts.ts
//
// Native scalar property contexts for the credential-free general S2 worker.
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

import type {PageChunk} from "./page-output-types";
import {copyChunk, scalarView, viewChunk} from "./page-chunks";
import {cleanPageCss} from "./page-css";

/** The application supplies its qualified installed CSS hook separately. */
export function cleanGeneralCssProperty(input: PageChunk, attribute: boolean,
    transformStylesheet: (cleaned: PageChunk) => PageChunk): PageChunk {
    const original = copyChunk(input), view = scalarView(original);
    if (attribute && /[{}]/.test(view)) {
        return viewChunk("/* bad CSS: can't use braces in a style attribute */");
    }
    // LJ::CSS::Cleaner has the same screening-only prehook for both methods.
    // It changes the screening copy, never the original successful CSS value.
    const clean = cleanPageCss(view, true);
    const result = clean === view ? original : viewChunk(clean);
    return attribute ? result : copyChunk(transformStylesheet(result));
}

export function escapeGeneralPlainProperty(input: PageChunk): PageChunk {
    const chunk = copyChunk(input), pieces: Uint8Array[] = [];
    const replacements = new Map([[60, new TextEncoder().encode("&lt;")],
        [62, new TextEncoder().encode("&gt;")], [10, new TextEncoder().encode("<br />")]]);
    let length = 0, start = 0;
    for (let index = 0; index < chunk.bytes.length; index++) {
        const replacement = replacements.get(chunk.bytes[index]!);
        if (!replacement) continue;
        const preceding = chunk.bytes.subarray(start, index);
        pieces.push(preceding, replacement); length += preceding.length + replacement.length;
        start = index + 1;
    }
    const tail = chunk.bytes.subarray(start);
    pieces.push(tail); length += tail.length;
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of pieces) {bytes.set(part, offset); offset += part.length;}
    return {bytes, utf8: chunk.utf8};
}
