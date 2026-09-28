// output-cleaner.ts
//
// Clean what S2 prints as safe: output from untrusted layers and `print safe`.
// A port of HTMLCleaner, which LJ::S2::s2_run uses for the same purpose.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { decodeHTML } from "entities";
import { Tokenizer } from "htmlparser2";
import type { SiteConfig } from "../server/config";
import { cleanCss } from "./css-cleaner";
import { eurl } from "./objects";
import type { Output } from "./context";

const EAT = new Set(["script", "object", "iframe", "applet", "embed", "param"]);
const BAD_ATTRIBUTES = new Set(["datasrc", "datafld"]);
const LINK_RELATIONS = new Set(("icon shortcut alternate next prev index made start search top help up author " +
    "edituri file-list previous home contents bookmark chapter section subsection appendix glossary copyright child")
    .split(" "));

const eangles = (text: string) => text.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const ehtml = (text: string) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// Collects printed text. Safe prints are buffered and cleaned together when
// raw output follows, so a tag split across safe prints is still seen whole.
export class PageOutput implements Output {
    private html = "";
    private pending = "";
    // start_css sends both kinds of output here, uncleaned, until end_css.
    private capture: string | undefined;

    constructor(private readonly config: SiteConfig, private readonly maxBytes: number) {}

    raw(text: string): void {
        if (this.capture !== undefined) {
            this.capture += text;
            return;
        }
        this.flush();
        this.append(text);
    }

    safe(text: string): void {
        if (this.capture !== undefined) {
            this.capture += text;
            return;
        }
        this.pending += text;
        if (this.pending.length > this.maxBytes) throw new Error("Page output limit exceeded");
    }

    startCapture(): void {
        this.capture = "";
    }

    endCapture(): string {
        const captured = this.capture ?? "";
        this.capture = undefined;
        return captured;
    }

    finish(): string {
        this.flush();
        return this.html;
    }

    private flush(): void {
        if (!this.pending) return;
        const text = this.pending;
        this.pending = "";
        this.append(cleanHtml(text, this.config));
    }

    private append(text: string): void {
        this.html += text;
        if (this.html.length > this.maxBytes) throw new Error("Page output limit exceeded");
    }
}

export function cleanHtml(html: string, config: SiteConfig): string {
    let out = "";
    const eating: string[] = [];
    let style: string | undefined;
    let name = "";
    let attributes: [string, string][] = [];
    let attributeName = "";
    let attributeValue = "";

    const openTag = (slashClose: boolean) => {
        if (EAT.has(name) || /^(?:g|fb):/.test(name)) eating.push(name);
        if (eating.length) return;
        const values = Object.fromEntries(attributes);
        if (name === "meta" && !cleanMeta(values)) return;
        if (name === "link" && !cleanLink(values, config)) return;
        let tag = `<${name}`;
        for (const [key] of attributes) {
            if (BAD_ATTRIBUTES.has(key) || /^on/i.test(key) || /(?:^=)|[\x0b\x0d]/.test(key)) continue;
            let value = values[key]!;
            if (key === "style") value = cleanCss(value);
            // HTMLCleaner deletes these values but still prints the attribute.
            if (name === "input" && key === "type" && /^password$/i.test(value)) value = "";
            if (/(?:(?:vb|java)script|about):/i.test(value.replace(/[\s\0]/g, ""))) value = "";
            tag += ` ${key}="${ehtml(value)}"`;
        }
        out += tag + (slashClose ? " />" : ">");
        if (name === "style") style = "";
    };

    const tokenizer = new Tokenizer({ decodeEntities: false }, {
        onopentagname(start, end) {
            name = html.slice(start, end).toLowerCase();
            attributes = [];
        },
        onattribname(start, end) {
            attributeName = html.slice(start, end).toLowerCase();
            attributeValue = "";
        },
        onattribdata(start, end) {
            attributeValue += html.slice(start, end);
        },
        onattribentity(codepoint) {
            attributeValue += String.fromCodePoint(codepoint);
        },
        onattribend() {
            // The first of repeated attributes wins.
            if (!attributes.some(([key]) => key === attributeName)) {
                attributes.push([attributeName, decodeHTML(attributeValue)]);
            }
        },
        onopentagend() { openTag(false); },
        onselfclosingtag() { openTag(true); },
        onclosetag(start, end) {
            const closing = html.slice(start, end).toLowerCase();
            if (eating.length) {
                if (eating.at(-1) === closing) eating.pop();
                return;
            }
            if (style !== undefined) {
                out += cleanCss(style);
                style = undefined;
            }
            out += `</${closing}>`;
        },
        ontext(start, end) {
            if (eating.length) return;
            const text = html.slice(start, end);
            if (style !== undefined) style += text;
            else out += eangles(text);
        },
        ontextentity() {},
        ondeclaration(start, end) {
            out += "<!" + eangles(html.slice(start, end)) + ">";
        },
        onprocessinginstruction() {},
        oncomment() {},
        oncdata() {},
        onend() {},
    });
    tokenizer.write(html);
    tokenizer.end();
    return out;
}

function cleanMeta(attributes: Record<string, string>): boolean {
    const equiv = (attributes["http-equiv"] ?? "").toLowerCase().replace(/[\s\x0b]/, "");
    return !/refresh|content-type|link|set-cookie/.test(equiv);
}

function cleanLink(attributes: Record<string, string>, config: SiteConfig): boolean {
    const rel = attributes.rel ?? "";
    if (/\bstylesheet\b/i.test(rel)) {
        const href = attributes.href ?? "";
        const match = /^https?:\/\/([^/]+?)(\/.*)$/.exec(href);
        if (!match) return false;
        const valid = validStylesheet(href, match[1]!, match[2]!, config);
        if (valid === true) return true;
        if (typeof valid === "string") {
            attributes.href = valid;
            return true;
        }
        return false;
    }
    const keys = Object.keys(attributes);
    if (!keys.length) return true;
    if (/^(?:service|openid)\.\w+$/.test(rel)) return true;
    if (LINK_RELATIONS.has(rel.toLowerCase())) return true;
    if ("href" in attributes && keys.length === 1) return true;
    return rel.split(/\s+/).every(part => LINK_RELATIONS.has(part));
}

// LJ::valid_stylesheet_url
function validStylesheet(href: string, host: string, path: string, config: SiteConfig): boolean | string {
    const cleanIt = () => !config.cssCleaner ? true : config.cssProxy ? `${config.cssProxy}?u=${eurl(href)}` : false;
    if (config.trustedCssHosts.includes(host)) return true;
    if (!host.toLowerCase().endsWith(config.domain.toLowerCase())) return cleanIt();
    if (host === config.domain || host === config.domainWeb || href.startsWith(config.statPrefix)) return true;
    if (/^(\/~\w+|\/users\/\w+|\/\w+)?\/res\/(\d+)\/stylesheet(\?\d+)?$/.test(path)) return true;
    return cleanIt();
}
