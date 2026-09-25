// formatting.ts
//
// Source-proven repair of active formatting reconstructed after explicit closes.
//
// Policy adapted from LJ::CleanHTML, forked from the LiveJournal project owned
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

import {UnsupportedContent} from "./errors";
import type {LocateNode, SourceLocation} from "./cuts";
import {eatenTags, removedTags} from "./inventory";

// HTML active-formatting elements, including legacy presentation tags. Parser
// reconstruction copies the original start-tag location; adoption can instead
// create source-less nodes. Neither case may be inferred from serialized HTML.
const formatting = new Set("a b big code em font i nobr s small strike strong tt u".split(" "));

export function repairFormatting(root: Element, locate: LocateNode): void {
    const elements = [...root.querySelectorAll("*")].filter(element => {
        for (let parent: Element | null = element; parent && parent !== root;
            parent = parent.parentElement) {
            if (parent.namespaceURI !== "http://www.w3.org/1999/xhtml" || eatenTags.has(parent.localName)) {
                return false;
            }
        }
        return true;
    });
    // HTML5 can keep descendant text inside an element after its explicit
    // source close (notably form). Merged text may straddle the boundary, so
    // checking only start offsets misses the retained visible-scope difference.
    for (const ancestor of elements) {
        const ending = locate(ancestor)?.endTag;
        if (!ending || removedTags.has(ancestor.localName) ||
            ["html", "head", "body"].includes(ancestor.localName) || ancestor.closest("table")) continue;
        const check = (node: Node): void => {
            if (node.nodeType === 1 && ((node as Element).namespaceURI !== "http://www.w3.org/1999/xhtml" ||
                eatenTags.has((node as Element).localName))) return;
            const location = locate(node);
            if (location && location.endOffset > ending.startOffset) throw new UnsupportedContent();
            for (const child of node.childNodes) check(child);
        };
        for (const child of ancestor.childNodes) check(child);
    }
    const tables = elements.filter(element => element.localName === "table")
        .sort((a, b) => (locate(b)?.startOffset ?? 0) - (locate(a)?.startOffset ?? 0));
    const groups = new Map<string, Element[]>();
    const key = (element: Element): string | null => {
        const span = locate(element)?.startTag;
        return span ? `${element.localName}:${span.startOffset}:${span.endOffset}` : null;
    };
    for (const element of elements) {
        if (!formatting.has(element.localName)) continue;
        const identity = key(element);
        if (!identity) throw new UnsupportedContent();
        const group = groups.get(identity) ?? [];
        group.push(element);
        groups.set(identity, group);
    }
    const unwrap: Element[] = [];
    for (const group of groups.values()) {
        const original = group[0]!;
        const originalLocation = locate(original)!;
        const sourceTable = tables.find(table => {
            const range = locate(table);
            return range && range.startOffset < originalLocation.startOffset &&
                originalLocation.startOffset < range.endOffset;
        });
        // Foster parenting is not the retained table exception: DOM ancestry
        // must agree with the original table's source interval.
        if (sourceTable && original.closest("table") !== sourceTable) throw new UnsupportedContent();
        if (group.length === 1) continue;
        if (sourceTable) {
            const range = locate(sourceTable)!;
            if (!range.endTag || group.some(node => node.closest("table") !== sourceTable ||
                !contentsAfter(node, range.startTag!.endOffset, range.endTag!.startOffset))) {
                throw new UnsupportedContent();
            }
            // CleanHTML.pm1175 deliberately does not pop intervening tags in
            // table scope. Keep parser reconstruction there, including its text.
            continue;
        }
        if (originalLocation.endTag) throw new UnsupportedContent();
        let boundary: SourceLocation["endTag"];
        for (let ancestor = original.parentElement; ancestor && ancestor !== root;
            ancestor = ancestor.parentElement) {
            // Source-removed wrappers never enter the retained tag stack.
            // Parser document scaffolding likewise supplies no close proof.
            if (removedTags.has(ancestor.localName) || ["html", "head", "body"].includes(ancestor.localName)) continue;
            const location = locate(ancestor);
            if (location?.startTag && location.endTag &&
                location.startTag.endOffset <= originalLocation.startOffset &&
                location.endTag.startOffset === originalLocation.endOffset &&
                !ancestor.closest("table")) {
                boundary = location.endTag;
                break;
            }
        }
        if (!boundary) throw new UnsupportedContent();
        for (const duplicate of group.slice(1)) {
            if (duplicate.closest("table") || !contentsAfter(duplicate, boundary.endOffset, Infinity)) {
                throw new UnsupportedContent();
            }
            unwrap.push(duplicate);
        }
    }
    // Validate every proof against the unmodified parser tree before mutation.
    for (const duplicate of unwrap) duplicate.replaceWith(...duplicate.childNodes);

    function contentsAfter(node: Element, start: number, end: number): boolean {
        let witnessed = false;
        const visit = (child: Node): boolean => {
            const location = locate(child);
            const reconstruction = child.nodeType === 1 && formatting.has((child as Element).localName) &&
                (groups.get(key(child as Element) ?? "")?.length ?? 0) > 1;
            if (!reconstruction && (!location || location.startOffset < start || location.endOffset > end)) {
                return false;
            }
            if (!reconstruction) witnessed = true;
            return [...child.childNodes].every(visit);
        };
        return [...node.childNodes].every(visit) && witnessed;
    }
}
