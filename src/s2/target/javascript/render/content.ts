// content.ts
//
// Clean entry, comment and subject text with @dreamwidth/content, as the
// page builders call LJ::CleanHTML.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import {
    type CleanHooks, type CleanSite, canonicalUsername, clean, cleanComment, cleanCss, cleanEvent, cleanSubject,
    cleanSubjectAll, removeLinks, userReferences,
} from "@dreamwidth/content";
import type { Databases } from "../data/db";
import type { Entry } from "../data/entry";
import { truthy } from "../data/entry";
import { type Site, User } from "../data/user";
import { ljuserTag } from "./chrome";
import type { PropertyCleaners } from "./context";

export interface CleanedSubject {
    readonly html: string;
    // With links removed, for use inside a link.
    readonly noLinks: string;
    // As plain text.
    readonly text: string;
}

export class ContentCleaner {
    readonly site: CleanSite;
    // Accounts named in the text being cleaned, loaded by preload().
    private readonly users = new Map<string, User>();
    private readonly hooks: CleanHooks;

    constructor(private readonly pageSite: Site) {
        const config = pageSite.config;
        this.site = {
            domain: config.domain, domainWeb: config.domainWeb, statPrefix: config.statPrefix,
            trustedCssHosts: config.trustedCssHosts, cssProxy: config.cssProxy, cssCleaner: config.cssCleaner,
            siteRoot: config.siteRoot, imgPrefix: config.imgPrefix, isDevServer: config.isDevServer,
            knownHttpsSites: [], formDomainBanned: [], placeholder: config.images.placeholder!, strings: config.strings,
        };
        this.hooks = {
            user: (name, options) => {
                const u = this.users.get(canonicalUsername(name));
                if (!u) return undefined;
                return options.textonly ? u.user
                    : ljuserTag(pageSite, u, { noLink: options.noLink, noLjuserClass: options.noLjuserClass });
            },
        };
    }

    // Load the accounts the text mentions, so cleaning can render their user tags.
    async preload(db: Databases, texts: readonly string[]): Promise<void> {
        const names = new Set<string>();
        for (const text of texts) {
            for (const name of userReferences(hooks => cleanEvent(text, {}, this.site, hooks))) {
                const canonical = canonicalUsername(name);
                if (canonical && !this.users.has(canonical)) names.add(canonical);
            }
        }
        for (const name of names) {
            const u = await User.byName(db, name);
            if (u) this.users.set(name, u);
        }
    }

    // LJ::Entry::event_html. Recent pages link cuts to `cuturl`.
    event(entry: Entry, cuturl: string | undefined, suspended = false): string {
        return cleanEvent(entry.event, {
            editor: entry.props.editor, preformatted: truthy(entry.props.opt_preformatted),
            isImported: "import_source" in entry.props, logtime: entry.logtime,
            isSyndicated: entry.journal.journaltype === "Y",
            cuturl,
            journal: entry.journal.user, ditemid: entry.ditemid, suspendMsg: suspended,
        }, this.site, this.hooks);
    }

    // LJ::Entry::event_text and subject_text, for Open Graph tags.
    metadata(entry: Entry): { subject: string; event: string } {
        return {
            subject: entry.subject ? cleanSubjectAll(entry.subject, this.site) : "",
            event: entry.event ? cleanEvent(entry.event, { textonly: true }, this.site, this.hooks) : "",
        };
    }

    comment(body: string, props: Record<string, string>, datepost: string, anonymous: boolean): string {
        return cleanComment(body, {
            editor: props.editor, preformatted: truthy(props.opt_preformatted), isImported: "import_source" in props,
            datepost, anonymous, nocss: anonymous,
        }, this.site, this.hooks);
    }

    // An icon's comment or description, as IconsPage cleans them.
    iconText(text: string): string {
        return text ? clean(text, { addbreaks: false, mode: "deny" }, this.site, this.hooks) : text;
    }

    // The subject as S2 shows it, and the forms formatted_subject uses.
    subject(source: string): CleanedSubject {
        const html = cleanSubject(source, this.site);
        return { html, noLinks: removeLinks(html, this.site), text: cleanSubjectAll(html, this.site) };
    }

    // Property cleaners for LJ::S2::escape_prop_value.
    propertyCleaners(): PropertyCleaners {
        return {
            html: value => cleanEvent(value, {}, this.site, this.hooks),
            simpleHtml: value => cleanSubject(value, this.site),
            css: value => cleanCss(value),
            cssAttribute: value => cleanCss(value),
        };
    }
}
