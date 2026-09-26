// index.ts
//
// Reusable html_raw0 entry cleaning in a bounded credential-free worker.
//
// Entry transformation portions adapt LJ::CleanHTML, forked from the LiveJournal
// project owned and operated by Live Journal, Inc., and modified and expanded by
// Dreamwidth Studios, LLC. The original license is available at:
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
import {createHash} from "node:crypto";
import type {BodyFragment, CleanerLimits, EntryCleaner, EntryContentInput,
    EntryContentResult, EntryMetadataInput, EntryMetadataResult, ImageResolutionSet} from "./contracts";
import {prepareSubject} from "./policy/subject";
import {UnsupportedContent} from "./policy/errors";
import {validateCleanerLimits, validateInput, validateMetadataInput, inputHash} from "./policy/validation";
import {auditSource} from "./policy/source";
import {repairFormatting} from "./policy/formatting";
import {replaceCuts, type LocateNode} from "./policy/cuts";
import {ImagePass, parseSrcset} from "./policy/images";
import {cleanStyle} from "./policy/css";
import {metadataText} from "./policy/metadata";
import {initialNewlines} from "./policy/newlines";
import {formDestination, resolveDocumentUrl, retainedAttributeValue} from "./policy/urls";
import {entryTags, entryAttributes, eatenTags, removedTags, unsupportedRawtext, discardedHeadTags,
    ordinaryAttribute, externalControlAttributes} from "./policy/inventory";

const media = new Set(["audio", "video", "source", "track"]);
const applicationTags = new Set(["lj", "user", "poll", "poll-item", "poll-question", "raw-code", "site-embed"]);
const controls = new Set(["input", "select", "option"]);
const hrefTags = new Set(["a", "area"]);
const citeTags = new Set(["blockquote", "q", "del", "ins"]);
const backgrounds = new Set(["table", "td", "th"]);

function checkTree(root: Element, limits: CleanerLimits, extraRoot?: Element): void {
    let nodes = 0;
    const visit = (node: Node, depth: number): void => {
        if (++nodes > limits.maxNodes || depth > limits.maxDepth) throw new UnsupportedContent();
        for (const child of node.childNodes) visit(child, depth + 1);
    };
    for (const child of root.childNodes) visit(child, 1);
    if (extraRoot) for (const child of extraRoot.childNodes) visit(child, 1);
}

function inventoryHead(head: Element): void {
    for (const node of head.childNodes) {
        if (node.nodeType === 8 || node.nodeType === 3 && !node.textContent?.trim()) continue;
        if (node.nodeType !== 1) throw new UnsupportedContent();
        const element = node as Element;
        if (element.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
            !discardedHeadTags.has(element.localName)) throw new UnsupportedContent();
        // With scripting disabled, a head noscript may contain only metadata;
        // any visible body content is separately moved into the body by parsing.
        // Verify its children rather than silently swallowing arbitrary contents.
        if (element.localName === "noscript") inventoryHead(element);
    }
}

function removeSourceComments(root: Node): void {
    // clean_event does not enable keepcomments (CleanHTML.pm1326). Apply that
    // named source transform before auditing any additional sanitizer removals.
    for (const node of [...root.childNodes]) {
        if (node.nodeType === 8) root.removeChild(node);
        else removeSourceComments(node);
    }
}

function navigation(value: string, input: EntryContentInput, href: boolean): string {
    const clean = value.trim();
    if (href && clean.startsWith("#")) return clean;
    if (/^(?:lj|site):/i.test(clean)) {
        // Source application pseudo-URLs need their own expansion policy; never
        // pass them to a browser as a registered external application scheme.
        throw new UnsupportedContent();
    }
    return resolveDocumentUrl(clean, input.context.documentUrl);
}

