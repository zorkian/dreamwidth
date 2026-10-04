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
import { type LayerRef, siteviewsLayers, styleInfo, styleIsPublic, styleLayers, styleOwner, systemLayers } from "../compile/styles";
import { type Databases, int, text } from "../data/db";
import { Session } from "../data/session";
import { User, journalBase } from "../data/user";
import { publicTags, parseTagFilter } from "../data/tags";
import { type JournalFilter, type RenderRequest, type RenderResult, PERL_PAGE } from "../render/render";
import type { SiteConfig } from "./config";
import { currentSecret, randChars } from "../render/reply-page";
import { viewingStyle } from "../render/chrome";
import { styleUrl } from "../render/objects";
import { renderFeed } from "../render/feed";
import { renderFaqBrowse, renderFaqIndex } from "../render/faq-page";
import { renderProfile } from "../render/profile-page";
import { renderStaticPage } from "../render/static-page";
import { currentScheme, deletedJournalVars, notFoundPage, renderSitePage, templateUser } from "../render/site-page";
import type { Stash } from "../template";
import { healthy } from "./health";
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
    // LJ::get_remote_ip, or undefined when this server cannot tell it.
    readonly remoteIp?: string;
    // The If-Modified-Since header.
    readonly ifModifiedSince?: string;
}

