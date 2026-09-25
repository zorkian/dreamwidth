// prepare.ts
//
// Source-derived preparation for the bounded stock S2 page.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// Inherited ports: cgi-bin/LJ/S2.pm Page/Entry and cgi-bin/LJ/S2/RecentPage.pm.
//
// This code was forked from the LiveJournal project owned and operated
// by Live Journal, Inc. The code has been modified and expanded by
// Dreamwidth Studios, LLC. These files were originally licensed under
// the terms of the license supplied by Live Journal, Inc, which can
// currently be found at:
//
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
//
// In accordance with the original license, this code and all its
// modifications are provided under the GNU General Public License.
// A copy of that license can be found in the LICENSE file included as
// part of this distribution.
//


import type { Context } from "../../runtime/s2runtime";
import type { RenderInput } from "./types";
import { object, date, nullObject, S2Object } from "./objects";
import { escapeHtml } from "./builtins";

export function prepare(input: RenderInput, ctx: Context,
    cleanEntry: (rawBody: string, entryId: number, entryUrl: string) => string): S2Object {
    const { journal: j, config: c } = input;
    const base = `${c.canonicalAppOrigin}/~${j.username}`;
    const user = object("User", {user: j.username, username: j.username, name: escapeHtml(j.name),
        journal_type: "P", userpic_listing_url: `${base}/icons`, host_userid: j.userid,
        link_keyseq: ["manage_membership", "trust", "watch", "post_entry", "track", "message", "tell_friend"],
        default_pic: nullObject("Image"), website_url: "", website_name: ""});
    const itemshow = Math.min(50, Number(ctx.prop._num_items_recent) || 20);
    // RecentPage clamps with itemshow; recent_items clamps again with the extra
    // lookahead row. Preserve this off-by-one behavior at the local max100.
    // The offline config assertion pins MAX_SCROLLBACK_LASTN=100. Request skip
    // remains in input for exact returnto/script echoes, including explicit0.
    const maxSkip = 100 - itemshow;
    const skip = Math.min(input.skip, maxSkip);
    const loadSkip = Math.min(skip, 100 - (itemshow + 1));
    const selected = j.entries.slice(loadSkip, loadSkip + itemshow + 1);
    selected.sort((a, b) => b.eventtime.slice(0, 16).localeCompare(a.eventtime.slice(0, 16)) ||
        Math.floor(b.id / 256) - Math.floor(a.id / 256));
    const hasPrevious = selected.length > itemshow;
    if (hasPrevious) selected.pop();
    let lastday = "";
    const entries = selected.map(e => {
        const url = `${base}/${e.id}.html`;
        const newday = lastday !== e.eventtime.slice(0, 10);
        lastday = e.eventtime.slice(0, 10);
        const comments = object("CommentInfo", {count: 0, read_url: url, post_url: url + "?mode=reply",
            permalink_url: url, enabled: Number(e.commentsEnabled), maxcomments: 0,
            screened: 0, screened_count: 0, show_readlink: 0,
            show_readlink_hidden: Number(e.commentsEnabled), show_postlink: Number(e.commentsEnabled),
            comments_disabled_maintainer: 0});
        return object("Entry", {subject: e.subject, text: cleanEntry(e.rawBody, e.id, url), journal: user, poster: user,
            time: date(e.eventtime), system_time: date(e.logtime), new_day: Number(newday),
            end_day: Number(newday), comments, userpic: nullObject("Image"), permalink_url: url,
            itemid: e.id, tags: [], metadata: {}, depth: 0, timeformat24: 0, admin_post: 0,
            dom_id: `entry-${j.username}-${e.id}`, adult_content_level: "",
            link_keyseq: ["edit_entry", "edit_tags", "mem_add", "tell_friend", "watch_comments", "unwatch_comments"]});
    });
    if (entries.length) entries.at(-1)!.end_day = 1;
    const nav = object("RecentNav", {version: 1, skip, count: entries.length});
    if (skip) {
        nav._forward_skip = Math.max(0, skip - itemshow);
        nav._forward_count = itemshow;
        nav._forward_url = base + "/" + (nav._forward_skip ? `?skip=${nav._forward_skip}` : "");
    }
    if (entries.length === itemshow) {
        nav._backward_count = itemshow;
        if (skip === maxSkip) {
            nav._backward_url = `${base}/${selected.at(-1)!.eventtime.slice(0, 10).replaceAll("-", "/")}`;
        } else if (hasPrevious) {
            nav._backward_skip = skip + itemshow;
            nav._backward_url = `${base}/?skip=${nav._backward_skip}`;
        }
    }
    const views = {
        recent: c.canonicalAppOrigin + "/", userinfo: base + "/profile", archive: c.canonicalAppOrigin + "/archive",
        read: c.canonicalAppOrigin + "/read", network: c.canonicalAppOrigin + "/network", tags: c.canonicalAppOrigin + "/tag/",
        memories: `${c.siteRoot}/tools/memories?user=${j.username}`,
    };
    const image = (kind: string) => object("Image", {url: `${c.imgPrefix}/data_${kind}.gif`,
        width: 32, height: 15, alttext: kind === "rss" ? "RSS" : "Atom", extra: {}});
    const links = Object.fromEntries(["rss", "atom"].map(kind => [kind,
        object("Link", {url: base + "/data/" + kind, caption: kind === "rss" ? "RSS" : "Atom", icon: image(kind), extra: {}})]));
    return object("RecentPage", {view: "recent", args: {}, journal: user, journal_type: "P",
        layout_name: "Tabula Rasa", theme_name: "(Layout Default)", layout_url: "",
        time: date(input.nowSeconds), local_time: date(input.nowSeconds), base_url: base,
        stylesheet_url: `${base}/res/${j.styleid}/stylesheet?${j.styleTime}`,
        view_url: views, linklist: [], customtext_title: ctx.prop._text_module_customtext,
        customtext_content: ctx.prop._text_module_customtext_content,
        customtext_url: ctx.prop._text_module_customtext_url,
        views_order: ["recent", "archive", "read", "tags", "memories", "userinfo"],
        global_title: escapeHtml(j.title), global_subtitle: escapeHtml(j.subtitle),
        show_control_strip: Number(j.showControlStrip), head_content: "", is_canary: 0,
        data_link: links, data_links_order: ["rss", "atom"], timeformat24: 0,
        include_meta_viewport: 1, session_msgs: [], has_activeentries: 0, activeentries: [],
        entries, filter_active: 0, filter_name: "", filter_tags: 0, nav});
}
