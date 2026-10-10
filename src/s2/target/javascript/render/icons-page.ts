// icons-page.ts
//
// Build the S2 IconsPage, following LJ::S2::IconsPage for a logged-out
// viewer, who sees only active icons.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import type { Userpic } from "../data/userpic";
import { type S2Object, ImageUserpic, ItemRange, ehtml, eurl, s2, styleOpts } from "./objects";
import { type PageContext, Page, journalDefaultPic, loadUserpics, robotMetaTags } from "./pages";

const byCase = (a: string, b: string) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;

export async function IconsPage(pc: PageContext, path: string): Promise<S2Object> {
    const { journal, site, args } = pc;
    const config = site.config;
    const p = pc.ctx.prop as Record<string, any>;
    const page = await Page(pc, "icons", await journalDefaultPic(pc));
    page[".type"] = "IconsPage";
    if (journal.shouldBlockRobots(config)) page._head_content += robotMetaTags();
    page._can_manage = 0;

    await loadUserpics(pc, [journal.userid]);
    const all = pc.userpics.get(journal.userid)!.all().filter(pic => pic.state === "N");
    const defaultOrder = p._icons_sort_order || "upload";
    let sortorder = args.sortorder || defaultOrder;
    // Each icon once, or once per keyword when sorted by keyword.
    let pics: { pic: Userpic; keywords: readonly string[] }[];
    if (sortorder === "keyword") {
        const named = all.flatMap(pic => pic.keywords.map(keyword => ({ pic, keywords: [keyword] })));
        const unnamed = all.filter(pic => !pic.keywords.length).map(pic => ({ pic, keywords: [`pic#${pic.picid}`] }));
        pics = [...named.sort((a, b) => byCase(a.keywords[0]!, b.keywords[0]!)),
            ...unnamed.sort((a, b) => a.keywords[0]! < b.keywords[0]! ? -1 : 1)];
    } else {
        sortorder = "upload";
        const listed = all.map(pic => ({ pic, keywords: pic.keywords.length ? pic.keywords : [`pic#${pic.picid}`] }));
        pics = [...listed.filter(item => item.pic.picid === journal.defaultpicid),
            ...listed.filter(item => item.pic.picid !== journal.defaultpicid)];
    }

    // LJ::create_url on this page, keeping some arguments.
    const url = (extra: Record<string, string | number | undefined>, keep: string[]) => {
        const out: Record<string, string> = Object.fromEntries(styleOpts(args));
        for (const [key, value] of Object.entries(extra)) if (value !== undefined) out[key] = String(value);
        for (const key of keep) if (key in args && !(key in extra)) out[key] = args[key]!;
        const query = Object.keys(out).sort().map(key => `${eurl(key)}=${eurl(out[key]!)}`).join("&");
        return `${config.protocol}://${site.host}${path}${query ? `?${query}` : ""}`;
    };
    const keep = ["sortorder", "view", "inactive"];
    page._sortorder = sortorder;
    page._sort_keyseq = ["upload", "keyword"];
    page._sort_urls = Object.fromEntries(["upload", "keyword"].map(order =>
        [order, url({ sortorder: order === defaultOrder ? undefined : order }, keep)]));

    // LJ::S2::ItemRange_fromopts
    let pageSize = Math.trunc(Number(p._num_items_icons)) || config.maxIconsPerPage || 0;
    if (config.maxIconsPerPage && pageSize > config.maxIconsPerPage) pageSize = config.maxIconsPerPage;
    if (args.view === "all") pageSize = 0;
    pageSize ||= pics.length || 25;
    const pages = Math.ceil(pics.length / pageSize) || 1;
    const current = Math.min(pages, Math.trunc(Number(args.page)) || 1);
    const shown = pics.slice((current - 1) * pageSize, current * pageSize);
    page._pages = ItemRange({
        current, total: pages, total_subitems: pics.length, from_subitem: (current - 1) * pageSize + 1,
        num_subitems_displayed: shown.length, to_subitem: (current - 1) * pageSize + shown.length,
        all_subitems_displayed: pages === 1 ? 1 : "",
        ...(pages !== 1 ? { url_all: url({ view: "all" }, ["sortorder", "inactive"]) } : {}),
    }, n => url({ page: n }, keep));

    page._icons = shown.map(({ pic, keywords }) => {
        const isDefault = pic.picid === journal.defaultpicid;
        const image = ImageUserpic(config, journal, pic, keywords.join(", "), isDefault);
        return s2("Icon", {
            id: pic.picid, image, keywords: [...keywords].sort(byCase).map(ehtml),
            comment: pc.content.iconText(pic.comment), description: pc.content.iconText(pic.description),
            default: isDefault ? 1 : 0, active: 1, link_url: image._url,
        });
    });
    return page;
}
