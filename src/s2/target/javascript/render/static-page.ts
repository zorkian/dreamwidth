// static-page.ts
//
// The site's own read-only pages that Perl serves from a template alone:
// those DW::Routing registers with register_static, and the legal index and
// site map, which add only fixed data.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import type { Databases } from "../data/db";
import { type Site, User } from "../data/user";
import type { Stash, Value } from "../template";
import type { RenderResult } from "./render";
import { currentSecret } from "./reply-page";
import { renderSitePage, templateUser } from "./site-page";

// DW::Controller::Misc's and dw-nonfree's register_static pages.
const STATIC: Readonly<Record<string, string>> = {
    "/about": "misc/about.tt",
    "/site/opensource": "site/opensource.tt",
    "/site/bot": "site/bot.tt",
    "/site/brand": "site/brand.tt",
    "/site/policy": "site/policy.tt",
    "/doc/s2": "doc/s2/index.tt",
};

// The official journals DW::Controller::Misc::sitemap_handler's template lists.
const OFFICIAL = ["dw_news", "dw_maintenance", "dw_volunteers", "dw_suggestions"];

export interface StaticRequest {
    readonly site: Site;
    readonly url: string;
    readonly path: string;
    readonly args: Readonly<Record<string, string>>;
    readonly cookie: string;
    readonly uniq: string;
}

// The page at `path`, or undefined when it is not one of these.
export async function renderStaticPage(db: Databases, request: StaticRequest): Promise<RenderResult | undefined> {
    const { site, path } = request;
    const config = site.config;
    const render = async (view: string, vars: Stash = {}) => renderSitePage({
        site, url: request.url, args: request.args, cookie: request.cookie, uniq: request.uniq,
        secret: await currentSecret(db),
    }, view, vars);

    const legal = /^\/legal\/(\w+)$/.exec(path)?.[1];
    if (legal && legal !== "index" && config.legalPages.includes(legal)) return render(`legal/${legal}.tt`);
    // DW::Controller::Legal::index_handler
    if (path === "/legal/" || path === "/legal/index") {
        return render("legal/index.tt", {
            index: config.legalPages.map(page => ({ page, header: `.${page}-header`, text: `.${page}` })),
        });
    }
    // DW::Controller::Misc::sitemap_handler
    if (path === "/site/" || path === "/site/index") {
        const users = await Promise.all(OFFICIAL.map(name => User.byName(db, name)));
        const loaded = new Map(users.flatMap(u => u ? [[u.user, templateUser(site, u)] as const] : []));
        return render("site/index.tt", {
            shop_enabled: config.enabled.payments ? 1 : "",
            merch_url: config.merchUrl,
            load_user: (name: Value) => loaded.get(String(name)),
        });
    }
    const view = STATIC[path];
    return view ? render(view) : undefined;
}
