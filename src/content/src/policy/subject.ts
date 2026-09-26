// subject.ts
//
// Separate original-source subject display and inert helper preparation.
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

import {JSDOM, VirtualConsole} from "jsdom";
import createDOMPurify from "dompurify";
import type {CleanerLimits, SubjectInput, SubjectPreparation, SubjectResult} from "../contracts";
import {UnsupportedContent} from "./errors";
import {validateInput} from "./validation";
import {auditSource} from "./source";
import type {LocateNode} from "./cuts";
import {repairFormatting} from "./formatting";
import {cleanSubjectStyle} from "./css";
import {retainedAttributeValue, resolveDocumentUrl} from "./urls";
import {entryAttributes} from "./inventory";

const allowed = new Set(["a", "b", "i", "u", "em", "strong", "cite"]);
const eaten = new Set("head title style layer iframe applet object xml param base script".split(" "));
const capabilities = new Set("lj user lj-template object embed poll poll-item poll-question site-embed".split(" "));

export function prepareSubject(input: SubjectInput, limits: CleanerLimits): SubjectResult {
    let dom: JSDOM | undefined;
    try {
        if (!input || typeof input.source !== "string" || input.source.length > 1024 ||
            Buffer.byteLength(input.source) > 1024 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.source) ||
            /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(input.source)) {
            throw new UnsupportedContent();
        }
        // Validate the same public URL/context boundary without using body
        // cleaning as the subject policy. Native subjects have a no-angle fast
        // path preserving literal entity spellings and LF, including empty/0.
        validateInput({body: input.source, format: "html_raw0", context: input.context}, limits);
        if (!/[<>]/.test(input.source)) return {kind: "ok", subject: {
            html: input.source, recentHtml: input.source, all: input.source,
        } as SubjectPreparation};
        dom = new JSDOM(input.source, {url: input.context.documentUrl,
            includeNodeLocations: true, virtualConsole: new VirtualConsole()});
        const document = dom.window.document;
        const locate: LocateNode = node => dom!.nodeLocation(node) ?? null;
        let nodes = 0;
        function check(node: Node, depth: number): void {
            if (++nodes > limits.maxNodes || depth > limits.maxDepth) throw new UnsupportedContent();
            if (node.nodeType === 1) {
                const element = node as Element;
                if (element.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
                    capabilities.has(element.localName) ||
                    /^(?:ljuser|ljvideo)$/i.test(element.getAttribute("class") ?? "")) {
                    throw new UnsupportedContent();
                }
            }
            for (const child of node.childNodes) check(child, depth + 1);
        }
        check(document.documentElement, 0);
        auditSource(document, input.source, input.context.documentUrl, locate, 1024);
        repairFormatting(document.body, locate);
        // Original text-token slices, never displayed innerText/textContent.
        // Maintained RCDATA decoding is solely a consistency proof. A source
        // gap/merged token that cannot be proved refuses rather than guessing.
        const decoder = document.createElement("textarea");
        // HTML5 discards one initial LF in these containers. Prove the
        // complete first text extent against maintained RCDATA decoding; keep
        // its original spelling for all, and restore decoded display text only
        // after all has traversed the original nodes.
        const restored = new Map<Node, string>();
        const displayNewlines: Element[] = [];
        for (const element of document.querySelectorAll("pre,textarea,listing")) {
            const location = locate(element);
            if (!location?.startTag) throw new UnsupportedContent();
            const start = location.startTag.endOffset;
            const first = element.firstChild;
            const span = first ? locate(first) : null;
            const end = span?.endOffset ?? location.endTag?.startOffset;
            if (end === undefined || end < start) throw new UnsupportedContent();
            const raw = input.source.slice(start, end);
            decoder.innerHTML = raw;
            const decoded = decoder.textContent ?? "";
            if (decoded.startsWith("\n")) {
                if (first && (first.nodeType !== 3 || !span)) throw new UnsupportedContent();
                if (decoded !== "\n" + (first?.textContent ?? "")) throw new UnsupportedContent();
                if (first) restored.set(first, raw);
                else if (raw) throw new UnsupportedContent();
                displayNewlines.push(element);
            }
        }
        const prefix = /^[\t\n\v\f\r ]*/.exec(input.source)![0];
        let all = prefix;
        function inert(node: Node): void {
            if (node.nodeType === 8) return;
            if (node.nodeType === 3) {
                const span = locate(node);
                if (!span) throw new UnsupportedContent();
                const raw = restored.get(node) ?? input.source.slice(span.startOffset, span.endOffset);
                decoder.innerHTML = raw;
                if (decoder.textContent !== (restored.has(node) ? "\n" : "") + node.textContent) throw new UnsupportedContent();
                all += (span.startOffset < prefix.length ? raw.slice(prefix.length - span.startOffset) : raw)
                    .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
                return;
            }
            if (node.nodeType !== 1) throw new UnsupportedContent();
            const element = node as Element;
            // Implicit HEAD is parser scaffolding, not a source eating token.
            // Located whitespace between eaten metadata and BODY is still an
            // original subject text token (same distinction as event metadata).
            if (eaten.has(element.localName) &&
                !(element === document.head && !locate(element)?.startTag)) return;
            for (const child of node.childNodes) inert(child);
        }
        inert(document.documentElement);
        const budget = {bytes: 0, nodes: 0};
        function transform(element: Element): void {
            for (const child of [...element.children]) {
                if (eaten.has(child.localName)) {child.remove(); continue;}
                transform(child);
                if (!allowed.has(child.localName)) child.replaceWith(...child.childNodes);
                else for (const attribute of [...child.attributes]) {
                    const name = attribute.name;
                    // Source handler attributes are removed; IDs cannot create
                    // privileged stock controls. Keep ordinary class/style.
                    if (/^(?:on|dynsrc)/i.test(name) || name === "id") {
                        child.removeAttribute(name); continue;
                    }
                    let value = retainedAttributeValue(attribute.value);
                    if (value !== null && name === "style") value = cleanSubjectStyle(value, input.context, limits, budget);
                    if (value !== null && name === "href") {
                        if (/^(?:lj|site):/i.test(value.trim())) throw new UnsupportedContent();
                        value = value.trim().startsWith("#") ? value : resolveDocumentUrl(value, input.context.documentUrl);
                    }
                    if (value === null) child.removeAttribute(name); else child.setAttribute(name, value);
                }
            }
            for (const child of [...element.childNodes]) if (child.nodeType === 8) child.remove();
        }
        const headWhitespace = !locate(document.head)?.startTag ?
            [...document.head.childNodes].filter(node=>node.nodeType===3).map(node=>{
                const span=locate(node);
                if(!span || !/^[\t\n\v\f\r ]*$/.test(node.textContent??""))throw new UnsupportedContent();
                const raw=input.source.slice(span.startOffset,span.endOffset);
                decoder.innerHTML=raw;
                if(decoder.textContent!==node.textContent)throw new UnsupportedContent();
                return span.startOffset<prefix.length?raw.slice(prefix.length-span.startOffset):raw;
            }).join("") : "";
        for (const element of displayNewlines) element.prepend(document.createTextNode("\n"));
        transform(document.body);
        if(headWhitespace)document.body.prepend(document.createTextNode(headWhitespace));
        // Full-document HTML5 parsing discards an initial ASCII whitespace
        // prefix. Restore only this source-proven prefix, never lost markup.
        if (prefix && (!document.body.firstChild ||
            (locate(document.body.firstChild)?.startOffset ?? prefix.length) >= prefix.length)) {
            document.body.prepend(document.createTextNode(prefix));
        }
        for (const attr of [...document.body.attributes]) document.body.removeAttribute(attr.name);
        const purify = createDOMPurify(dom.window);
        function sanitized(root: Element): string {
            const html = purify.sanitize(root, {ALLOWED_TAGS: [...allowed, "body", "#text"],
                ALLOWED_ATTR: [...entryAttributes], ALLOW_ARIA_ATTR: true, ALLOW_DATA_ATTR: true,
                SANITIZE_DOM: true, ALLOW_UNKNOWN_PROTOCOLS: true, KEEP_CONTENT: true,
                FORBID_TAGS: ["script", "style", "template", "svg", "math"], RETURN_TRUSTED_TYPE: false});
            if (purify.removed.length || Buffer.byteLength(html) > limits.maxOutputBytes) throw new UnsupportedContent();
            return html;
        }
        const html = sanitized(document.body);
        // Recent's remove-a operation is independent of Entry's wrapper choice.
        // It starts from the same original parsed source, before final sanitation.
        for (const anchor of [...document.body.querySelectorAll("a")]) anchor.replaceWith(...anchor.childNodes);
        const recentHtml = sanitized(document.body);
        return {kind: "ok", subject: {html, recentHtml, all} as SubjectPreparation};
    } catch (error) {
        return {kind: "failure", reason: error instanceof UnsupportedContent ? "unsupported" : "unavailable"};
    } finally {dom?.window.close();}
}
