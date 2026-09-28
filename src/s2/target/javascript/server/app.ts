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
import { styleInfo, styleIsPublic, styleLayers, styleOwner } from "../compile/styles";
import { type Databases, int } from "../data/db";
import { User } from "../data/user";
import { publicTags, parseTagFilter } from "../data/tags";
import type { JournalFilter, RenderRequest, RenderResult } from "../render/render";
import type { SiteConfig } from "./config";
import { determineView } from "./views";

export type Renderer = (request: RenderRequest) => Promise<RenderResult>;

// Views rendered by running the S2 style.
const S2_VIEWS = new Set(["lastn", "archive", "month", "day", "read", "network", "tag", "icons", "entry", "reply", "res"]);

const notFound: RenderResult = { status: 404, body: "Not found\n" };
// DW::Request::Plack sends every redirect as a 303.
const redirect = (location: string): RenderResult => ({ status: 303, body: "", location });

// Resolve a journal URL to what a render worker needs, or to a response
// that needs no rendering.
export async function prepare(config: SiteConfig, db: Databases, compiler: Compiler, url: string,
    host: string): Promise<RenderRequest | RenderResult> {
    const parsed = new URL(url, "http://journal");
    const match = /^\/(?:~|users\/)([\w-]+)(\/.*)?$/.exec(parsed.pathname);
    if (!match) return notFound;
    const journal = await User.byName(db, match[1]!.toLowerCase().replaceAll("-", "_"));
    if (!journal) return notFound;
    await journal.loadProps(db, ["s2_style", "opt_blockrobots", "adult_content"]);

    const site = { config, host };
    const base = journal.journalBase(site);
    const args = Object.fromEntries(parsed.searchParams);
    const view = determineView(match[2] ?? "/", parsed.search, args, base);
    if (!view) return notFound;
    if ("redirect" in view) return redirect(view.redirect);

    const mode = view.mode;
    if (mode === "info") return redirect(`${base}/profile${args.mode === "full" ? "?mode=full" : ""}`);
    if (mode === "update") return redirect(`${config.siteRoot}/entry/${journal.user}/new`);
    if (mode === "robots_txt") {
        const body = `User-Agent: *\n${journal.shouldBlockRobots(config) ? "Disallow: /\n" : ""}`;
        return { status: 200, body, contentType: "text/plain" };
    }
    if (mode && !S2_VIEWS.has(mode)) return notFound;

    let pathextra = view.pathextra;
    const filtered = /^\/(tag|security)\/(.*)$/s.exec(pathextra ?? "");
    if (filtered && (filtered[1] === "tag" ? mode === "lastn" && filtered[2] : mode === "lastn" || mode === "read")) {
        args[filtered[1]!] = durl(filtered[2]!);
        pathextra = undefined;
    }
    const filter = await journalFilter(config, db, journal, args, base);
    if ("status" in filter) return filter;

    // Stylesheets name their style, and are served for suspended journals.
    let styleid = int(journal.props.s2_style);
    const s2id = /^\d+$/.test(args.s2id ?? "") ? Number(args.s2id) : 0;
    if (s2id && (await styleOwner(db, s2id) === journal.userid && Number(journal.getCap(config, "s2styles"))
        || await styleIsPublic(db, s2id))) {
        styleid = s2id;
    } else if (mode === "res") {
        const res = /^\/(\d+)\/stylesheet$/.exec(view.pathextra ?? "");
        if (!res) return notFound;
        styleid = Number(res[1]);
    } else if (!journal.isVisible()) {
        return notFound;
    }
    if (journal.journaltype === "I" && !["read", "res", "icons"].includes(mode)) return notFound;

    const layers = await styleLayers(db, config, styleid);
    const [compiled, style] = await Promise.all([compiler.compile(layers), styleInfo(db, config, journal, styleid, layers)]);
    return {
        username: journal.user, view: mode, pathextra, ditemid: view.ditemid, filter,
        slug: view.slug !== undefined ? { slug: view.slug, date: view.date! } : undefined,
        args, requestPath: url, host, layers: compiled, style,
    };
}

// make_journal's tag and security filters. Where Perl shows an error page,
// this gives a bare status.
async function journalFilter(config: SiteConfig, db: Databases, journal: User, args: Record<string, string>,
    base: string): Promise<JournalFilter | RenderResult> {
    const filter: { -readonly [K in keyof JournalFilter]: JournalFilter[K] } = {};
    if ("tag" in args) {
        if (!args.tag) return redirect(`${base}/tag/`);
        const tags = config.enabled.tags ? parseTagFilter(args.tag) : undefined;
        if (!tags) return notFound;
        const kwids = new Map((await publicTags(db, journal)).map(tag => [tag.name, tag.kwid]));
        if (!tags.every(tag => kwids.has(tag))) return notFound;
        filter.tags = tags;
        filter.tagids = tags.map(tag => kwids.get(tag)!);
        filter.tagmode = args.mode === "and" || args.mode === "all" ? "and" : "or";
    }
    if ("security" in args) {
        if (!args.security) return notFound;
        if (!Number(config.capDefaults.security_filter) && !Number(journal.getCap(config, "security_filter"))) {
            return { status: 403, body: "Forbidden\n" };
        }
        const security = args.security.toLowerCase();
        if (!config.enabled.security_filter || !/^(public|access|private|friends)$/.test(security)) return notFound;
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

export function createApp(config: SiteConfig, db: Databases, compiler: Compiler, render: Renderer): FastifyInstance {
    const app = Fastify({ logger: false });
    const handler = async (request: any, reply: any) => {
        const prepared = await prepare(config, db, compiler, request.url, request.headers.host ?? "localhost");
        const result = "layers" in prepared ? await render(prepared) : prepared;
        if (result.location) reply.header("location", result.location);
        return reply.code(result.status).type(`${result.contentType ?? "text/html"}; charset=utf-8`).send(result.body);
    };
    for (const prefix of ["/~:user", "/users/:user"]) {
        app.get(prefix, handler);
        app.get(`${prefix}/*`, handler);
    }
    return app;
}
