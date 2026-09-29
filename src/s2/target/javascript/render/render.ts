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
import { type Context, S2Error } from "../runtime/s2runtime";
import type { SiteConfig } from "../server/config";
import type { StyleInfo } from "../compile/styles";
import type { Databases } from "../data/db";
import { Entry, truthy } from "../data/entry";
import { type Site, User } from "../data/user";
import { createBuiltins } from "./builtins";
import { createChrome, viewingStyle } from "./chrome";
import { PAGE_STATS, journalResources, siteSettings, standardResources } from "./resources";
import { ContentCleaner } from "./content";
import { createContext } from "./context";
import { type S2Object, UserLite, eurl } from "./objects";
import { OutputLimitError, PageOutput } from "./page-output";
import { EntryPage } from "./entry-page";
import { DayPage, MonthPage, YearPage } from "./archive-pages";
import { IconsPage } from "./icons-page";
import { FriendsPage } from "./reading-page";
import { ReplyPage, currentSecret } from "./reply-page";
import { type SiteRequest, notFoundPage, renderSitePage, renderSiteString, templateUser } from "./site-page";
import {
    type DayCounts, JOURNAL_PROPS, type PageContext, RecentPage, TagsPage, journalDayCounts, latestMonth, showControlStrip,
    visibleTags,
} from "./pages";
import type { RenderState } from "./state";

export interface RenderRequest {
    readonly username: string;
    // A view from %LJ::viewinfo, or month, entry or reply; "" for recent entries.
    readonly view: string;
    readonly pathextra?: string;
    readonly ditemid?: number;
    readonly slug?: { readonly slug: string; readonly date: string };
    readonly args: Readonly<Record<string, string>>;
    readonly filter: JournalFilter;
    // The visitor's ljuniq cookie identity, for the reply form.
    readonly uniq: string;
    // The Cookie header, for the visitor's site scheme.
    readonly cookie: string;
    // The site's own style, used when `forced` or when the journal's style
    // does not show this view.
    readonly siteviews?: { readonly layers: readonly CompiledLayer[]; readonly forced: boolean; readonly scheme?: string };
    // The path and query as requested, for links back to this page.
    readonly requestPath: string;
    readonly host: string;
    readonly layers: readonly CompiledLayer[];
    readonly style: StyleInfo;
}

// Entry filters from the URL, validated as LJ::User::make_journal does.
export interface JournalFilter {
    readonly tags?: readonly string[];
    readonly tagids?: readonly number[];
    readonly tagmode?: "and" | "or";
    // public, access or private.
    readonly security?: string;
}

export interface RenderResult {
    readonly status: number;
    readonly body: string;
    readonly contentType?: string;
    readonly location?: string;
}

const MAX_OUTPUT = 16 * 1024 * 1024;

// For pages only Perl renders: adult content warnings, which depend on what
// the visitor has confirmed, and reply forms that need its checks on the visitor.
export const PERL_PAGE: RenderResult = { status: 501, body: "This page is rendered by the Perl site.\n" };

// DW::Controller::Journal's plain error pages, padded so browsers show them.
export function plainError(status: number, html: string): RenderResult {
    return { status, body: html + "<!-- xxxxxxxxxxxxxxxxxxxxxxxxxxxx -->\n".repeat(100) };
}

// The views DW::Controller::Journal checks for adult content.
const ADULT_VIEWS = new Set(["read", "archive", "month", "day", "tag", "entry", "reply", "lastn"]);

// What a stylesheet request runs, skipping any the style does not define.
const STYLESHEET_FUNCTIONS = ["Page::print_contextual_stylesheet()", "Page::print_default_stylesheet()",
    "print_stylesheet()", "Page::print_theme_stylesheet()"];