function transform(root: Element, input: EntryContentInput, limits: CleanerLimits,
    images: ImagePass, generatedIds: ReadonlySet<string>, locate: LocateNode): void {
    const cssBudget = {bytes: 0, nodes: 0};
    const document = root.ownerDocument;
    for (const element of [...root.querySelectorAll("*")]) {
        if (!root.contains(element)) continue;
        const tag = element.localName;
        if (element.namespaceURI !== "http://www.w3.org/1999/xhtml" || eatenTags.has(tag)) {
            element.remove();
            continue;
        }
        if (unsupportedRawtext.has(tag) || media.has(tag) || applicationTags.has(tag) || tag === "template" || /^lj-/.test(tag) ||
            ["ljuser", "ljvideo"].includes(element.getAttribute("class")?.toLowerCase() ?? "")) {
            throw new UnsupportedContent();
        }
        if (removedTags.has(tag)) { element.replaceWith(...element.childNodes); continue; }
        if (!entryTags.has(tag)) throw new UnsupportedContent();
        if (controls.has(tag) && !element.closest("form")) {
            // Outside a form, clean_event displays both actual source tokens.
            // An implicit parser close must not invent a visible closing token.
            const ending = locate(element)?.endTag ? [document.createTextNode(`</${tag}>`)] : [];
            element.replaceWith(document.createTextNode(`<${tag} ... >`), ...element.childNodes, ...ending);
            continue;
        }
        if (tag === "input") {
            const type = element.getAttribute("type") ?? "";
            if (!/^\w+$/.test(type) || type.toLowerCase() === "password") element.removeAttribute("type");
        }
        if (element.hasAttribute("data")) {
            element.removeAttribute("data");
            element.removeAttribute("type");
        }
        for (const attribute of [...element.attributes]) {
            const name = attribute.name;
            if (/^(?:on|dynsrc)/.test(name) || ["srcdoc", "ping", "xmlns", "xlink:href"].includes(name) ||
                name === "id" && !generatedIds.has(attribute.value)) {
                element.removeAttribute(name);
                continue;
            }
            if (externalControlAttributes.has(name) || !ordinaryAttribute(name)) {
                throw new UnsupportedContent();
            }
            const value = retainedAttributeValue(attribute.value);
            if (value === null) { element.removeAttribute(name); continue; }
            if (input.context.reader.removeColors && ["color", "bgcolor", "fgcolor", "text"].includes(name) ||
                input.context.reader.removeSizes && name === "size" ||
                input.context.reader.removeFonts && name === "face") {
                element.removeAttribute(name); continue;
            }
            if (name === "style") {
                const style = cleanStyle(value, input.context, limits, cssBudget);
                if (style === null) element.removeAttribute(name);
                else element.setAttribute(name, style);
                continue;
            }
            element.setAttribute(name, value);
        }
        for (const name of ["action", "formaction"]) {
            if (name === "action" ? tag !== "form" : !["button", "input"].includes(tag)) continue;
            const value = element.getAttribute(name);
            if (value === null) continue;
            const admitted = formDestination(value, input.context.urls.formDomainBanned);
            if (admitted === null) element.removeAttribute(name);
            else element.setAttribute(name, navigation(admitted, input, false));
        }
        for (const name of ["href", "src", "cite", "longdesc", "background", "usemap"]) {
            const value = element.getAttribute(name);
            if (value === null) continue;
            if (name === "usemap") {
                if (tag !== "img" || !/^#[^\s#]+$/.test(value)) throw new UnsupportedContent();
                continue;
            }
            if (tag === "img" && name === "src") {
                element.setAttribute(name, images.resolve(element, "src", value));
                continue;
            }
            const allowed = name === "href" && hrefTags.has(tag) ||
                name === "src" && tag === "input" && element.getAttribute("type")?.toLowerCase() === "image" ||
                name === "cite" && citeTags.has(tag) || name === "longdesc" && tag === "img" ||
                name === "background" && backgrounds.has(tag);
            if (!allowed) throw new UnsupportedContent();
            element.setAttribute(name, navigation(value, input, name === "href"));
        }
        if (element.hasAttribute("srcset")) {
            if (tag !== "img") throw new UnsupportedContent();
            const original = element.getAttribute("srcset")!;
            const candidates = parseSrcset(original);
            let changed = false;
            for (const candidate of candidates) {
                const next = images.resolve(element, "srcset", candidate.url);
                changed ||= next !== candidate.url;
                candidate.url = next;
            }
            if (changed) element.setAttribute("srcset", candidates.map(candidate =>
                candidate.url + (candidate.descriptor ? " " + candidate.descriptor : "")).join(", "));
        }
        if (tag === "img") {
            const reader = input.context.reader;
            const width = element.getAttribute("width");
            const height = element.getAttribute("height");
            if (reader.extractImages || reader.placeholderUndefinedImageSize && (width === null || height === null) ||
                reader.maxImageWidth !== null && Number.parseFloat(width ?? "") > reader.maxImageWidth ||
                reader.maxImageHeight !== null && Number.parseFloat(height ?? "") > reader.maxImageHeight) {
                const descriptor = input.context.imagePlaceholder;
                const link = document.createElement("a");
                link.className = "ljimgplaceholder";
                link.setAttribute("href", element.getAttribute("src") ?? "");
                const image = document.createElement("img");
                image.setAttribute("src", navigation(descriptor.src, input, false));
                for (const name of ["width", "height", "alt", "title"] as const) {
                    image.setAttribute(name, String(descriptor[name]));
                }
                image.setAttribute("border", "0");
                link.append(image);
                element.replaceWith(link);
                continue;
            }
        }
        if (input.context.reader.removeSizes && /^h[1-6]$/.test(tag)) {
            element.replaceWith(...element.childNodes);
        }
    }
}

// html_casual1 autolinks and breaks are a distinct original-source operation.
function casualText(root:Element,source:string):void {
    if(/^\s*!markdown\s*\r?\n/i.test(source))throw new UnsupportedContent();
    if(/(^|[^\w/])@([\w-]+)(?:\.[\w.-]*[\w-])?(?=$|\W)/m.test(source.replace(/\\./g,'')))throw new UnsupportedContent();
    if(root.querySelector('lj-cut,lj-raw,lj,user,poll,site-embed'))throw new UnsupportedContent();
    for(const element of root.querySelectorAll('*'))for(const attribute of element.attributes) {
        if(/[\r\n]/.test(attribute.value))throw new UnsupportedContent();
    }
    const document=root.ownerDocument;
    const walker=document.createTreeWalker(root,4);
    const nodes:Text[]=[];
    while(walker.nextNode())nodes.push(walker.currentNode as Text);
    for(const node of nodes) {
        let value=node.data;
        // Match actual reached mention contexts, not email or every at-sign.
        if(/(^|[^\w/])@([\w-]+)(?:\.[\w.-]*[\w-])?(?=$|\W)/m.test(value.replace(/\\./g,''))) {
            throw new UnsupportedContent();
        }
        value=value.replace(/\\@/g,'@');
        const parent=node.parentElement!;
        const raw=parent.closest('pre,textarea');
        const table=parent.closest('table');
        const cell=parent.closest('td,th');
        if(raw || table && (!cell || !table.contains(cell))) {node.data=value;continue;}
        const fragment=document.createDocumentFragment();
        const pattern=parent.closest('a')?/\r?\n/g:/https?:\/\/[^\s'"<>]+[a-zA-Z0-9_/&=\-]|\r?\n/g;
        let offset=0;
        for(const match of value.matchAll(pattern)) {
            fragment.append(document.createTextNode(value.slice(offset,match.index)));
            if(match[0].includes('\n'))fragment.append(document.createElement('br'));
            else {const anchor=document.createElement('a');anchor.setAttribute('href',match[0]);anchor.textContent=match[0];fragment.append(anchor);}
            offset=match.index!+match[0].length;
        }
        fragment.append(document.createTextNode(value.slice(offset)));
        node.replaceWith(fragment);
    }
}

export function createEntryCleaner(limits: CleanerLimits): EntryCleaner {
    validateCleanerLimits(limits);
    const bounds = Object.freeze({...limits});
    let closed = false;
    const clean = (input: EntryContentInput, resolutions?: ImageResolutionSet, casual = false): EntryContentResult => {
            if (closed) return {kind: "failure", reason: "unavailable"};
            let dom: JSDOM | undefined;
            try {
                validateInput(input, bounds);
                const hash = inputHash(input);
                // No runScripts, resources, fromURL or caller DOM. This worker is
                // also denied network/files/children by the outer kernel/runtime
                // boundary; DOMPurify is not treated as a resource-privacy tool.
                dom = new JSDOM(input.body, {url: input.context.documentUrl,
                    includeNodeLocations: true, contentType: "text/html",
                    // Parser diagnostics must not log raw author markup. Failures
                    // use the typed result below, not jsdom's ambient console.
                    virtualConsole: new VirtualConsole()});
                const root = dom.window.document.body;
                checkTree(root, bounds, dom.window.document.head);
                auditSource(dom.window.document, input.body, input.context.documentUrl,
                    node => dom!.nodeLocation(node) ?? null, bounds.maxInputBytes);
                inventoryHead(dom.window.document.head);
                const restoreNewlines = initialNewlines(root, input.body,
                    node => dom!.nodeLocation(node) ?? null, bounds.maxInputBytes);
                removeSourceComments(root);
                repairFormatting(root, node => dom!.nodeLocation(node) ?? null);
                if(casual) {
                    // Full-document parsing discards a source-leading ASCII
                    // whitespace token. This context formats its LF visibly;
                    // it does not inherit the entry-body whitespace adaptation.
                    const prefix=/^[\t\n\v\f\r ]*/.exec(input.body)![0];
                    const first=root.firstChild;
                    if(prefix) {
                        const location=first?dom!.nodeLocation(first):null;
                        if(first&&(!location||location.startOffset<prefix.length))throw new UnsupportedContent();
                        root.insertBefore(dom.window.document.createTextNode(prefix),first);
                    }
                    casualText(root,input.body);
                }
                // Source body wrappers are removed by clean_event, including all
                // their attributes. The private BODY remains only as context.
                for (const attribute of [...root.attributes]) root.removeAttribute(attribute.name);
                for (const element of root.querySelectorAll("[id]")) element.removeAttribute("id");
                const ids = replaceCuts(root, input.context, node => dom!.nodeLocation(node) ?? null, bounds.maxCuts);
                const images = new ImagePass(input, hash, bounds, node => dom!.nodeLocation(node) ?? null, resolutions);
                transform(root, input, bounds, images, ids, node => dom!.nodeLocation(node) ?? null);
                restoreNewlines();
                images.finish();
                if (images.requests.length && !resolutions) {
                    return {kind: "image-resolution-required", images: {inputSha256: hash, requests: images.requests}};
                }
                checkTree(root, bounds);
                const purify = createDOMPurify(dom.window);
                // Match SANITIZE_DOM's collision predicate against an empty
                // inert document and form, never against author-defined names.
                const collisionDocument = dom.window.document.createElement("template").content.ownerDocument;
                const collisionForm = collisionDocument.createElement("form");
                purify.addHook("uponSanitizeAttribute", (_node, data) => {
                    if (data.attrName === "id" && !ids.has(data.attrValue)) data.keepAttr = false;
                });
                // Final operation on markup. No later string replacement or raw
                // substitution may invalidate this body-context sanitation.
                let html = purify.sanitize(root, {
                    // The non-IN_PLACE node path deep-clones this private BODY.
                    // Do not reparse transformed markup as a new document.
                    ALLOWED_TAGS: [...entryTags, "#text", "body"], ALLOWED_ATTR: [...entryAttributes],
                    ALLOW_ARIA_ATTR: true, ALLOW_DATA_ATTR: true, KEEP_CONTENT: true,
                    SANITIZE_DOM: true, ALLOW_UNKNOWN_PROTOCOLS: true,
                    FORBID_TAGS: ["style", "script", "svg", "math", "template", "iframe", "object", "embed"],
                    RETURN_TRUSTED_TYPE: false,
                });
                purify.removeAllHooks();
                // Maintained sanitizer defenses remain enabled. Their extra
                // removals cannot silently become successful compatibility loss.
                // Only the precise, documented name-clobber predicate is exempt;
                // no source element/text removal or arbitrary attribute is.
                for (const removal of purify.removed) {
                    if ("attribute" in removal && removal.attribute?.name === "name" &&
                        removal.attribute.namespaceURI === null && removal.from.nodeType === 1 &&
                        (removal.from as Element).namespaceURI === "http://www.w3.org/1999/xhtml") {
                        const value = removal.attribute.value.trim();
                        if (value in collisionDocument || value in collisionForm) continue;
                    }
                    throw new UnsupportedContent();
                }
                if(casual) html=html.replaceAll("\n","<br />");
                if (Buffer.byteLength(html) > bounds.maxOutputBytes) throw new UnsupportedContent();
                return {kind: "ok", fragment: {context: "html-div-flow", html} as BodyFragment,
                    provenance: {policy: input.context.policy, inputSha256: hash,
                        outputSha256: createHash("sha256").update(html).digest("hex"), cutsOmitted: ids.size / 2}};
            } catch (error) {
                return {kind: "failure", reason: error instanceof UnsupportedContent ? "unsupported" : "unavailable"};
            } finally { dom?.window.close(); }
        };
    return {
        clean,
        customtext(input) {
            const result=clean({body:input.source,format:'html_raw0',context:input.context},undefined,true);
            if(result.kind==='ok')return {kind:'ok',html:result.fragment.html};
            if(result.kind==='failure')return result;
            return {kind:'failure',reason:'unsupported'};
        },
        subject(input) {
            if (closed) return {kind: "failure", reason: "unavailable"};
            return prepareSubject(input, bounds);
        },
        metadata(input: EntryMetadataInput): EntryMetadataResult {
            if (closed) return {kind: "failure", reason: "unavailable"};
            let dom: JSDOM | undefined;
            try {
                validateMetadataInput(input, bounds);
                const entry = input.entry;
                // Independent RAW-input parse; never derive helper strings from
                // the displayed fragment. No scripts/resources or ambient console.
                dom = new JSDOM(entry.body, {url: entry.context.documentUrl,
                    includeNodeLocations: true, contentType: "text/html",
                    virtualConsole: new VirtualConsole()});
                const root = dom.window.document.body;
                checkTree(root, bounds, dom.window.document.head);
                auditSource(dom.window.document, entry.body, entry.context.documentUrl,
                    node => dom!.nodeLocation(node) ?? null, bounds.maxInputBytes);
                inventoryHead(dom.window.document.head);
                // Keep comment locations for first-child/source-gap proof. The
                // inert serializer skips comments without moving that boundary.
                repairFormatting(root, node => dom!.nodeLocation(node) ?? null);
                replaceCuts(root, entry.context, node => dom!.nodeLocation(node) ?? null,
                    bounds.maxCuts, true);
                return {kind: "ok", metadata: {kind: "inert-entry-metadata",
                    subjectText: (() => {
                        const result = prepareSubject({source: input.subject, context: entry.context}, bounds);
                        if (result.kind !== "ok") throw new UnsupportedContent();
                        return result.subject.all;
                    })(),
                    eventText: metadataText(root, entry, bounds, node => dom!.nodeLocation(node) ?? null)}};
            } catch (error) {
                return {kind: "failure", reason: error instanceof UnsupportedContent ? "unsupported" : "unavailable"};
            } finally { dom?.window.close(); }
        },
        close() { closed = true; },
    };
}
