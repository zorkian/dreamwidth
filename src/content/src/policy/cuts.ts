// cuts.ts
//
// Bounded recent-page cut placeholders, constructed inside the isolated worker.
//
// Markup adapted from LJ::CleanHTML, forked from the LiveJournal project owned
// and operated by Live Journal, Inc., and modified and expanded by Dreamwidth
// Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, this code and its modifications are provided
// under the GNU General Public License. See LICENSE in this distribution.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//

import type { EntryContentContext } from "../contracts";
import { UnsupportedContent } from "./errors";

export interface SourceLocation {
    readonly startOffset: number;
    readonly endOffset: number;
    readonly startTag?: { readonly startOffset: number; readonly endOffset: number };
    readonly endTag?: { readonly startOffset: number; readonly endOffset: number };
}
export type LocateNode = (node: Node) => SourceLocation | null;

function isCut(element: Element): boolean {
    return element.localName === "lj-cut" || element.localName === "cut" ||
        (element.localName === "div" && element.getAttribute("class")?.toLowerCase() === "ljcut");
}

// A block placeholder must not be inserted into phrasing/table/rawtext ancestry.
// This is the explicitly bounded cut grammar, not an ordinary HTML tag allowlist.
const cutParents = new Set([
    "div", "section", "article", "aside", "main", "header", "footer", "nav",
    "blockquote", "li", "dd", "dt", "details", "body",
]);

// The DOM is private to the cleaner. Locations come from the parser that consumed
// the exact raw input; generated nodes and another document are not admissible.
// Return only generated ID values for final sanitation, never hidden cut text.
export function replaceCuts(
    root: Element, context: EntryContentContext, locate: LocateNode, maxCuts: number,
    metadata = false,
): ReadonlySet<string> {
    const candidates = [...root.querySelectorAll("*")].filter(isCut);
    if (candidates.length > maxCuts) throw new UnsupportedContent();
    const intervals = candidates.map(element => {
        const location = locate(element);
        if (!location?.startTag || !location.endTag ||
            location.startTag.endOffset > location.endTag.startOffset) {
            throw new UnsupportedContent();
        }
        for (let parent = element.parentElement; parent && parent !== root;
            parent = parent.parentElement) {
            if (isCut(parent) || parent.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
                !cutParents.has(parent.localName)) throw new UnsupportedContent();
        }
        if (element.namespaceURI !== "http://www.w3.org/1999/xhtml") throw new UnsupportedContent();
        // HTML foster parenting can relocate a cut out of an original table.
        // Source ranges still expose that forbidden ancestry after tree repair.
        for (const container of root.querySelectorAll("table,thead,tbody,tfoot,tr,td,th,select,textarea,script,style,svg,math")) {
            const enclosing = locate(container);
            if (enclosing && enclosing.startOffset < location.startOffset &&
                enclosing.endOffset > location.endOffset) throw new UnsupportedContent();
        }
        return { element, location };
    });
    intervals.sort((a, b) => a.location.startOffset - b.location.startOffset);
    for (let index = 1; index < intervals.length; index++) {
        if (intervals[index]!.location.startOffset < intervals[index - 1]!.location.endOffset) {
            throw new UnsupportedContent();
        }
    }
    // Foster parenting and parser repairs must not move hidden payload outside
    // its cut. Conversely, do not silently hide visible trailing source that a
    // malformed tree swallowed into the cut. Inspect text nodes as well as tags.
    const walker = root.ownerDocument.createTreeWalker(root, 0xffffffff);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const location = locate(node);
        if (!location) continue;
        for (const cut of intervals) {
            const startsInside = location.startOffset >= cut.location.startTag!.endOffset &&
                location.startOffset < cut.location.endTag!.startOffset;
            const child = node !== cut.element && cut.element.contains(node);
            if (startsInside !== child || (child &&
                location.endOffset > cut.location.endTag!.startOffset)) {
                throw new UnsupportedContent();
            }
        }
    }
    const generated = new Set<string>();
    intervals.forEach(({ element }, index) => {
        const document = root.ownerDocument;
        const number = index + 1;
        if (context.cuts === "source-compatible-entry") {
            // clean_event without cuturl includes all descendants. Its textonly
            // helper omits both generated anchor and the special cut wrapper.
            // Names remain inert, including source collisions; IDs are separate.
            if (metadata) { element.replaceWith(...element.childNodes); return; }
            const anchor = document.createElement("a");
            anchor.setAttribute("name", "cutid" + number);
            if (element.localName === "div") {
                const full = document.createElement("div");
                full.className = "ljcut";
                full.setAttribute("text", element.getAttribute("text") || "Read more...");
                full.append(...element.childNodes);
                element.replaceWith(anchor, full);
            } else element.replaceWith(anchor, ...element.childNodes);
            return;
        }
        const suffix = `${context.journalUsername}_${context.entryId}_${number}`;
        const wrapper = document.createElement("span");
        wrapper.className = "cut-wrapper";
        const placeholder = document.createElement("span");
        placeholder.setAttribute("style", "display: none;");
        placeholder.id = "span-cuttag_" + suffix;
        placeholder.className = "cuttag";
        generated.add(placeholder.id);
        wrapper.append(placeholder);
        const open = document.createElement("b");
        open.className = "cut-open";
        open.textContent = "(\u00a0";
        const text = document.createElement("b");
        text.className = "cut-text";
        const link = document.createElement("a");
        link.setAttribute("href", context.entryUrl + "#cutid" + number);
        link.textContent = element.getAttribute("text") || "Read more...";
        text.append(link);
        const close = document.createElement("b");
        close.className = "cut-close";
        close.textContent = "\u00a0)";
        wrapper.append(open, text, close);
        const content = document.createElement("div");
        content.setAttribute("style", "display: none;");
        content.id = "div-cuttag_" + suffix;
        generated.add(content.id);
        content.setAttribute("aria-live", "assertive");
        if (element.localName === "div") {
            const outer = document.createElement("div");
            outer.append(wrapper, content);
            element.replaceWith(outer);
        } else {
            element.replaceWith(wrapper, content);
        }
    });
    return generated;
}
