// app.ts
//
// HTTP routes for journal pages, following DW::Controller::Journal::render
// and LJ::User::make_journal up to the point S2 takes over.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import Fastify, { type FastifyInstance } from "fastify";
import type { Compiler } from "../compile/compiler";
import { styleInfo, styleIsPublic, styleLayers, styleOwner, systemLayers } from "../compile/styles";
import { type Databases, int, text } from "../data/db";
import { User } from "../data/user";
import { publicTags, parseTagFilter } from "../data/tags";
import { type JournalFilter, type RenderRequest, type RenderResult, PERL_PAGE } from "../render/render";
import type { SiteConfig } from "./config";
import { currentSecret, randChars } from "../render/reply-page";
import { deletedJournalVars, renderSitePage, templateUser } from "../render/site-page";
import type { Stash } from "../template";
import { determineView } from "./views";

export type Renderer = (request: RenderRequest) => Promise<RenderResult>;

// Views rendered by running the S2 style.
const S2_VIEWS = new Set(["lastn", "archive", "month", "day", "read", "network", "tag", "icons", "entry", "reply", "res"]);

// DW::Request::Plack sends every redirect as a 303.
const redirect = (location: string): RenderResult => ({ status: 303, body: "", location });

export interface Visitor {
    // The ljuniq cookie identity.
    readonly uniq: string;
    // The Cookie header.
    readonly cookie: string;
}

// Resolve a journal URL to what a render worker needs, or to a response
// that needs no rendering.
export async function prepare(config: SiteConfig, db: Databases, compiler: Compiler, url: string,
    host: string, visitor: Visitor = { uniq: "", cookie: "" }): Promise<RenderRequest | RenderResult> {
    const parsed = new URL(url, "http://journal");
    const target = journalPath(config, host, parsed.pathname);
    if (!target) return PERL_PAGE;
    const site = { config, host };
    const args = Object.fromEntries(parsed.searchParams);
    const sitePage = async (view: string, vars: Stash, journal?: User, status?: number) => renderSitePage({
        site, url, args, cookie: visitor.cookie, uniq: visitor.uniq, journal, secret: await currentSecret(db),
    }, view, vars, status);
    const username = target.user.toLowerCase().replaceAll("-", "_");
    const journal = await User.byName(db, username);
    if (!journal) return sitePage("error/unknown-user.tt", { user: username });
    await journal.loadProps(db, ["s2_style", "opt_blockrobots", "adult_content"]);

    const base = journal.journalBase(site);
    const journalError = (view: string, vars: Stash = {}, status?: number) => sitePage(view, vars, journal, status);
    const view = determineView(target.path, parsed.search, args, base);
    if (!view) return PERL_PAGE;
    if ("redirect" in view) return redirect(view.redirect);

    const mode = view.mode;
    if (mode === "info") return redirect(`${base}/profile${args.mode === "full" ? "?mode=full" : ""}`);
    if (mode === "update") return redirect(`${config.siteRoot}/entry/${journal.user}/new`);
    if (mode === "robots_txt") {
        const body = `User-Agent: *\n${journal.shouldBlockRobots(config) ? "Disallow: /\n" : ""}`;
        return { status: 200, body, contentType: "text/plain" };
    }
    if (mode && !S2_VIEWS.has(mode)) return PERL_PAGE;
    if (mode === "network" && !Number(journal.getCap(config, "friendsfriendsview"))) {
        return journalError("error.tt", { message: config.strings["cprod.friendsfriendsinline.text3.v1"] });
    }

    let pathextra = view.pathextra;
    const filtered = /^\/(tag|security)\/(.*)$/s.exec(pathextra ?? "");
    if (filtered && (filtered[1] === "tag" ? mode === "lastn" && filtered[2] : mode === "lastn" || mode === "read")) {
        args[filtered[1]!] = durl(filtered[2]!);
        pathextra = undefined;
    }
    const filter = await journalFilter(config, db, journal, args, base, journalError);
    if ("status" in filter) return filter;

    // The style, as make_journal's get_styleinfo picks it. Stylesheets name
    // theirs, and are served for suspended journals.
    let styleid = int(journal.props.s2_style);
    const hasFeedStyle = journal.journaltype === "Y" && Object.keys(config.defaultFeedStyle).length > 0;
    let feedStyle = false;
    if (mode === "res") {
        const res = /^\/(\d+)\/stylesheet$/.exec(view.pathextra ?? "");
        if (!res) return PERL_PAGE;
        styleid = Number(res[1]);
        // Style 0 is no style, so a feed's stylesheet keeps the feed style.
        feedStyle = !styleid && hasFeedStyle;
    } else {
        if (journal.statusvis === "D") {
            return journalError("journal/deleted.tt", await deletedJournalVars(db, site, journal), 404);
        }
        if (journal.statusvis === "S") return journalError("error/suspended.tt", { u: templateUser(site, journal) });
        const s2id = /^\d+$/.test(args.s2id ?? "") ? Number(args.s2id) : 0;
        if (s2id && (await styleOwner(db, s2id) === journal.userid && Number(journal.getCap(config, "s2styles"))
            || await styleIsPublic(db, s2id))) {
            styleid = s2id;
        } else if (hasFeedStyle) {
            feedStyle = true;
            styleid = 0;
        }
    }
    if (journal.statusvis === "X") return journalError("error/purged.tt");
    if (journal.journaltype === "I" && !["read", "res", "icons"].includes(mode)) {
        const [identity] = await db.global("SELECT idtype, identity FROM identitymap WHERE userid = ? LIMIT 1", [journal.userid]);
        const openid = text(identity?.idtype) === "O" ? text(identity!.identity) : undefined;
        return journalError("error/openid-user.tt", { u: templateUser(site, journal, openid) });
    }
    // Locked, memorial, read-only and renamed journals.
    if (mode !== "res" && !journal.isVisible()) return PERL_PAGE;

    const layers = feedStyle ? await systemLayers(db, config.defaultFeedStyle) : await styleLayers(db, config, styleid);
    const [compiled, style] = await Promise.all([compiler.compile(layers), styleInfo(db, config, journal, styleid, layers)]);
    return {
        username: journal.user, view: mode, pathextra, ditemid: view.ditemid, filter,
        slug: view.slug !== undefined ? { slug: view.slug, date: view.date! } : undefined,
        args, requestPath: url, host, layers: compiled, style, uniq: visitor.uniq,
    };
}

