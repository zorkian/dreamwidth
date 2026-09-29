// index.ts
//
// Dreamwidth's HTML cleaners: LJ::CleanHTML's clean_event, clean_comment and
// clean_subject, HTMLCleaner, and CSS::Cleaner.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { type CleanHooks, type CleanOptions, type CleanSite, clean } from "./clean";

export { type CleanHooks, type CleanOptions, type CleanSite, type UserTagOptions, canonicalUrl, clean, httpsUrl } from "./clean";
export { cleanCss } from "./css";
export { type StylesheetSettings, htmlCleaner } from "./html-cleaner";
export { canonicalUsername, ehtml, eurl } from "./text";

const SUBJECT_EAT = ["head", "title", "style", "layer", "iframe", "applet", "object", "xml", "param", "base"];
const SUBJECT_ALLOW = ["a", "b", "i", "u", "em", "strong", "cite"];
const SUBJECT_REMOVE = ["bgsound", "embed", "object", "caption", "link", "font", "noscript"];
const EVENT_REMOVE = ["bgsound", "embed", "object", "link", "body", "meta", "noscript", "plaintext", "noframes"];
const COMMENT_EAT = ["head", "title", "style", "layer", "iframe", "applet", "object"];
const COMMENT_ANON_EAT = [...COMMENT_EAT, "table", "tbody", "thead", "tfoot", "tr", "td", "th", "caption", "colgroup",
    "col", "font"];
const COMMENT_ALL = ("table tr td th tbody tfoot thead colgroup caption col a sub sup xmp bdo q span b i u tt s " +
    "strike big small font abbr acronym cite code dfn em kbd samp strong var del ins h1 h2 h3 h4 h5 h6 div blockquote " +
    "address pre center ul ol li dl dt dd area map form textarea img br hr p col summary details ruby rt rp").split(" ");

type Formatting = Pick<CleanOptions, "formatting" | "addbreaks" | "at_mentions" | "noautolinks" | "nodwtags">;

// LJ::CleanHTML's %markup_formats, by DW::Formats id.
const FORMATS: Record<string, Formatting> = {
    html_casual0: { formatting: "html", addbreaks: true, at_mentions: false },
    html_casual1: { formatting: "html", addbreaks: true, at_mentions: true },
    html_raw0: { formatting: "html", addbreaks: false, at_mentions: false, noautolinks: true },
    html_extra_raw: { formatting: "html", addbreaks: false, at_mentions: false, noautolinks: true, nodwtags: true },
    markdown0: { formatting: "markdown", addbreaks: false, at_mentions: true, noautolinks: true },
};

// DW::Formats aliases for the newest version of a format.
const ALIASES: Record<string, string> = {
    markdown: "markdown0", markdown_latest: "markdown0", html_casual_latest: "html_casual1",
};

export function formattingArgs(format: string | undefined): Formatting {
    return FORMATS[ALIASES[format ?? ""] ?? format ?? ""] ?? FORMATS.html_casual1!;
}

const LEGACY_MARKDOWN = /^\s*!markdown\s*\r?\n/i;

export interface EventOptions {
    // The entry's editor prop, if set.
    editor?: string;
    preformatted?: boolean;
    isSyndicated?: boolean;
    isImported?: boolean;
    logtime?: string;
    // Where cut tags link to; unset on the entry's own page.
    cuturl?: string;
    journal?: string;
    ditemid?: number;
    suspendMsg?: boolean;
    textonly?: boolean;
    removeColors?: boolean;
    removeSizes?: boolean;
    removeFonts?: boolean;
    // Return only the text under this cut, counting from 1.
    cutRetrieve?: number;
}

// LJ::CleanHTML::clean_event
export function cleanEvent(text: string, opts: EventOptions, site: CleanSite, hooks?: CleanHooks): string {
    if (!text) return text;
    let formatting = opts.editor;
    if (!formatting) {
        if (LEGACY_MARKDOWN.test(text)) {
            text = text.replace(LEGACY_MARKDOWN, "");
            formatting = "markdown0";
        } else if (opts.isSyndicated) {
            formatting = opts.preformatted ? "html_extra_raw" : "html_casual0";
        } else if (opts.preformatted) {
            formatting = "html_raw0";
        } else if (opts.isImported || (opts.logtime && opts.logtime < "2019-05")) {
            formatting = "html_casual0";
        } else {
            formatting = "html_casual1";
        }
    }
    return clean(text, {
        ...formattingArgs(formatting),
        cuturl: opts.cuturl, eat: SUBJECT_EAT, mode: "allow", remove: EVENT_REMOVE, cleancss: true, noearlyclose: true,
        textonly: opts.textonly, suspend_msg: opts.suspendMsg, journal: opts.journal, ditemid: opts.ditemid,
        remove_colors: opts.removeColors, remove_sizes: opts.removeSizes, remove_fonts: opts.removeFonts,
        cut_retrieve: opts.cutRetrieve,
    }, site, hooks);
}

