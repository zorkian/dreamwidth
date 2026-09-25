// metadata.ts
//
// Inert entry helper serialization inside the credential-free render worker.
//
// Text and attribute transformations adapt LJ::CleanHTML, forked from the
// LiveJournal project owned and operated by Live Journal, Inc., and modified
// and expanded by Dreamwidth Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, this code and its modifications are provided
// under the GNU General Public License. See LICENSE in this distribution.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//

import type {CleanerLimits, EntryContentInput} from "../contracts";
import {UnsupportedContent} from "./errors";
import type {LocateNode, SourceLocation} from "./cuts";
import {entryTags, eatenTags, removedTags, unsupportedRawtext} from "./inventory";
import {retainedAttributeValue, formDestination} from "./urls";
import {cleanStyle} from "./css";

const voids = new Set("area base basefont br col embed frame hr img input isindex link meta param source track wbr".split(" "));
const controls = new Set(["input", "select", "option"]);
const asciiTrim = (value: string): string => value.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, "");

function escape(value: string): string {
    return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// Source clean_event's html_casual1 text-token operation, not a parser and not
// body HTML. No generated link string here may be reinserted into a DOM. The
// caller escapes the complete helper string at the OG attribute boundary.
function text(value: string, ancestors: readonly Element[]): string {
    const tags = ancestors.map(element => element.localName);
    const raw = tags.some(tag => ["pre", "textarea", "lj-raw"].includes(tag));
    const auto = !raw && tags.filter(tag => tag === "table").length <=
        tags.filter(tag => tag === "td" || tag === "th").length;
    const links: string[] = [];
    if (auto && !tags.includes("a")) {
        value = value.replace(/https?:\/\/[^\t\n\v\f\r '\"<>]+[a-zA-Z0-9_/&=\-]/g, match => {
            const ending = /^(.*?)(&(?:#39|quot|lt|gt)(?:;.*)?)$/.exec(match);
            const url = ending ? ending[1]! : match;
            links.push(url);
            return `&url${links.length};${url}&urlend;` + (ending?.[2] ?? "");
        });
    }
    value = value.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    if (auto) {
        value = value.replace(/\r?\n/g, "<br />");
        if (!tags.includes("a")) {
            value = value.replace(/&url(\d+);(.*?)&urlend;/g, (match, number: string, label: string) => {
                const url = links[Number(number) - 1];
                // Never reinterpret author-forged placeholder syntax as one of
                // our own temporary values. Ambiguity is a typed refusal.
                if (url === undefined || label !== url) throw new UnsupportedContent();
                return `<a href="${url}">${label}</a>`;
            });
        }
    }
    const mentions = !raw && !tags.includes("code") && !ancestors.some(element =>
        element.localName === "blockquote" && element.getAttribute("class") === "twitter-tweet");
    if (mentions) {
        // The retained helper may query local/external users. This worker has no
        // such capability. Detect exactly the eligible conversion/escape domain;
        // email, attributes, eaten text and pre/code examples are not refused.
        if (/(?:^|\n)@[\w-]+(?:\.[\w.-]*[\w-])?(?=$|\W)/.test(value)) {
            throw new UnsupportedContent();
        }
        const matcher = /(\\.)|(?<=[^\w/])(@[\w-]+(?:\.[\w.-]*[\w-])?)(?=$|\W)/g;
        for (const match of value.matchAll(matcher)) {
            if (match[2] || match[1] === "\\@") throw new UnsupportedContent();
        }
    }
    return value;
}

// Retained https_url upgrade only. Literal relative metadata URL strings do not
// get the body-origin adaptation. Configured signing is not an inert-helper API.
function image(value: string, input: EntryContentInput): string {
    value = asciiTrim(value);
    const domain = /^http:\/\/[^/]*?([^.]+\.\w{2,3})\//.exec(value)?.[1];
    if (domain && (domain === input.context.urls.siteDomain ||
        input.context.urls.knownHttpsSites.includes(domain))) return value.replace(/^http:/, "https:");
    if (value.startsWith("http://") && input.context.urls.imageProxy !== "not-configured") {
        throw new UnsupportedContent();
    }
    return value;
}

// This serializer returns INERT helper text, not a BodyFragment. It traverses
// an independently parsed/audited/repaired raw document; it never consumes the
// displayed sanitized fragment. Original text slices preserve entity spellings.
export function metadataText(root: Element, input: EntryContentInput,
    limits: CleanerLimits, locate: LocateNode): string {
    const cssBudget = {bytes: 0, nodes: 0};
    const context = {...input.context, reader: {removeColors: false, removeSizes: false,
        removeFonts: false, maxImageWidth: null, maxImageHeight: null,
        placeholderUndefinedImageSize: false, extractImages: false}};
    const parts: string[] = [];
    let bytes = 0;
    // Document parsing may discard leading whitespace before BODY exists.
    // Unlike body display, event_text transforms LF even in that prefix. This
    // is only an ASCII-whitespace prefix, not HTML tokenization or a whole-gap
    // waiver. If its bytes also occur in a located text node, emit them once.
    const prefix = /^[\t\n\v\f\r ]*/.exec(input.body)![0];
    const document = root.ownerDocument;
    const wrapperEnds = [document.documentElement, document.head, document.body]
        .flatMap(element => locate(element)?.endTag ? [locate(element)!.endTag!] : [])
        .sort((a, b) => a.startOffset - b.startOffset);
    for (const [i, span] of wrapperEnds.entries()) {
        if (!Number.isSafeInteger(span.startOffset) || !Number.isSafeInteger(span.endOffset) ||
            span.startOffset < 0 || span.endOffset <= span.startOffset || span.endOffset > input.body.length ||
            i > 0 && wrapperEnds[i - 1]!.endOffset > span.startOffset) throw new UnsupportedContent();
    }
    const decoder = document.createElement("textarea");
    let proofBytes = 0;
    function sourceText(node: Node, location: SourceLocation): string {
        const fragments: string[] = [];
        let start = location.startOffset;
        for (const span of wrapperEnds) {
            if (span.endOffset <= start || span.startOffset >= location.endOffset) continue;
            if (span.startOffset < start || span.endOffset > location.endOffset) throw new UnsupportedContent();
            fragments.push(input.body.slice(start, span.startOffset));
            start = span.endOffset;
        }
        fragments.push(input.body.slice(start, location.endOffset));
        const raw = fragments.join("");
        proofBytes += Buffer.byteLength(raw);
        if (proofBytes > 2 * limits.maxInputBytes) throw new UnsupportedContent();
        // Maintained RCDATA decoding is a consistency proof only, never the
        // source of helper output. An unlocated ignored close can share a text
        // extent; it cannot be guessed/subtracted from raw entity-preserving text.
        decoder.innerHTML = raw;
        let equal = decoder.textContent === node.textContent;
        const parent = node.parentElement;
        const contentStart = parent ? locate(parent)?.startTag?.endOffset : undefined;
        // HTML5 discards one initial LF in pre/textarea. Some text locations
        // include that discarded byte (notably double LF), others start after
        // it. This path is only the included case; output retains raw bytes.
        if (!equal && parent && ["pre", "textarea"].includes(parent.localName) &&
            parent.firstChild === node && contentStart === location.startOffset && /^\r?\n/.test(raw)) {
            decoder.innerHTML = raw.slice(raw.startsWith("\r\n") ? 2 : 1);
            equal = decoder.textContent === node.textContent;
        }
        decoder.textContent = "";
        if (!equal) throw new UnsupportedContent();
        return location.startOffset < prefix.length ? raw.slice(prefix.length - location.startOffset) : raw;
    }
    function emit(value: string): void {
        bytes += Buffer.byteLength(value);
        if (bytes > limits.maxOutputBytes) throw new UnsupportedContent();
        parts.push(value);
    }
    function visit(node: Node, ancestors: readonly Element[]): void {
        if (node.nodeType === 8) return;
        const location = locate(node);
        if (node.nodeType === 3) {
            if (!location) throw new UnsupportedContent();
            emit(text(sourceText(node, location), ancestors));
            return;
        }
        if (node.nodeType !== 1) throw new UnsupportedContent();
        const element = node as Element;
        const tag = element.localName;
        const children = (): void => { for (const child of element.childNodes) visit(child, [...ancestors, element]); };
        if (tag === "head" && !location?.startTag) {
            // An implicit HEAD is parser scaffolding: source whitespace between
            // independently eaten metadata tags still belongs to event_text.
            for (const child of element.childNodes) {
                if (child.nodeType === 3 && !/^[\t\n\v\f\r ]*$/.test(child.textContent ?? "")) {
                    throw new UnsupportedContent();
                }
                visit(child, ancestors);
            }
            return;
        }
        if (eatenTags.has(tag) || element.namespaceURI !== "http://www.w3.org/1999/xhtml") return;
        if (removedTags.has(tag)) { children(); return; }
        const htmlWrapper = element === document.documentElement;
        if (htmlWrapper && !location?.startTag) { children(); return; }
        if (unsupportedRawtext.has(tag) || !entryTags.has(tag) && !htmlWrapper ||
            ["ljuser", "ljvideo"].includes(element.getAttribute("class")?.toLowerCase() ?? "")) {
            throw new UnsupportedContent();
        }
        // These containers are harmless HTML5 scaffolding, not source helper
        // tokens. Do not invent them in the inert retained representation.
        if (!location && ["tbody", "colgroup"].includes(tag)) { children(); return; }
        if (!location?.startTag) throw new UnsupportedContent();
        if (controls.has(tag) && !ancestors.some(parent => parent.localName === "form")) {
            emit(`&lt;${tag} ... &gt;`); children();
            if (location.endTag) emit(`&lt;/${tag}&gt;`);
            return;
        }
        let opening = "<" + tag;
        const attrs = (location as SourceLocation & {
            attrs?: Record<string, {startOffset: number; endOffset: number}>;
        }).attrs;
        for (const attribute of element.attributes) {
            const name = attribute.name;
            if (name === "id" || name === "data" || /^(?:on|dynsrc)/.test(name) ||
                name === "type" && element.hasAttribute("data")) continue;
            if (!/^[\w_:-]+$/.test(name)) throw new UnsupportedContent();
            let value: string | null = attribute.value;
            const span = attrs?.[name];
            if (!span) throw new UnsupportedContent();
            // Boolean HTML::Parser attributes have their name as value. The
            // maintained parser supplies the entire quote-aware attribute span.
            if (!input.body.slice(span.startOffset, span.endOffset).includes("=")) value = name;
            value = retainedAttributeValue(value);
            if (value === null) continue;
            if (tag === "input" && name === "type" && (!/^\w+$/.test(value) || /^password$/i.test(value))) continue;
            if (tag === "form" && name === "action") {
                value = formDestination(value, input.context.urls.formDomainBanned);
                if (value === null) continue;
            }
            if (name === "style") {
                value = cleanStyle(value, context, limits, cssBudget, false);
                if (value === null) continue;
            }
            if (name === "href") {
                if (/^(?:lj|site):/i.test(value)) throw new UnsupportedContent();
                value = asciiTrim(value);
            }
            if (tag === "img" && name === "src") value = image(value, input);
            if (tag === "img" && name === "srcset") {
                value = value.replace(/\bhttp:\/\/\S+/g, url => image(url, input));
            }
            opening += ` ${name}="${escape(value)}"`;
        }
        const start = input.body.slice(location.startTag.startOffset, location.startTag.endOffset);
        emit(opening + (voids.has(tag) && /\/\s*>$/.test(start) ? " />" : ">"));
        if (tag === "pre" || tag === "textarea") {
            const next = element.firstChild ? locate(element.firstChild)?.startOffset : location.endTag?.startOffset;
            if (next !== undefined && next > location.startTag.endOffset) {
                const gap = input.body.slice(location.startTag.endOffset, next);
                // Mutually exclusive with the text-extent case: this newline is
                // absent from every child location. No markup/unknown gap is
                // interpreted as whitespace, and no later newline is repaired.
                if (gap === "\n" || gap === "\r\n") emit(gap);
                else throw new UnsupportedContent();
            } else if (next === undefined && /^\r?\n/.test(input.body.slice(location.startTag.endOffset))) {
                throw new UnsupportedContent();
            }
        }
        children();
        if (!voids.has(tag)) emit(`</${tag}>`);
    }
    emit(text(prefix, []));
    // HTML-direct whitespace is outside BODY but source-visible to clean_event.
    // There is no whole-gap scan or transparent explicit HEAD exception.
    for (const node of document.documentElement.childNodes) {
        if (node.nodeType === 3 && !/^[\t\n\v\f\r ]*$/.test(node.textContent ?? "")) {
            throw new UnsupportedContent();
        }
    }
    visit(document.documentElement, []);
    return parts.join("");
}
