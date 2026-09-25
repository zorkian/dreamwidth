// newlines.ts
//
// Preserve source-proved initial preformatted newlines through serialization.
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

import type {LocateNode} from "./cuts";
import {UnsupportedContent} from "./errors";

export function initialNewlines(root: Element, source: string, locate: LocateNode,
    maxInputBytes: number): () => void {
    // Capture source boundaries before comment/eaten-content removal. A first
    // surviving LF does not prove the parser discarded an initial newline.
    const candidates = [...root.querySelectorAll("pre,textarea")].map(element => ({
        element, location: locate(element), first: element.firstChild,
        firstLocation: element.firstChild ? locate(element.firstChild) : null,
        firstText: element.firstChild?.nodeType === 3 ? element.firstChild.textContent : null,
    }));
    return () => {
        const decoder = root.ownerDocument.createElement("textarea");
        let proofBytes = 0;
        const decode = (start: number, end: number): string => {
            if (end < start || end > source.length) throw new UnsupportedContent();
            const raw = source.slice(start, end);
            proofBytes += Buffer.byteLength(raw);
            if (proofBytes > 2 * maxInputBytes) throw new UnsupportedContent();
            decoder.innerHTML = raw;
            const decoded = decoder.textContent ?? "";
            decoder.textContent = "";
            return decoded;
        };
        try {
            for (const {element, location, first, firstLocation, firstText} of candidates) {
                // Hidden Recent cuts and eaten subtrees have no displayed body
                // requiring repair, and acquire no additional proof refusal.
                if (!root.contains(element)) continue;
                if (!location?.startTag) throw new UnsupportedContent();
                const start = location.startTag.endOffset;
                const leading = source[start];
                let discarded = leading === "\n" || leading === "\r";
                if (leading === "&") {
                    // Character-reference LFs also take the HTML initial-LF
                    // branch. Decode only a source-located first extent/gap as
                    // an inert consistency proof, never as replacement output.
                    // Starting at startTag.endOffset handles maintained-parser
                    // locations that omit part of the first following entity.
                    const next = first ? firstLocation?.startOffset :
                        location.endTag?.startOffset ?? location.endOffset;
                    if (next === undefined || next < start) throw new UnsupportedContent();
                    const gap = next > start ? decode(start, next) : "";
                    if (gap === "\n") discarded = true;
                    else if (firstText !== null && firstLocation) {
                        const decoded = decode(start, firstLocation.endOffset);
                        if (decoded.startsWith("\n")) {
                            if (decoded !== "\n" + firstText) throw new UnsupportedContent();
                            discarded = true;
                        }
                    } else if (gap.startsWith("\n")) {
                        throw new UnsupportedContent();
                    }
                }
                if (discarded) {
                    // HTML parsing normalizes CR/CRLF to LF and drops exactly
                    // one initial LF here. Reinsert its serialized equivalent
                    // BEFORE DOMPurify, so browser insertion consumes it once.
                    // This is not a raw post-sanitizer markup substitution.
                    element.prepend(root.ownerDocument.createTextNode("\n"));
                }
            }
        } finally { decoder.textContent = ""; }
    };
}