export async function renderJournal(db: Databases, site: Site, request: RenderRequest): Promise<RenderResult> {
    const journal = await User.byName(db, request.username);
    if (!journal) return PERL_PAGE;
    await journal.loadProps(db, JOURNAL_PROPS);

    const stylesheet = request.view === "res";
    const content = new ContentCleaner(site);
    const users = new Map<number, User>([[journal.userid, journal]]);
    const output = new PageOutput(site.config, MAX_OUTPUT, !stylesheet);
    let control = showControlStrip(journal);
    const resources = standardResources(site.config);
    const chrome = createChrome({
        site, journal, view: request.view, requestPath: request.requestPath, args: request.args,
        get showControlStrip() { return control; }, users, resources,
    });
    let page: S2Object | { errors: string[] } | undefined;
    let month: S2Object | undefined;
    let tags: S2Object[] = [];
    const state: RenderState = {
        site, config: site.config, journal, output, resources, chrome, showThreadExpander: false,
        get showControlStrip() { return control; },
        args: request.args, cleanSite: content.site,
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
    const builtins = createBuiltins(state);
    let s2 = createContext(request.layers, site.config, builtins, output, cleaners);

    const view = request.view || "lastn";
    const entry = view !== "entry" && view !== "reply" ? undefined : request.slug
        ? await Entry.bySlug(db, journal, request.slug.slug, request.slug.date)
        : await Entry.byDitemid(db, journal, request.ditemid!);
    if (entry) await Entry.fill(db, journal, [entry]);
    const siteRequest = async (): Promise<SiteRequest> => ({
        site, url: request.requestPath, args: request.args, cookie: request.cookie, uniq: request.uniq, journal,
        secret: await currentSecret(db),
    });
    // Unlike Perl, an entry or comment the visitor cannot see gets the same
    // 404 as one that does not exist (RFC 9110, section 15.5.5), so the
    // response never reveals which. A URL with the wrong anum names no entry.
    const unavailable = async () => {
        const [path] = request.requestPath.split("?");
        const query = Object.keys(request.args).sort().map(key => `${eurl(key)}=${eurl(request.args[key])}`).join("&");
        const returnto = `${site.config.protocol}://${request.host.toLowerCase()}${path}${query ? `?${query}` : ""}`;
        return renderSitePage({ ...await siteRequest(), scheme: request.siteviews?.scheme }, "error/unavailable.tt",
            { returnto }, 404);
    };
    if (view === "entry" || view === "reply") {
        const poster = entry && (entry.posterid === journal.userid ? journal
            : (await User.byIds(db, [entry.posterid])).get(entry.posterid));
        if (!entry || entry.security !== "public" || poster?.statusvis === "S") return unavailable();
        // A public entry was already seen to exist, so its suspension is shown.
        if (entry.isSuspended()) {
            return renderSitePage(await siteRequest(), "error/suspended-entry.tt", { u: templateUser(site, journal) });
        }
    }
    if (request.view === "reply" && site.config.talkform.captcha) return PERL_PAGE;

    // LJ::S2::make_journal's switch to the site's own style, which shows
    // no control strip and gives its sections to the site scheme.
    const siteviews = request.siteviews && (request.siteviews.forced || usesSiteviews(site.config, journal, request, s2.ctx))
        ? request.siteviews : undefined;
    const sections: Record<string, unknown> = {};
    if (siteviews) {
        control = false;
        if (!siteviews.forced) s2 = createContext(siteviews.layers, site.config, builtins, output, cleaners);
        (s2.ctx.prop as Record<string, unknown>)._SITEVIEWS = { ".type": "Siteviews", _content: sections };
    }
    const pc: PageContext = {
        args: request.args, resources, db, site, journal, ctx: s2.ctx, content, cleaners, style: request.style,
        nowSeconds: Math.floor(Date.now() / 1000), users, userpics: new Map(), siteviews: !!siteviews,
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
            styleError(output, error);
        }
        builtin._end_css!(s2.ctx);
        return { status: 200, body: output.finish(), contentType: "text/css" };
    }

    // DW::Logic::AdultContent::interstitial_type: a logged-out visitor is shown
    // a warning first, unless they have confirmed it, which only Perl can tell.
    if (site.config.enabled.adult_content && ADULT_VIEWS.has(view) && journal.isVisible()) {
        const level = entry?.adultContentCalculated() || journal.props.adult_content || "none";
        if (level !== "none") return PERL_PAGE;
    }

    let counts: DayCounts;
    [counts, tags] = await Promise.all([journalDayCounts(pc), visibleTags(pc)]);
    month = latestMonth(pc, counts);
    await preloadNamedUsers(db, request.layers, users);

    const args = request.args;
    switch (view) {
        case "lastn":
            if (!request.pathextra) page = await RecentPage(pc, args, request.filter);
            break;
        case "reply": {
            const result = await ReplyPage(pc, entry!, request.uniq);
            if (!result) return unavailable();
            if ("response" in result) return result.response;
            page = result;
            break;
        }
        case "tag":
            if (!request.pathextra) page = await TagsPage(pc);
            break;
        case "icons":
            page = await IconsPage(pc, request.requestPath.split("?")[0]!);
            break;
        case "read":
        case "network": {
            const result = await FriendsPage(pc, request.view as "read" | "network", request.pathextra, request.filter);
            if ("response" in result) return result.response;
            page = result;
            break;
        }
        case "archive":
            page = await YearPage(pc, counts, request.pathextra);
            break;
        case "month":
            page = await MonthPage(pc, counts, request.pathextra);
            break;
        case "day":
            page = await DayPage(pc, counts, request.pathextra);
            break;
        case "entry":
            page = entry ? await EntryPage(pc, entry) ?? undefined : undefined;
            break;
    }
    if (!page) return notFoundPage(await siteRequest());
    if ("errors" in page) {
        // Perl's map takes in the closing tag too.
        const items = [...page.errors as string[], "</ul>"].map(error => `<li>${error}</li>`).join("");
        return { status: 200, body: `Errors occurred processing this page:<ul>${items}` };
    }
    journalResources(resources, journal, control, !!siteviews);
    if (!siteviews) page._head_content += siteSettings(site, journal) + resources.includes("stylesheets");
    s2.printing = true;
    try {
        s2.ctx.runMethod(page, "print()");
    } catch (error) {
        styleError(output, error);
    }
    if (siteviews) {
        return renderSiteString({
            site, url: request.requestPath, args: request.args, cookie: request.cookie, uniq: request.uniq, journal,
            secret: await currentSecret(db), resources, scheme: siteviews.scheme,
        }, output.finish(), sections);
    }
    // The journal controller adds LJ::PageStats' container before </body>.
    return { status: 200, body: output.finish().replace(/<\/body>/i, `${PAGE_STATS}</body>`) };
}

