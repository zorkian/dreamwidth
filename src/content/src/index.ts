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

import {JSDOM} from "jsdom";
import createDOMPurify from "dompurify";
import {createHash} from "node:crypto";
import type {BodyFragment, CleanerLimits, EntryCleaner, EntryContentInput,
    EntryContentResult, ImageResolutionSet} from "./contracts";
import {UnsupportedContent} from "./policy/errors";
import {validateCleanerLimits, validateInput, inputHash} from "./policy/validation";
import {replaceCuts} from "./policy/cuts";
import {ImagePass, parseSrcset} from "./policy/images";
import {cleanStyle} from "./policy/css";
import {formDestination, resolveDocumentUrl, retainedAttributeValue} from "./policy/urls";

const eaten = new Set(["head", "title", "style", "layer", "iframe", "applet", "object", "xml",
    "param", "base", "script"]);
const removed = new Set(["bgsound", "embed", "link", "body", "meta", "noscript", "plaintext", "noframes"]);
const media = new Set(["audio", "video", "source", "track"]);
const applicationTags = new Set(["lj", "user", "poll", "poll-item", "poll-question", "raw-code", "site-embed"]);
const controls = new Set(["input", "select", "option"]);
const hrefTags = new Set(["a", "area"]);
const citeTags = new Set(["blockquote", "q", "del", "ins"]);
const backgrounds = new Set(["table", "td", "th"]);
const safeUri = /^(?:(?:https?|ftp|ftps|mailto|tel|callto|sms|cid|xmpp|irc|ircs|news|nntp|webcal):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i;

function checkTree(root: Element, limits: CleanerLimits, extraRoot?: Element): void {
    let nodes = 0;
    const visit = (node: Node, depth: number): void => {
        if (++nodes > limits.maxNodes || depth > limits.maxDepth) throw new UnsupportedContent();
        for (const child of node.childNodes) visit(child, depth + 1);
    };
    for (const child of root.childNodes) visit(child, 1);
    if (extraRoot) for (const child of extraRoot.childNodes) visit(child, 1);
}

function navigation(value: string, input: EntryContentInput, href: boolean): string {
    const clean = value.trim();
    if (href && clean.startsWith("#")) return clean;
    if (/^(?:lj|site):/i.test(clean)) {
        // Source application pseudo-URLs need their own expansion policy; never
        // pass them to a browser as a registered external application scheme.
        throw new UnsupportedContent();
    }
    if (!safeUri.test(clean)) throw new UnsupportedContent();
    return resolveDocumentUrl(clean, input.context.documentUrl);
}

function transform(root: Element, input: EntryContentInput, limits: CleanerLimits,
    images: ImagePass, generatedIds: ReadonlySet<string>): void {
    const cssBudget = {bytes: 0, nodes: 0};
    const document = root.ownerDocument;
    for (const element of [...root.querySelectorAll("*")]) {
        if (!root.contains(element)) continue;
        const tag = element.localName;
        if (element.namespaceURI !== "http://www.w3.org/1999/xhtml" || eaten.has(tag)) {
            element.remove();
            continue;
        }
        if (media.has(tag) || applicationTags.has(tag) || tag === "template" || /^lj-/.test(tag) ||
            ["ljuser", "ljvideo"].includes(element.getAttribute("class")?.toLowerCase() ?? "")) {
            throw new UnsupportedContent();
        }
        if (removed.has(tag)) { element.replaceWith(...element.childNodes); continue; }
        if (controls.has(tag) && !element.closest("form")) {
            element.replaceWith(document.createTextNode(`<${tag} ... >`), ...element.childNodes);
            continue;
        }
        if (tag === "input") {
            const type = element.getAttribute("type") ?? "";
            if (!/^\w+$/.test(type) || type.toLowerCase() === "password") element.removeAttribute("type");
        }
        for (const attribute of [...element.attributes]) {
            const name = attribute.name;
            if (/^(?:on|dynsrc)/.test(name) || ["srcdoc", "ping", "xmlns", "xlink:href"].includes(name) ||
                name === "id" && !generatedIds.has(attribute.value)) {
                element.removeAttribute(name);
                continue;
            }
            if (name === "data") {
                element.removeAttribute("data"); element.removeAttribute("type"); continue;
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

export function createEntryCleaner(limits: CleanerLimits): EntryCleaner {
    validateCleanerLimits(limits);
    const bounds = Object.freeze({...limits});
    let closed = false;
    return {
        clean(input: EntryContentInput, resolutions?: ImageResolutionSet): EntryContentResult {
            if (closed) return {kind: "failure", reason: "unavailable"};
            let dom: JSDOM | undefined;
            try {
                validateInput(input, bounds);
                const hash = inputHash(input);
                // No runScripts, resources, fromURL or caller DOM. This worker is
                // also denied network/files/children by the outer kernel/runtime
                // boundary; DOMPurify is not treated as a resource-privacy tool.
                dom = new JSDOM(input.body, {url: input.context.documentUrl,
                    includeNodeLocations: true, contentType: "text/html"});
                const root = dom.window.document.body;
                checkTree(root, bounds, dom.window.document.head);
                for (const element of root.querySelectorAll("[id]")) element.removeAttribute("id");
                const ids = replaceCuts(root, input.context, node => dom!.nodeLocation(node) ?? null, bounds.maxCuts);
                const images = new ImagePass(input, hash, bounds, node => dom!.nodeLocation(node) ?? null, resolutions);
                transform(root, input, bounds, images, ids);
                images.finish();
                if (images.requests.length && !resolutions) {
                    return {kind: "image-resolution-required", images: {inputSha256: hash, requests: images.requests}};
                }
                checkTree(root, bounds);
                const purify = createDOMPurify(dom.window);
                purify.addHook("uponSanitizeAttribute", (_node, data) => {
                    if (data.attrName === "id" && !ids.has(data.attrValue)) data.keepAttr = false;
                });
                // Final operation on markup. No later string replacement or raw
                // substitution may invalidate this body-context sanitation.
                const html = purify.sanitize(root.innerHTML, {
                    USE_PROFILES: {html: true}, SANITIZE_DOM: true,
                    ALLOWED_URI_REGEXP: safeUri,
                    ADD_TAGS: ["font", "center", "strike", "tt", "form", "input", "button", "select", "option", "textarea", "map", "area"],
                    ADD_ATTR: ["name", "usemap", "shape", "coords", "background", "longdesc", "formaction", "border", "color", "bgcolor", "fgcolor", "face", "size"],
                    FORBID_TAGS: ["style", "script", "svg", "math", "template", "iframe", "object", "embed"],
                    RETURN_TRUSTED_TYPE: false,
                });
                purify.removeAllHooks();
                if (Buffer.byteLength(html) > bounds.maxOutputBytes) throw new UnsupportedContent();
                return {kind: "ok", fragment: {context: "html-div-flow", html} as BodyFragment,
                    provenance: {policy: input.context.policy, inputSha256: hash,
                        outputSha256: createHash("sha256").update(html).digest("hex"), cutsOmitted: ids.size / 2}};
            } catch (error) {
                return {kind: "failure", reason: error instanceof UnsupportedContent ? "unsupported" : "unavailable"};
            } finally { dom?.window.close(); }
        },
        close() { closed = true; },
    };
}
