// render.ts
//
// Render one journal page, following LJ::S2::make_journal and s2_run.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import type { CompiledLayer } from "../compile/compiler";
import type { StyleInfo } from "../compile/styles";
import type { Databases } from "../data/db";
import { type Site, User } from "../data/user";
import { createBuiltins } from "./builtins";
import { createChrome } from "./chrome";
import { ContentCleaner } from "./content";
import { createContext } from "./context";
import { type S2Object, UserLite } from "./objects";
import { PageOutput } from "./output-cleaner";
import { type EntryArgs, EntryPage } from "./entry-page";
import { JOURNAL_PROPS, type PageContext, RecentPage, latestMonth, showControlStrip, visibleTags } from "./pages";
import type { RenderState } from "./state";

export interface RenderRequest {
    readonly username: string;
    readonly view: "recent" | "entry";
    readonly ditemid?: number;
    readonly skip?: number;
    readonly entryArgs?: EntryArgs;
    // The path and query as requested, for links back to this page.
    readonly requestPath: string;
    readonly host: string;
    readonly layers: readonly CompiledLayer[];
    readonly style: StyleInfo;
}

export interface RenderResult {
    readonly status: number;
    readonly html: string;
}

const MAX_OUTPUT = 16 * 1024 * 1024;

export async function renderJournal(db: Databases, site: Site, request: RenderRequest): Promise<RenderResult> {
    const journal = await User.byName(db, request.username);
    if (!journal || !journal.isVisible()) return { status: 404, html: "" };
    await journal.loadProps(db, JOURNAL_PROPS);

    const base = journal.journalBase(site);
    const documentUrl = request.view === "entry" ? `${base}/${request.ditemid}.html`
        : `${base}/${request.skip !== undefined ? `?skip=${request.skip}` : ""}`;
    const content = new ContentCleaner(site, journal);
    try {
        const users = new Map<number, User>([[journal.userid, journal]]);
        const output = new PageOutput(site.config, MAX_OUTPUT);
        const control = showControlStrip(journal);
        const chrome = createChrome({
            site, journal, view: request.view, requestPath: request.requestPath, showControlStrip: control, users,
        });
        let page: S2Object | undefined;
        let month: S2Object | undefined;
        let tags: S2Object[] = [];
        const state: RenderState = {
            site, config: site.config, journal, output, chrome, showControlStrip: control, showThreadExpander: false,
            page: () => page!,
            siteRoot: () => site.config.siteRoot,
            origin: () => `${site.config.protocol}://${site.host}`,
            userBase: name => [...users.values()].find(u => u.user === name)?.journalBase(site),
            userLite: name => {
                const u = [...users.values()].find(user => user.user === name);
                return u ? UserLite(site, u) : undefined;
            },
            visibleTags: limit => {
                const byName = (a: S2Object, b: S2Object) => a._name < b._name ? -1 : a._name > b._name ? 1 : 0;
                const list = limit ? [...tags].sort((a, b) => b._use_count - a._use_count).slice(0, limit) : [...tags];
                return list.sort(byName);
            },
            latestMonth: () => month!,
            journalCurrentDateTime: () => ({ ".type": "DateTime" }),
        };

        const cleaners = content.propertyCleaners(documentUrl);
        const s2 = createContext(request.layers, site.config, createBuiltins(state), output, cleaners);
        const pc: PageContext = {
            db, site, journal, ctx: s2.ctx, content, cleaners, style: request.style,
            nowSeconds: Math.floor(Date.now() / 1000), users, userpics: new Map(),
        };
        [month, tags] = await Promise.all([latestMonth(pc), visibleTags(pc)]);
        await preloadNamedUsers(db, request.layers, users);

        page = request.view === "entry"
            ? await EntryPage(pc, request.ditemid!, request.entryArgs ?? {}, chrome.resourceHead()) ?? undefined
            : await RecentPage(pc, request.skip ?? 0, request.skip !== undefined, chrome.resourceHead());
        if (!page) return { status: 404, html: "" };
        s2.printing = true;
        s2.ctx.runMethod(page, "print()");
        return { status: 200, html: output.finish() };
    } finally {
        content.close();
    }
}

// UserLite("name") calls in the style look users up by name mid-render, so
// load every name the layers pass it.
async function preloadNamedUsers(db: Databases, layers: readonly CompiledLayer[], users: Map<number, User>) {
    const names = new Set<string>();
    for (const layer of layers) {
        for (const match of layer.code.matchAll(/ctx\.builtin\._UserLite\(ctx, "([^"]+)"\)/g)) names.add(match[1]!);
    }
    for (const name of names) {
        const u = await User.byName(db, name);
        if (u) users.set(u.userid, u);
    }
}