export interface CommentOptions {
    editor?: string;
    preformatted?: boolean;
    isImported?: boolean;
    datepost?: string;
    // Comments from anonymous or untrusted OpenID posters lose links and images.
    anonymous?: boolean;
    // Remove style attributes.
    nocss?: boolean;
    textonly?: boolean;
}

// LJ::CleanHTML::clean_comment
export function cleanComment(text: string, opts: CommentOptions, site: CleanSite, hooks?: CleanHooks): string {
    let formatting = opts.editor;
    if (!formatting) {
        formatting = opts.preformatted ? "html_raw0"
            : opts.isImported || (opts.datepost && opts.datepost < "2019-05") ? "html_casual0" : "html_casual1";
    }
    return clean(text, {
        ...formattingArgs(formatting),
        eat: opts.anonymous ? COMMENT_ANON_EAT : COMMENT_EAT, mode: "deny", allow: COMMENT_ALL, cleancss: true,
        strongcleancss: true, extractlinks: opts.anonymous, extractimages: opts.anonymous, noearlyclose: true,
        nocss: opts.nocss, textonly: opts.textonly, remove_positioning: true, remove_abs_sizes: opts.anonymous,
    }, site, hooks);
}

// LJ::CleanHTML::clean_subject
export function cleanSubject(text: string, site: CleanSite): string {
    if (!/[<>]/.test(text)) return text;
    return clean(text, {
        addbreaks: false, eat: SUBJECT_EAT, mode: "deny", allow: SUBJECT_ALLOW, remove: SUBJECT_REMOVE,
        noearlyclose: true, formatting: "html", at_mentions: false,
    }, site);
}

// LJ::CleanHTML::clean_subject_all: the subject as text.
export function cleanSubjectAll(text: string, site: CleanSite): string {
    if (!/[<>]/.test(text)) return text;
    return clean(text, {
        addbreaks: false, eat: SUBJECT_EAT, mode: "deny", textonly: true, noearlyclose: true, formatting: "html",
        at_mentions: false,
    }, site);
}

// LJ::CleanHTML::clean_and_trim_subject: the first line of text, up to
// `length` characters.
export function cleanAndTrimSubject(text: string, site: CleanSite, length = 40): string {
    return textTrim(cleanSubjectAll(text, site).replace(/\n[\s\S]*/, ""), length);
}

// LJ::text_trim by characters.
export function textTrim(text: string, chars: number): string {
    return [...text.trim()].slice(0, chars).join("").trim();
}

// LJ::CleanHTML::clean_userbio
export function cleanUserbio(text: string, site: CleanSite, hooks?: CleanHooks, stripLinks = false): string {
    return clean(text, {
        addbreaks: true, attrstrip: ["style"], mode: "allow", noearlyclose: true, eat: SUBJECT_EAT,
        remove: EVENT_REMOVE, cleancss: true, formatting: "html", at_mentions: true, noautolinks: stripLinks,
        extractlinks: stripLinks,
    }, site, hooks);
}

// LJ::CleanHTML::clean_embed, for embedded media. Only iframes from trusted
// sites are kept; `displayAsContent` makes those sites' iframes protocol-relative.
export function cleanEmbed(text: string, site: CleanSite, displayAsContent = false): string {
    if (!text) return text;
    return clean(text, {
        addbreaks: false, mode: "allow", allow: ["object", "embed"], deny: ["script"], remove: ["script"],
        conditional: ["iframe"], ljcut_disable: true, cleancss: true, noautolinks: true, noexpandembedded: true,
        rewrite_embed_param: true, force_https_embed: displayAsContent, formatting: "html", at_mentions: false,
    }, site);
}

// The clean S2's formatted_subject applies before linking a subject.
export function removeLinks(text: string, site: CleanSite): string {
    return clean(text, { noexpandembedded: true, mode: "allow", remove: ["a"] }, site);
}

// Names of the local users the text refers to, so the caller can load them
// before cleaning with a user hook.
export function userReferences(clean: (hooks: CleanHooks) => unknown): Set<string> {
    const names = new Set<string>();
    clean({ user: name => { names.add(name); return undefined; } });
    return names;
}