// make_journal's tag and security filters.
async function journalFilter(config: SiteConfig, db: Databases, journal: User, args: Record<string, string>,
    base: string, error: (view: string, vars: Stash) => Promise<RenderResult>): Promise<JournalFilter | RenderResult> {
    const filter: { -readonly [K in keyof JournalFilter]: JournalFilter[K] } = {};
    if ("tag" in args) {
        if (!args.tag) return redirect(`${base}/tag/`);
        const tagError = (errmsg: string) => error("error/tagview.tt", { errmsg });
        if (!config.enabled.tags) return tagError("error.tag.disabled");
        const tags = parseTagFilter(args.tag);
        if (!tags) return tagError("error.tag.invalid");
        const kwids = new Map((await publicTags(db, journal)).map(tag => [tag.name, tag.kwid]));
        if (!tags.every(tag => kwids.has(tag))) return tagError("error.tag.undef");
        filter.tags = tags;
        filter.tagids = tags.map(tag => kwids.get(tag)!);
        filter.tagmode = args.mode === "and" || args.mode === "all" ? "and" : "or";
    }
    if ("security" in args) {
        // Perl explains a missing or refused security filter on a page in the site's style.
        const security = (args.security ?? "").toLowerCase();
        if (!security || !Number(config.capDefaults.security_filter) && !Number(journal.getCap(config, "security_filter"))
            || !config.enabled.security_filter || !/^(public|access|private|friends)$/.test(security)) {
            return PERL_PAGE;
        }
        filter.security = security === "friends" ? "access" : security;
    }
    return filter;
}

// LJ::durl
function durl(text: string): string {
    try {
        return decodeURIComponent(text.replaceAll("+", " "));
    } catch {
        return text;
    }
}

// The journal and path a request is for, as Plack::Middleware::DW::SubdomainFunction
// and app.psgi find them: a user's subdomain, a "journal" subdomain with the
// username first in the path, or /~user and /users/user on any host.
function journalPath(config: SiteConfig, host: string, path: string): { user: string; path: string } | undefined {
    const domain = config.userDomain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sub = domain ? new RegExp(`^([\\w-]{1,25})\\.${domain}$`, "i").exec(host.replace(/:\d+$/, "")) : null;
    if (sub && sub[1] !== "www") {
        const func = config.subdomainFunction[sub[1]!];
        if (func === undefined) return { user: sub[1]!, path: path || "/" };
        if (func !== "journal") return undefined;
        const match = /^\/(\w{1,25})(\/.*)?$/.exec(path);
        return match ? { user: match[1]!, path: match[2] ?? "/" } : undefined;
    }
    const match = /^\/(?:~|users\/)([\w-]+)(\/.*)?$/.exec(path);
    return match ? { user: match[1]!, path: match[2] ?? "/" } : undefined;
}

export function createApp(config: SiteConfig, db: Databases, compiler: Compiler, render: Renderer): FastifyInstance {
    const app = Fastify({ logger: false });
    const handler = async (request: any, reply: any) => {
        // LJ::UniqCookie::parts_from_value; reply forms give a new visitor one, as Perl's middleware does.
        const cookie = /(?:^|;\s*)ljuniq=([^;]*)/.exec(request.headers.cookie ?? "");
        const known = /^([a-zA-Z0-9]{15}):(\d+)(.+)$/.exec(cookie ? decodeURIComponent(cookie[1]!) : "")?.[1];
        const uniq = known ?? randChars(15);
        const prepared = await prepare(config, db, compiler, request.url, request.headers.host ?? "localhost",
            { uniq, cookie: request.headers.cookie ?? "" });
        const result = "layers" in prepared ? await render(prepared) : prepared;
        if (result.location) reply.header("location", result.location);
        if (!known && "layers" in prepared && prepared.view === "reply") {
            const now = Math.floor(Date.now() / 1000);
            reply.header("set-cookie", `ljuniq=${encodeURIComponent(`${uniq}:${now}`)}; path=/; ` +
                `expires=${new Date((now + 60 * 86400) * 1000).toUTCString()}; SameSite=Lax`);
        }
        return reply.code(result.status).type(`${result.contentType ?? "text/html"}; charset=utf-8`).send(result.body);
    };
    app.get("/*", handler);
    return app;
}
