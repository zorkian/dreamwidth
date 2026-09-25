// source.ts
//
// Bounded detection of author tokens lost or invented by HTML tree repair.
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

import {JSDOM, VirtualConsole} from "jsdom";
import {UnsupportedContent} from "./errors";
import {eatenTags} from "./inventory";
import type {LocateNode, SourceLocation} from "./cuts";

type Span = readonly [number, number];
const wrappers = new Set(["html", "body"]);
const scaffolding = new Set([...wrappers, "head", "tbody", "colgroup"]);
const tableParts = new Set("table tbody thead tfoot tr td th caption colgroup col".split(" "));
const rawtext = new Set(["textarea", "title", "script", "style", "iframe", "xmp", "noembed", "noframes", "plaintext"]);

// Run on the private, unmodified parser document, before cleaner-generated
// nodes exist. This detects lost token names in known uncovered/text spans; it
// does not tokenize HTML, reconstruct markup or confer sanitation authority.
export function auditSource(document: Document, source: string, documentUrl: string,
    locate: LocateNode, maxInputBytes: number): void {
    // A body token implicitly ends HTML5 HEAD, but clean_event keeps eating
    // until the source closes HEAD. Its covered start token alone proves no
    // safe boundary for content moved into BODY. Metadata-only EOF is harmless.
    const head = locate(document.head);
    if (head?.startTag && !head.endTag && [...document.body.childNodes].some(node =>
        node.nodeType === 1 || node.nodeType === 3 && /\S/.test(node.textContent ?? ""))) {
        throw new UnsupportedContent();
    }
    const covered: Span[] = [];
    const text: Span[] = [];
    const ignored: Span[] = [];
    const visit = (node: Node, invisible: boolean): void => {
        const location = locate(node);
        let skipText = invisible;
        if (node.nodeType === 1) {
            const element = node as Element;
            skipText ||= element.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
                eatenTags.has(element.localName) || rawtext.has(element.localName);
            if (!location && !scaffolding.has(element.localName) && !skipText) throw new UnsupportedContent();
            if (location?.startTag) covered.push([location.startTag.startOffset, location.startTag.endOffset]);
            if (location?.endTag) covered.push([location.endTag.startOffset, location.endTag.endOffset]);
            // This is an exclusion from loss classification for independently
            // eaten/foreign/rawtext content, not a claim its whole range was
            // consumed as visible markup. All normal coverage uses token spans.
            if (skipText && location) ignored.push([location.startOffset, location.endOffset]);
        } else if (location) {
            covered.push([location.startOffset, location.endOffset]);
            if (node.nodeType === 3 && !skipText) text.push([location.startOffset, location.endOffset]);
        }
        for (const child of node.childNodes) visit(child, skipText);
    };
    visit(document, false);
    covered.sort((a, b) => a[0] - b[0]);
    const gaps: Span[] = [];
    let end = 0;
    for (const span of covered) {
        if (span[0] > end) gaps.push([end, span[0]]);
        end = Math.max(end, span[1]);
    }
    if (end < source.length) gaps.push([end, source.length]);
    let helperBytes = 0;
    let helpers = 0;
    const wrapperEnd = (offset: number, spanEnd: number, tag: string): number => {
        const suffix = source.slice(offset, spanEnd);
        helperBytes += Buffer.byteLength(suffix);
        // Additional maintained parser work is bounded across the whole job:
        // at most32 helpers and four input-byte ceilings (256KiB normally).
        if (++helpers > 32 || helperBytes > 4 * maxInputBytes) throw new UnsupportedContent();
        const helper = new JSDOM(suffix, {url: documentUrl, includeNodeLocations: true,
            contentType: "text/html", virtualConsole: new VirtualConsole()});
        try {
            const wrapper = tag === "html" ? helper.window.document.documentElement : helper.window.document.body;
            const start = (helper.nodeLocation(wrapper) as SourceLocation | null)?.startTag;
            if (wrapper.localName !== tag || !start || start.startOffset !== 0 ||
                !Number.isSafeInteger(start.endOffset) || start.endOffset <= tag.length + 1 ||
                offset + start.endOffset > spanEnd || suffix[start.endOffset - 1] !== ">") {
                throw new UnsupportedContent();
            }
            return offset + start.endOffset;
        } finally { helper.window.close(); }
    };
    for (const [start, stop] of [...gaps, ...text]) {
        const slice = source.slice(start, stop);
        const prefix = /<(\/?)([A-Za-z][A-Za-z0-9:-]*)(?=[\t\n\f\r />]|$)/g;
        let match: RegExpExecArray | null;
        while ((match = prefix.exec(slice))) {
            const offset = start + match.index;
            if (ignored.some(span => span[0] <= offset && offset < span[1])) continue;
            const close = match[1] === "/";
            const name = match[2]!.toLowerCase();
            if (!close && wrappers.has(name)) {
                // A later wrapper may have no main-parser location. Ask the
                // maintained parser only for that first explicit start token's
                // quote-aware boundary, then continue scanning the same span.
                prefix.lastIndex = wrapperEnd(offset, stop, name) - start;
            } else if (!close || tableParts.has(name) || name === "form") {
                throw new UnsupportedContent();
            }
        }
    }
}
