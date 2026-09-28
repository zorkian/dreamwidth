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
import { S2Error } from "../runtime/s2runtime";
import type { StyleInfo } from "../compile/styles";
import type { Databases } from "../data/db";
import { Entry } from "../data/entry";
import { type Site, User } from "../data/user";
import { createBuiltins } from "./builtins";
import { createChrome } from "./chrome";
import { ContentCleaner } from "./content";
import { createContext } from "./context";
import { type S2Object, UserLite } from "./objects";
import { PageOutput } from "./page-output";
import { type EntryArgs, EntryPage } from "./entry-page";
import { JOURNAL_PROPS, type PageContext, RecentPage, latestMonth, showControlStrip, visibleTags } from "./pages";
import type { RenderState } from "./state";

export interface RenderRequest {
    readonly username: string;
    // A view from %LJ::viewinfo, or month, entry or reply; "" for recent entries.
    readonly view: string;
    readonly pathextra?: string;
    readonly ditemid?: number;
    readonly slug?: { readonly slug: string; readonly date: string };
    readonly args: Readonly<Record<string, string>>;
    // The path and query as requested, for links back to this page.
    readonly requestPath: string;
    readonly host: string;
    readonly layers: readonly CompiledLayer[];
    readonly style: StyleInfo;
}

export interface RenderResult {
    readonly status: number;
    readonly body: string;
    readonly contentType?: string;
    readonly location?: string;
}

const MAX_OUTPUT = 16 * 1024 * 1024;

// What a stylesheet request runs, skipping any the style does not define.
const STYLESHEET_FUNCTIONS = ["Page::print_contextual_stylesheet()", "Page::print_default_stylesheet()",
    "print_stylesheet()", "Page::print_theme_stylesheet()"];

export async function renderJournal(db: Databases, site: Site, request: RenderRequest): Promise<RenderResult> {
    const journal = await User.byName(db, request.username);
    if (!journal) return { status: 404, body: "" };
    await journal.loadProps(db, JOURNAL_PROPS);

    const stylesheet = request.view === "res";
    const content = new ContentCleaner(site);
    const users = new Map<number, User>([[journal.userid, journal]]);
    const output = new PageOutput(site.config, MAX_OUTPUT, !stylesheet);
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

    const cleaners = content.propertyCleaners();
    const s2 = createContext(request.layers, site.config, createBuiltins(state), output, cleaners);
    const pc: PageContext = {
        db, site, journal, ctx: s2.ctx, content, cleaners, style: request.style,
        nowSeconds: Math.floor(Date.now() / 1000), users, userpics: new Map(),
    };

    if (stylesheet) {
        // s2_run calls these with no page, and cleans the whole of what they print as CSS.
        s2.printing = true;
        const builtin = s2.ctx.builtin;
        builtin._start_css!(s2.ctx);
        try {
            for (const name of STYLESHEET_FUNCTIONS) {
                if (s2.ctx.hasFunction(name)) s2.ctx.getFunction(name)(s2.ctx, {});
            }
        } catch (error) {
            if (!(error instanceof S2Error)) throw error;
            output.raw(`<b>Error running style:</b> ${error.message.replaceAll("\n", "<br />\n")}`);
        }
        builtin._end_css!(s2.ctx);
        return { status: 200, body: output.finish(), contentType: "text/css" };
    }

    [month, tags] = await Promise.all([latestMonth(pc), visibleTags(pc)]);
    await preloadNamedUsers(db, request.layers, users);

    const head = chrome.resourceHead();
    const number = (value?: string) => value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;
    const args = request.args;
    switch (request.view || "lastn") {
        case "lastn": {
            const skip = args.skip !== undefined ? Math.max(0, Math.trunc(Number(args.skip)) || 0) : undefined;
            page = await RecentPage(pc, skip ?? 0, skip !== undefined, head);
            break;
        }
        case "entry": {
            const entry = request.slug
                ? await Entry.bySlug(db, journal, request.slug.slug, request.slug.date)
                : await Entry.byDitemid(db, journal, request.ditemid!);
            const entryArgs: EntryArgs = { thread: number(args.thread), page: number(args.page), view: args.view, mode: args.mode };
            page = entry ? await EntryPage(pc, entry, entryArgs, head) ?? undefined : undefined;
            break;
        }
    }
    if (!page) return { status: 404, body: "" };
    s2.printing = true;
    try {
        s2.ctx.runMethod(page, "print()");
    } catch (error) {
        // s2_run shows the page so far with the style's error after it.
        if (!(error instanceof S2Error)) throw error;
        output.raw(`<b>Error running style:</b> ${error.message.replaceAll("\n", "<br />\n")}`);
    }
    // The journal controller adds LJ::PageStats' container before </body>.
    const stats = "<div id='statistics' style='text-align: left; font-size:0; line-height:0; height:0; overflow:hidden;'></div>";
    return { status: 200, body: output.finish().replace(/<\/body>/i, `${stats}</body>`) };
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
