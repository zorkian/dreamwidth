// html-cleaner.ts
//
// A port of HTMLCleaner: remove script and dangerous attributes from HTML
// that is otherwise passed through as written. S2 safe prints use it, and
// LJ::CleanHTML uses its element checks.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { cleanCss } from "./css";
import { ehtml, eurl } from "./text";
import { tokenize } from "./tokens";

// The site settings LJ::valid_stylesheet_url reads.
export interface StylesheetSettings {
    readonly domain: string;
    readonly domainWeb: string;
    readonly statPrefix: string;
    readonly trustedCssHosts: readonly string[];
    readonly cssProxy: string | null;
    readonly cssCleaner: boolean;
    // Replaces the site rules for which stylesheet links are kept.
    readonly validStylesheet?: (href: string, host: string, path: string) => boolean | string;
}

const EAT = new Set(["script", "object", "iframe", "applet", "embed", "param"]);
const BAD_ATTRIBUTES = new Set(["datasrc", "datafld"]);
const LINK_RELATIONS = new Set(("icon shortcut alternate next prev index made start search top help up author " +
    "edituri file-list previous home contents bookmark chapter section subsection appendix glossary copyright child")
    .split(" "));

const eangles = (text: string) => text.replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function htmlCleaner(html: string, settings: StylesheetSettings): string {
    let out = "";
    const eating: string[] = [];
    let style: string | undefined;

    for (const token of tokenize(html)) {
        switch (token.type) {
            case "S": {
                const { tag } = token;
                if (EAT.has(tag) || /^(?:g|fb):/.test(tag)) eating.push(tag);
                if (eating.length) break;
                const attrs = { ...token.attrs };
                if (tag === "meta" && !cleanMeta(attrs)) break;
                if (tag === "link" && !cleanLink(attrs, settings)) break;
                let result = `<${tag}`;
                for (const key of token.order) {
                    if (BAD_ATTRIBUTES.has(key) || /^on/i.test(key) || /(?:^=)|[\x0b\x0d]/.test(key)) continue;
                    let value = attrs[key]!;
                    if (key === "style") value = cleanCss(value);
                    // HTMLCleaner deletes these values but still prints the attribute.
                    if (tag === "input" && key === "type" && /^password$/i.test(value)) value = "";
                    if (/(?:(?:vb|java)script|about):/i.test(value.replace(/[\s\0]/g, ""))) value = "";
                    result += ` ${key}="${ehtml(value)}"`;
                }
                out += result + (token.selfClosing ? " />" : ">");
                if (tag === "style") style = "";
                break;
            }
            case "E":
                if (eating.length) {
                    if (eating.at(-1) === token.tag) eating.pop();
                    break;
                }
                if (style !== undefined) {
                    out += cleanCss(style);
                    style = undefined;
                }
                out += `</${token.tag}>`;
                break;
            case "T":
                if (eating.length) break;
                if (style !== undefined) style += token.text;
                else out += eangles(token.text);
                break;
            case "D":
                out += "<!" + token.text.slice(2, -1).trim().split(/\s+/).map(eangles).join(" ") + ">";
                break;
        }
    }
    return out;
}

// HTMLCleaner::CLEAN_meta
export function cleanMeta(attrs: Record<string, string>): boolean {
    const equiv = (attrs["http-equiv"] ?? "").toLowerCase().replace(/[\s\x0b]/, "");
    return !/refresh|content-type|link|set-cookie/.test(equiv);
}

// HTMLCleaner::CLEAN_link. May rewrite a stylesheet's href.
export function cleanLink(attrs: Record<string, string>, settings: StylesheetSettings): boolean {
    const rel = attrs.rel ?? "";
    if (/\bstylesheet\b/i.test(rel)) {
        const href = attrs.href ?? "";
        const match = /^https?:\/\/([^/]+?)(\/.*)$/.exec(href);
        if (!match) return false;
        const valid = validStylesheet(href, match[1]!, match[2]!, settings);
        if (typeof valid === "string") attrs.href = valid;
        return valid !== false;
    }
    const keys = Object.keys(attrs);
    if (!keys.length) return true;
    if (/^(?:service|openid)\.\w+$/.test(rel)) return true;
    if (LINK_RELATIONS.has(rel.toLowerCase())) return true;
    if ("href" in attrs && keys.length === 1) return true;
    return rel.split(/\s+/).every(part => LINK_RELATIONS.has(part));
}

// LJ::valid_stylesheet_url
function validStylesheet(href: string, host: string, path: string, settings: StylesheetSettings): boolean | string {
    if (settings.validStylesheet) return settings.validStylesheet(href, host, path);
    const cleanIt = () => !settings.cssCleaner ? true : settings.cssProxy ? `${settings.cssProxy}?u=${eurl(href)}` : false;
    if (settings.trustedCssHosts.includes(host)) return true;
    if (!host.toLowerCase().endsWith(settings.domain.toLowerCase())) return cleanIt();
    if (host === settings.domain || host === settings.domainWeb || href.startsWith(settings.statPrefix)) return true;
    if (/^(\/~\w+|\/users\/\w+|\/\w+)?\/res\/(\d+)\/stylesheet(\?\d+)?$/.test(path)) return true;
    return cleanIt();
}