// Resolve a journal URL to what a render worker needs, or to a response
// that needs no rendering.
export async function prepare(config: SiteConfig, db: Databases, compiler: Compiler, url: string,
    host: string, visitor: Visitor = { uniq: "", cookie: "" }): Promise<RenderRequest | RenderResult> {
    const parsed = new URL(url, "http://journal");
    const target = journalPath(config, host, parsed.pathname);
    if (target ? userRoute(config, parsed.pathname) : !isSiteHost(config, host)) return PERL_PAGE;
    // Logged-in viewers are identified, but their pages are not built here yet.
    const session = await Session.fromCookies(db, config,
        { host, path: parsed.pathname, cookie: visitor.cookie, remoteIp: visitor.remoteIp });
    if (session) return PERL_PAGE;
    const site = { config, host };
    if (!target) return siteRoute(db, site, url, visitor);
    const args = Object.fromEntries(parsed.searchParams);
    // ?style=light shows the site's own pages in its text-only scheme.
    const light = viewingStyle(args) === "light" ? "lynx" : undefined;
    const siteRequest = async (journal?: User, scheme?: string) => ({
        site, url, args, cookie: visitor.cookie, uniq: visitor.uniq, journal, secret: await currentSecret(db), scheme,
    });
    const sitePage = async (view: string, vars: Stash, journal?: User, status?: number, scheme?: string) =>
        renderSitePage(await siteRequest(journal, scheme), view, vars, status);
    const notFound = async (journal?: User) => notFoundPage(await siteRequest(journal));
    // DW::Controller::Journal hands /profile to DW::Controller::Profile.
    const profile = async (user: string) => args.uselang ? PERL_PAGE :
        renderProfile(db, { site, url, args, cookie: visitor.cookie, uniq: visitor.uniq, host, journal: user });
    const username = target.user.toLowerCase().replaceAll("-", "_");
    const journal = await User.byName(db, username);
    const base = journal ? journal.journalBase(site) : journalBase(site, username);
    const view = determineView(target.path, parsed.search, args, base, !!journal);
    if (!view) return notFound();
    if ("redirect" in view) return redirect(view.redirect);

    const mode = view.mode;
    if (!journal) {
        if (mode === "profile") return profile(username);
        if (["info", "update", "robots_txt"].includes(mode)) return notFound();
        return sitePage("error/unknown-user.tt", { user: username });
    }
    await journal.loadProps(db, ["s2_style", "opt_blockrobots", "adult_content", "renamedto"]);
    const renamedTo = journal.journaltype === "R" && journal.statusvis === "R" ? journal.props.renamedto ?? "" : "";
    if (renamedTo) {
        if (/^https?:\/\//.test(renamedTo)) return redirect(renamedTo);
        const to = await User.byName(db, renamedTo);
        return redirect(`${to ? to.journalBase(site) : journalBase(site, renamedTo)}${target.path}${parsed.search}`);
    }
    const journalError = (view: string, vars: Stash = {}, status?: number) => sitePage(view, vars, journal, status, light);
    if (mode === "profile") return profile(journal.user);
    if (mode === "info") return redirect(`${base}/profile${args.mode === "full" ? "?mode=full" : ""}`);
    if (mode === "update") return redirect(`${config.siteRoot}/entry/${journal.user}/new`);
    if (mode === "robots_txt") {
        const body = `User-Agent: *\n${journal.shouldBlockRobots(config) ? "Disallow: /\n" : ""}`;
        return { status: 200, body, contentType: "text/plain" };
    }
    if (mode && !S2_VIEWS.has(mode) && mode !== "data") return PERL_PAGE;
    if (mode === "network" && !Number(journal.getCap(config, "friendsfriendsview"))) {
        return sitePage("error.tt", { message: config.strings["cprod.friendsfriendsinline.text3.v1"] }, journal);
    }

    let pathextra = view.pathextra;
    const filtered = /^\/(tag|security)\/(.*)$/s.exec(pathextra ?? "");
    if (filtered && (filtered[1] === "tag" ? mode === "lastn" && filtered[2] : mode === "lastn" || mode === "read")) {
        args[filtered[1]!] = durl(filtered[2]!);
        pathextra = undefined;
    }
    const filter = await journalFilter(config, db, journal, args, base, journalError, mode, `${config.protocol}://${host.toLowerCase()}`);
    if ("status" in filter) return filter;

    // The style, as make_journal's get_styleinfo picks it. Stylesheets name
    // theirs, and are served for suspended journals.
    let styleid = int(journal.props.s2_style);
    const hasFeedStyle = journal.journaltype === "Y" && Object.keys(config.defaultFeedStyle).length > 0;
    let feedStyle = false;
    const res = mode === "res" ? /^\/(\d+)\/stylesheet$/.exec(view.pathextra ?? "") : null;
    if (res) {
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
    if (mode === "res" && !res) return notFound(journal);
    if (mode === "data") {
        const feed = await renderFeed(db, site, journal,
            { pathextra: view.pathextra, args, filter, ifModifiedSince: visitor.ifModifiedSince });
        return feed === "perl" ? PERL_PAGE : feed === "notfound" ? notFound(journal) : feed;
    }

    // The site's own style, which ?style=site and ?style=light ask for, and
    // entry and icons pages use when the journal's style does not show them.
    let siteviews: RenderRequest["siteviews"];
    let siteviewsRefs: LayerRef[] = [];
    const forced = mode !== "res" && (viewingStyle(args) === "site" || !!light);
    if (forced || ["entry", "reply", "icons"].includes(mode)) {
        const scheme = currentScheme(config, args, visitor.cookie, light);
        siteviewsRefs = await siteviewsLayers(db, config.siteTemplates.schemeList[scheme]!);
        siteviews = { layers: await compiler.compile(siteviewsRefs), forced, scheme: light };
    }
    if (forced) styleid = 0;
    const layers = forced ? siteviewsRefs
        : feedStyle ? await systemLayers(db, config.defaultFeedStyle) : await styleLayers(db, config, styleid);
    const [compiled, style] = await Promise.all([compiler.compile(layers), styleInfo(db, config, journal, styleid, layers)]);
    return {
        username: journal.user, view: mode, pathextra, ditemid: view.ditemid, filter,
        slug: view.slug !== undefined ? { slug: view.slug, date: view.date! } : undefined,
        args, requestPath: url, host, layers: compiled, style, uniq: visitor.uniq, cookie: visitor.cookie, siteviews,
        remoteId: null,
    };
}

// Whether `host` is the site's own, rather than a journal's or a special subdomain.
function isSiteHost(config: SiteConfig, host: string): boolean {
    const name = host.replace(/:\d+$/, "").toLowerCase();
    if (name === config.domainWeb.toLowerCase() || name === config.domain.toLowerCase()) return true;
    // A devcontainer serves everything from its own host.
    return config.isDevServer && !config.userDomain;
}

// The site's own pages this server renders for anonymous visitors; anything
// else on the site's host is left to Perl.
async function siteRoute(db: Databases, site: { config: SiteConfig; host: string }, url: string,
    visitor: Visitor): Promise<RenderResult> {
    const parsed = new URL(url, "http://site");
    const args = Object.fromEntries(parsed.searchParams);
    // Pages in a language other than the default are left to Perl.
    if (args.uselang) return PERL_PAGE;
    if (parsed.pathname === "/profile") {
        return renderProfile(db, { site, url, args, cookie: visitor.cookie, uniq: visitor.uniq, host: site.host });
    }
    const request = { site, url, path: parsed.pathname, args, cookie: visitor.cookie, uniq: visitor.uniq };
    if (parsed.pathname === "/support/faq") return renderFaqIndex(db, request);
    if (parsed.pathname === "/support/faqbrowse") return await renderFaqBrowse(db, request) ?? PERL_PAGE;
    return await renderStaticPage(db, request) ?? PERL_PAGE;
}

// Whether DW::Routing gives this path to a user controller, or to the API,
// before DW::Controller::Journal looks for a journal view.
function userRoute(config: SiteConfig, path: string): boolean {
    const uri = /^(.+?)\.[a-z]+$/.exec(path)?.[1] ?? path;
    let patterns = routePatterns.get(config);
    if (!patterns) {
        patterns = config.userRoutes.patterns.map(pattern => new RegExp(pattern.source, pattern.flags));
        routePatterns.set(config, patterns);
    }
    return /^\/api\/v\d+\/./.test(uri) || config.userRoutes.paths.includes(uri) || patterns.some(pattern => pattern.test(uri));
}
const routePatterns = new WeakMap<SiteConfig, RegExp[]>();

// LJ::get_remote_ip, as Plack::Middleware::DW::XForwardedFor sets it.
function remoteIp(config: SiteConfig, request: { ip: string; headers: Record<string, unknown> }): string | undefined {
    const forwarded = String(request.headers["x-forwarded-for"] ?? "");
    if (config.remoteIp.trustXHeaders && forwarded) {
        if (config.remoteIp.trustedProxyIsCode) return undefined;
        return forwarded.split(/\s*,\s*/)[0];
    }
    return request.ip.replace(/^::ffff:/, "");
}

// make_journal's tag and security filters.
// `origin` is where the security filter list links, as Perl's create_url
// sends them to the bare path on the requested host.
async function journalFilter(config: SiteConfig, db: Databases, journal: User, args: Record<string, string>,
    base: string, error: (view: string, vars: Stash) => Promise<RenderResult>, mode: string,
    origin: string): Promise<JournalFilter | RenderResult> {
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
        // A visitor may list only public entries, and only on recent entries pages.
        const securityError = (message: string | undefined, showList = false) => error("journal/security.tt", {
            message,
            ...showList && mode === "lastn" ? {
                levels: [{ link: styleUrl(args, `${origin}/security/public`), name_ml: "label.security.public" }], groups: [],
            } : {},
        });
        const security = (args.security ?? "").toLowerCase();
        if (!args.security || args.security === "0") return securityError(undefined, true);
        if (!Number(config.capDefaults.security_filter) && !Number(journal.getCap(config, "security_filter"))) {
            return securityError("error.security.nocap2");
        }
        if (!config.enabled.security_filter) return securityError("error.security.disabled2");
        if (!/^(public|access|private|friends)$/.test(security)) return securityError("error.security.invalid2", true);
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

export function createApp(config: SiteConfig, db: Databases, compiler: Compiler, render: Renderer,
    pingRenderer: () => Promise<boolean>): FastifyInstance {
    const app = Fastify({ logger: false });
    const handler = async (request: any, reply: any) => {
        // LJ::UniqCookie::parts_from_value; reply forms give a new visitor one, as Perl's middleware does.
        const cookie = /(?:^|;\s*)ljuniq=([^;]*)/.exec(request.headers.cookie ?? "");
        const known = /^([a-zA-Z0-9]{15}):(\d+)(.+)$/.exec(cookie ? decodeURIComponent(cookie[1]!) : "")?.[1];
        const uniq = known ?? randChars(15);
        const prepared = await prepare(config, db, compiler, request.url, request.headers.host ?? "localhost",
            { uniq, cookie: request.headers.cookie ?? "", remoteIp: remoteIp(config, request),
                ifModifiedSince: request.headers["if-modified-since"] });
        const result = "layers" in prepared ? await render(prepared) : prepared;
        if (result.location) reply.header("location", result.location);
        if (result.lastModified) reply.header("last-modified", result.lastModified);
        if (!known && "layers" in prepared && prepared.view === "reply") {
            const now = Math.floor(Date.now() / 1000);
            reply.header("set-cookie", `ljuniq=${encodeURIComponent(`${uniq}:${now}`)}; path=/; ` +
                `expires=${new Date((now + 60 * 86400) * 1000).toUTCString()}; SameSite=Lax`);
        }
        return reply.code(result.status).type(`${result.contentType ?? "text/html"}; charset=utf-8`).send(result.body);
    };
    // On any host, since load balancers check by address.
    app.get("/admin/healthy", async (_request, reply) => {
        const { status, body } = await healthy(config, db, pingRenderer);
        return reply.code(status).type("text/plain; charset=utf-8").send(body);
    });
    app.get("/*", handler);
    return app;
}
