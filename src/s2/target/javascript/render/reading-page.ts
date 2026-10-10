// reading-page.ts
//
// Build the S2 FriendsPage for the read and network views, following
// LJ::S2::FriendsPage for a logged-out viewer.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { Entry } from "../data/entry";
import { ContentFilter, watchItems } from "../data/reading";
import { User } from "../data/user";
import { builtin } from "../runtime/s2runtime";
import { type S2Object, UserLite, ehtml, eurl, s2 } from "./objects";
import {
    type PageContext, Page, cutTagScript, entryObjects, journalDefaultPic, robotMetaTags,
} from "./pages";
import type { JournalFilter, RenderResult } from "./render";
import { journalScripts, trackingPopup } from "./resources";

export async function FriendsPage(pc: PageContext, view: "read" | "network", pathextra: string | undefined,
    journalFilter: JournalFilter): Promise<S2Object | { response: RenderResult }> {
    const { journal, site, db, args } = pc;
    const config = site.config;
    const p = pc.ctx.prop as Record<string, any>;
    const page = await Page(pc, view, await journalDefaultPic(pc));
    page[".type"] = "FriendsPage";
    page._entries = [];
    page._friends = {};
    page._friends_title = ehtml(journal.props.friendspagetitle ?? "");
    page._friends_subtitle = ehtml(journal.props.friendspagesubtitle ?? "");
    trackingPopup(pc.resources, config);
    journalScripts(pc.resources, { lastn: true });
    let head = page._head_content + cutTagScript(pc) + robotMetaTags();

    let itemshow = Math.trunc(Number(p._num_items_reading) || 0);
    if (itemshow < 1) itemshow = 20;
    else if (itemshow > 50) itemshow = 50;
    const maxskip = config.maxScrollbackFriends - itemshow;
    const skip = Math.max(0, Math.min(Math.trunc(Number(args.skip)) || 0, maxskip));
    if (view === "network") page._friends_mode = "network";

    let group = (pathextra ?? "").replace(/^\//, "").replace(/\/$/, "");
    try {
        group = decodeURIComponent(group.replaceAll("+", " "));
    } catch {
        // left as it was, as LJ::durl would
    }
    const named = await ContentFilter.named(db, journal, group || "Default")
        ?? await ContentFilter.named(db, journal, "Default View");

    let filter: ContentFilter | undefined;
    if (journalFilter.security) {
        page._filter_active = 1;
        page._filter_name = journalFilter.security;
    } else if (args.filter !== "0" && named?.isPublic) {
        filter = named;
    } else if (group) {
        // The journal controller's page for a filter the viewer may not use.
        return { response: {
            status: 403,
            body: "<h1>Invalid Filter</h1><p>Either this reading filter doesn't exist or you are not authorized to view it. " +
                `Try <a href='${config.siteRoot}/login'>checking that you are logged in</a> if you're sure you have the name right.</p>` +
                "<!-- xxxxxxxxxxxxxxxxxxxxxxxxxxxx -->\n".repeat(100),
        } };
    }
    if (filter && !filter.isDefault()) {
        page._filter_active = 1;
        page._filter_name = filter.name;
    }

    const { entries, watched } = await watchItems(db, config, journal, {
        itemshow: itemshow + 1, skip, filter, showtypes: args.show, network: view === "network",
        security: journalFilter.security,
    });
    const more = entries.length > itemshow;
    const items = entries.slice(0, itemshow);
    if (!watched.size) {
        page._head_content = head;
        return page;
    }

    for (const friend of watched.values()) pc.users.set(friend.user.userid, friend.user);
    // Only the journals with entries on the page.
    await Promise.all([...new Set(items.map(entry => entry.journal))].map(posted => Promise.all([
        posted.loadProps(db, ["adult_content"]),
        Entry.fill(db, posted, items.filter(entry => entry.journal === posted)),
    ])));
    const posterIds = [...new Set(items.map(entry => entry.posterid))].filter(id => !pc.users.has(id));
    for (const [id, user] of await User.byIds(db, posterIds)) pc.users.set(id, user);

    // Entries by suspended posters, or suspended themselves, are left out.
    const visible = items.filter(entry => pc.users.get(entry.posterid)?.statusvis !== "S" && !entry.isSuspended());
    const hidden = items.length - visible.length;
    const objects = await entryObjects(pc, visible, "recent");
    for (const [index, entry] of visible.entries()) {
        const friend = watched.get(entry.journal.userid)!;
        page._friends[friend.user.user] ??= {
            ...UserLite(site, friend.user), ".type": "Friend",
            _fgcolor: builtin.construct_Color(friend.fgcolor), _bgcolor: builtin.construct_Color(friend.bgcolor),
        };
        const e = objects[index]!;
        e.$ymd = `${e._time._year}-${e._time._month}-${e._time._day}`;
        page._entries.push(e);
    }
    for (let i = 0; i < page._entries.length; i++) {
        const entry = page._entries[i];
        entry._new_day = 1;
        let last = i;
        for (let j = i + 1; j < page._entries.length; j++) if (page._entries[j].$ymd === entry.$ymd) last = j;
        page._entries[last]._end_day = 1;
        i = last;
    }

    const nav = s2("RecentNav", { version: 1, skip, count: page._entries.length });
    const base = `${journal.journalBase(site)}/${view}${group ? `/${eurl(group)}` : ""}`;
    const linkvars: Record<string, string | number> = {};
    if (args.show !== undefined && /^\w+$/.test(args.show)) linkvars.show = args.show;
    if (args.filter !== undefined) linkvars.filter = Math.trunc(parseFloat(args.filter)) || 0;
    // LJ::S2::make_link over a hash, whose order varies in Perl.
    const link = (vars: Record<string, string | number>) => {
        const query = Object.entries(vars).filter(([, value]) => value !== "")
            .map(([key, value]) => `${key}=${value}`).join("&");
        return query ? `${base}?${query}` : base;
    };
    if (skip) {
        const back = skip - itemshow;
        if (back > 0) linkvars.skip = back;
        nav._forward_url = link(linkvars);
        nav._forward_skip = Math.max(0, back);
        nav._forward_count = itemshow;
        head += `<link rel="next" href="${nav._forward_url}" />\n`;
    }
    if (page._entries.length + hidden === itemshow && skip !== maxskip && more) {
        linkvars.skip = skip + itemshow;
        nav._backward_url = link(linkvars);
        nav._backward_skip = skip + itemshow;
        nav._backward_count = itemshow;
        head += `<link rel="prev" href="${nav._backward_url}" />\n`;
    }
    page._nav = nav;
    page._head_content = head;
    return page;
}
