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
import { styleInfo, styleLayers } from "../compile/styles";
import { type Databases, int } from "../data/db";
import { User } from "../data/user";
import type { RenderRequest, RenderResult } from "../render/render";
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

    // Stylesheets name their style, and are served for suspended journals.
    let styleid = int(journal.props.s2_style);
    if (mode === "res") {
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
        username: journal.user, view: mode, pathextra: view.pathextra, ditemid: view.ditemid,
        slug: view.slug !== undefined ? { slug: view.slug, date: view.date! } : undefined,
        args, requestPath: url, host, layers: compiled, style,
    };
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