// s2_run shows the page so far with whatever stopped the style after it.
// Errors other than the style's own are also logged, as they may be ours.
function styleError(output: PageOutput, error: unknown): void {
    if (error instanceof OutputLimitError || !(error instanceof Error)) throw error;
    if (!(error instanceof S2Error)) console.error(error);
    output.raw(`<b>Error running style:</b> ${error.message.replaceAll("\n", "<br />\n")}`);
}

// Whether LJ::User::make_journal and LJ::S2::make_journal would render this
// page with the siteviews style instead of the journal's.
function usesSiteviews(config: SiteConfig, journal: User, request: RenderRequest, ctx: Context): boolean {
    const style = viewingStyle(request.args);
    if (style === "site" || style === "light") return true;
    const view = request.view;
    if (view === "entry" || view === "reply") {
        const prop = journal.props.use_journalstyle_entry_page;
        const journalStyle = prop === "Y" || prop !== "N" && truthy(ctx.prop._use_journalstyle_entry_page);
        return journal.journaltype === "Y" || !journalStyle || !Number(journal.getCap(config, `s2view${view}`));
    }
    if (view === "icons") {
        return journal.journaltype === "Y" || !ctx.hasClass("IconsPage") || !truthy(journal.props.use_journalstyle_icons_page);
    }
    return false;
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
