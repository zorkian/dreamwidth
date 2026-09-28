// app.ts
//
// HTTP routes for journal pages.
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
import type { Databases } from "../data/db";
import { User } from "../data/user";
import type { RenderRequest, RenderResult } from "../render/render";
import type { SiteConfig } from "./config";

export type Renderer = (request: RenderRequest) => Promise<RenderResult>;

export function createApp(config: SiteConfig, db: Databases, compiler: Compiler, render: Renderer): FastifyInstance {
    const app = Fastify({ logger: false });

    const serve = async (host: string, url: string, username: string, view: "recent" | "entry",
        ditemid?: number, skip?: number): Promise<RenderResult> => {
        const journal = await User.byName(db, username.toLowerCase().replaceAll("-", "_"));
        if (!journal || !journal.isVisible()) return { status: 404, html: "Journal not found\n" };
        await journal.loadProps(db, ["s2_style"]);
        const layers = await styleLayers(db, config, journal);
        const [compiled, style] = await Promise.all([compiler.compile(layers), styleInfo(db, config, journal, layers)]);
        return render({ username: journal.user, view, ditemid, skip, requestPath: url, host, layers: compiled, style });
    };

    const handler = (view: "recent" | "entry") => async (request: any, reply: any) => {
        const { user, ditemid } = request.params as { user: string; ditemid?: string };
        const query = request.query as Record<string, string>;
        const skip = query.skip !== undefined ? Math.max(0, Math.trunc(Number(query.skip)) || 0) : undefined;
        const result = await serve(request.headers.host ?? "localhost", request.url, user, view,
            ditemid ? Number(ditemid) : undefined, skip);
        return reply.code(result.status).type("text/html; charset=utf-8").send(result.html);
    };

    for (const prefix of ["/~:user", "/users/:user"]) {
        app.get(`${prefix}/`, handler("recent"));
        app.get(`${prefix}/:ditemid(^\\d+).html`, handler("entry"));
    }
    return app;
}
