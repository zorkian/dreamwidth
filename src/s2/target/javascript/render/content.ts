// content.ts
//
// Clean entry and comment text with @dreamwidth/content, as the page
// builders call LJ::CleanHTML.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { createEntryCleaner } from "@dreamwidth/content";
import type { EntryContentContext, EntryContentInput } from "@dreamwidth/content/contracts";
import type { SiteConfig } from "../server/config";
import type { Entry } from "../data/entry";
import { truthy } from "../data/entry";
import type { Site, User } from "../data/user";
import { ehtml } from "./objects";
import type { PropertyCleaners } from "./context";
import { cleanCss } from "./css-cleaner";

type Format = EntryContentInput["format"];

export interface CleanedSubject {
    readonly html: string;
    // With links removed, for use inside a link.
    readonly noLinks: string;
    // As plain text.
    readonly text: string;
}

// The largest limits the cleaner accepts.
const LIMITS = {
    maxInputBytes: 65536, maxOutputBytes: 2097152, maxNodes: 4096, maxDepth: 16, maxCssBytes: 65536,
    maxCssNodes: 4096, maxImageCandidates: 256, maxCuts: 16,
};

export class ContentCleaner {
    private readonly cleaner = createEntryCleaner(LIMITS);

    constructor(private readonly site: Site, private readonly journal: User) {}

    close(): void {
        this.cleaner.close();
    }

    // LJ::CleanHTML::clean_event. Recent views collapse cuts into links.
    event(entry: Entry, documentUrl: string, cuts: "recent" | "entry"): string {
        const url = entry.url(this.site);
        const result = this.cleaner.clean({
            body: entry.event, format: entryFormat(entry),
            context: this.context(documentUrl, url, entry.ditemid, cuts),
        });
        return result.kind === "ok" ? result.fragment.html : escaped(entry.event);
    }

    // The plain subject and body text EntryPage uses for Open Graph tags.
    metadata(entry: Entry): { subject: string; event: string } {
        const url = entry.url(this.site);
        const result = this.cleaner.metadata({
            subject: entry.subject,
            entry: { body: entry.event, format: entryFormat(entry), context: this.context(url, url, entry.ditemid, "entry") },
        });
        return result.kind === "ok" ? { subject: result.metadata.subjectText, event: result.metadata.eventText }
            : { subject: this.subject(entry.subject, url).text, event: entry.event.replace(/<[^>]*>/g, "") };
    }

    comment(body: string, props: Record<string, string>, datepost: string, anonymous: boolean, entryUrl: string): string {
        const formatting = truthy(props.editor) ? props.editor! : truthy(props.opt_preformatted) ? "html_raw0"
            : "import_source" in props || datepost < "2019-05" ? "html_casual0" : "html_casual1";
        if (!["html_raw0", "html_casual0", "html_casual1"].includes(formatting)) return escaped(body);
        const result = this.cleaner.comment({
            body, formatting: formatting as "html_raw0" | "html_casual0" | "html_casual1", anonymous,
            context: this.context(entryUrl, entryUrl, 1, "entry"),
        });
        return result.kind === "ok" ? result.html : escaped(body);
    }

    // LJ::CleanHTML::clean_subject, and the forms formatted_subject uses.
    subject(source: string, documentUrl: string): CleanedSubject {
        if (!/[<>]/.test(source)) return { html: source, noLinks: source, text: source };
        const result = this.cleaner.subject({ source, context: this.context(documentUrl, documentUrl, 1, "entry") });
        if (result.kind !== "ok") {
            const text = escaped(source);
            return { html: text, noLinks: text, text };
        }
        return { html: result.subject.html, noLinks: result.subject.recentHtml, text: result.subject.all };
    }

    // Property cleaners for LJ::S2::escape_prop_value.
    propertyCleaners(documentUrl: string): PropertyCleaners {
        return {
            html: value => {
                const result = this.cleaner.customtext({ source: value, context: this.context(documentUrl, documentUrl, 1, "entry") });
                return result.kind === "ok" ? result.html : escaped(value);
            },
            simpleHtml: value => this.subject(value, documentUrl).html,
            css: value => cleanCss(value),
            cssAttribute: value => cleanCss(value),
        };
    }

    private context(documentUrl: string, entryUrl: string, entryId: number, cuts: "recent" | "entry"): EntryContentContext {
        const config: SiteConfig = this.site.config;
        const placeholder = config.images.placeholder!;
        return {
            policy: "dreamwidth-entry-html-raw0-v1", insertionContext: "html-div-flow", documentUrl, entryUrl,
            journalUsername: this.journal.user, journalId: this.journal.userid, entryId,
            cuts: cuts === "recent" ? "source-compatible-recent" : "source-compatible-entry",
            reader: {
                removeColors: false, removeSizes: false, removeFonts: false, maxImageWidth: null,
                maxImageHeight: null, placeholderUndefinedImageSize: false, extractImages: false,
            },
            imagePlaceholder: {
                src: config.imgPrefix + placeholder.src, width: placeholder.width, height: placeholder.height,
                alt: placeholder.alt, title: placeholder.alt,
            },
            urls: { siteDomain: config.domain, knownHttpsSites: [], formDomainBanned: [], imageProxy: "not-configured" },
        };
    }
}

// The editor LJ::CleanHTML::clean_event picks.
function entryFormat(entry: Entry): Format {
    const props = entry.props;
    if (!entry.event) return "html_raw0";
    if (truthy(props.editor)) {
        if (props.editor === "rte0") return "html_casual1";
        if (["markdown0", "markdown", "markdown_latest"].includes(props.editor!)) return "markdown0";
        if (["html_raw0", "html_casual0", "html_casual1"].includes(props.editor!)) return props.editor as Format;
    }
    if (/^[\t\n\v\f\r ]*!markdown[\t\n\v\f\r ]*\r?\n/i.test(entry.event)) return "markdown0-magic";
    if (truthy(props.opt_preformatted)) return "html_raw0";
    if ("import_source" in props) return "html_casual0";
    return entry.logtime < "2019-05" ? "html_casual0" : "html_casual1";
}

// Text the cleaner declines is shown escaped rather than dropped.
function escaped(text: string): string {
    return ehtml(text).replaceAll("\n", "<br />");
}
