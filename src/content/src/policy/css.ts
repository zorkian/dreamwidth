// css.ts
//
// Parsed inline entry CSS with retained contextual screening and URL resolution.
//
// Screening adapted from LJ::CleanHTML and CSS::Cleaner, forked from the
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

import * as tree from "css-tree";
import type {CleanerLimits, EntryContentContext} from "../contracts";
import {UnsupportedContent} from "./errors";
import {resolveDocumentUrl, retainedAttributeValue} from "./urls";

export interface CssBudget { bytes: number; nodes: number }

function secondaryScreen(value: string): boolean {
    let reduced = value.replace(/comment-bake-cookie/g, "CLEANED").replace(
        /&#(?:x([a-f0-9]+)|(\d+));?/gi, (_, hex: string | undefined, decimal: string) => {
            const code = Number.parseInt(hex ?? decimal, hex ? 16 : 10);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\x00";
        });
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]|<\w|<\//.test(reduced)) return false;
    reduced = reduced.replace(/\s/g, "");
    if (/\\[a-f0-9]|@(?:import|charset)|&#/i.test(reduced)) return false;
    const scripting = /\bdata:\b|javascript|jscript|livescript|vbscript|expression|eval|cookie|\bwindow\b|\bparent\b|\bthis\b|behaviou?r|moz-binding/i;
    return !scripting.test(reduced.replace(/\\/g, "")) &&
        !scripting.test(reduced.replace(/\/\*.*?\*\//gs, "").replace(/<!--.*?-->/gs, "")
            .replace(/\\/g, ""));
}

function resource(value: string, context: EntryContentContext, adaptUrls: boolean): string {
    const clean = retainedAttributeValue(value);
    if (clean === null || /[\x00-\x1f\x7f\\]/.test(clean)) throw new UnsupportedContent();
    const resolved = resolveDocumentUrl(clean, context.documentUrl);
    const url = new URL(resolved, context.documentUrl);
    // CSS loads resources, never navigation or application protocol handlers.
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        throw new UnsupportedContent();
    }
    return adaptUrls ? resolved : clean;
}

export function cleanStyle(value: string, context: EntryContentContext,
    limits: CleanerLimits, budget: CssBudget, adaptUrls = true): string | null {
    budget.bytes += Buffer.byteLength(value);
    if (budget.bytes > limits.maxCssBytes) throw new UnsupportedContent();
    // CleanHTML.pm769 transforms the value itself before all later processing.
    // Re-emitting original escapes would reactivate fixed/absolute identifiers,
    // including inside custom properties. This is entry, not strongcleancss.
    value = value.replace(/\\/g, "");
    const legacy = value;
    if (/\/\*|\[|absolute|fixed|expression|eval|behavior|cookie|document|window|javascript|-moz-binding/i.test(legacy) ||
        !secondaryScreen(legacy)) return null;
    let ast: tree.CssNode;
    try {
        ast = tree.parse(value, {context: "declarationList", parseCustomProperty: true,
            onParseError() { throw new UnsupportedContent(); }});
    } catch { throw new UnsupportedContent(); }
    if (ast.type !== "DeclarationList") throw new UnsupportedContent();
    let modified = false;
    const remove: tree.ListItem<tree.CssNode>[] = [];
    ast.children.forEach((node, item) => {
        if (node.type !== "Declaration") throw new UnsupportedContent();
        const property = tree.ident.decode(node.property).toLowerCase();
        if (context.reader.removeColors && ["color", "background-color"].includes(property) ||
            context.reader.removeSizes && property === "font-size" ||
            context.reader.removeFonts && property === "font-family") remove.push(item);
    });
    for (const item of remove) { ast.children.remove(item); modified = true; }
    tree.walk(ast, function(node, item) {
        if (++budget.nodes > limits.maxCssNodes || node.type === "Raw" || node.type === "Atrule") {
            throw new UnsupportedContent();
        }
        if (node.type === "Function") {
            const decoded = tree.ident.decode(node.name).toLowerCase();
            if (/^(?:expression|eval|var-expression|behavior)$/.test(decoded)) {
                throw new UnsupportedContent();
            }
            if (decoded === "url") {
                // Defensively require a generic URL-shaped function to parse
                // as exactly one resource, including in custom properties.
                const parsed = tree.parse("url(" + node.children.toArray().map(v => tree.generate(v)).join("") + ")",
                    {context: "value"});
                if (parsed.type !== "Value" || parsed.children.size !== 1 ||
                    parsed.children.first?.type !== "Url" || !item) throw new UnsupportedContent();
                const replacement = parsed.children.first;
                replacement.value = resource(replacement.value, context, adaptUrls);
                item.data = replacement;
                modified = true;
                return tree.walk.skip;
            }
            if (["image-set", "-webkit-image-set", "image"].includes(decoded)) {
                node.children.forEach(child => {
                    if (child.type === "String") {
                        const next = resource(child.value, context, adaptUrls);
                        modified ||= next !== child.value;
                        child.value = next;
                    }
                    if (child.type === "Function" && tree.ident.decode(child.name).toLowerCase() === "var") {
                        // A substituted string can become a URL only at use
                        // time. Refuse this ambiguous resource form explicitly;
                        // ordinary custom properties containing url() remain.
                        throw new UnsupportedContent();
                    }
                });
            }
            // attr() can turn unvalidated arbitrary attributes into resource
            // URLs after substitution; unlike var(), this crosses our URL pass.
            if (decoded === "attr" || decoded === "src") throw new UnsupportedContent();
        }
        if (node.type === "Url") {
            const next = resource(node.value, context, adaptUrls);
            modified ||= next !== node.value;
            node.value = next;
        }
    });
    return modified ? tree.generate(ast) : value;
}

// Subject opts do not enable the entry backslash transform. Decode ordinary
// escaped CSS identifiers with the maintained tokenizer before applying the
// same explicit containment/security screen; never strip source escape bytes
// and silently change an ordinary color or resource destination.
export function cleanSubjectStyle(value: string, context: EntryContentContext,
    limits: CleanerLimits, budget: CssBudget): string | null {
    if (value.includes("\\")) {
        let ast: tree.CssNode;
        try {
            ast = tree.parse(value, {context:"declarationList",parseCustomProperty:true,
                onParseError(){throw new UnsupportedContent();}});
        } catch {throw new UnsupportedContent();}
        let nodes=0;
        tree.walk(ast,node=>{
            if(++nodes>limits.maxCssNodes || node.type==="Raw")throw new UnsupportedContent();
            const identifier=(text:string):string=>tree.ident.encode(tree.ident.decode(text));
            if(node.type==="Declaration")node.property=identifier(node.property);
            if(node.type==="Identifier"||node.type==="Function")node.name=identifier(node.name);
        });
        value=tree.generate(ast);
        // Remaining escapes belong to strings/resources or names whose decoded
        // spelling needs CSS escaping. Their source semantics are not proved by
        // the identifier-only normalization; fail rather than corrupt them.
        if(value.includes("\\"))throw new UnsupportedContent();
    }
    return cleanStyle(value,context,limits,budget);
}
