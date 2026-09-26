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
import type { RenderContentPreparation, RenderInput, ApprovedEntry, ApprovedUserpic, ApprovedTag, ApprovedTagDetail } from "./types";
import { object, date, nullObject, S2Object } from "./objects";
import { escapeHtml } from "./builtins";

export function prepareTag(tag: ApprovedTag, base: string): S2Object {
    // Tags.pm tag_url/TextUtil eurl operate on native UTF8 database bytes.
    const bytes=Buffer.from(tag.name,"utf8");let encoded="";
    for(const byte of bytes){const char=String.fromCharCode(byte);
        encoded+=/[a-zA-Z0-9_,\-.\/\\: ]/.test(char)?char:"%"+byte.toString(16).toUpperCase().padStart(2,"0");}
    encoded=encoded.replaceAll(" ","+");
    return object("Tag",{_id:tag.id,name:escapeHtml(tag.name),
        url:base+(encoded.includes("/")||encoded.includes("\\")||encoded.includes("%2B")?"?tag=":"/tag/")+encoded});
}
export function prepareTagDetail(tag: ApprovedTagDetail, base: string): S2Object {
    const simple=prepareTag(tag,base);
    return object("TagDetail",{_id:tag.id,name:simple.name,url:simple.url,visibility:"public",use_count:tag.count,
        security_counts:{public:tag.count}});
}
export function prepareEntryTags(tags: readonly ApprovedTag[],base:string): S2Object[] {
    return tags.map(tag=>prepareTag(tag,base)).sort((a,b)=>
        Buffer.compare(Buffer.from(String(a.name)),Buffer.from(String(b.name))));
}

export function prepareUserpic(input: RenderInput, picture: ApprovedUserpic | null, ctx?: Context): S2Object {
    if (!picture || ctx?.prop._userpics_position === "none") return nullObject("Image");
    const {journal,config} = input;
    const keyword = picture.keyword;
    const description = picture.description !== "0" ? picture.description : "";
    const alt = journal.username + ":" + (description ? " " + description : "") +
        (keyword !== null ? " (" + keyword + ")" : " (Default)");
    const title = journal.username + ":" + (keyword !== null ? " " + keyword : " (Default)") +
        (description ? " (" + description + ")" : "");
    const factor = ctx?.prop._entry_userpic_style === "small" ? 0.75 :
        ctx?.prop._entry_userpic_style === "smaller" ? 0.5 : 1;
    return object("Image",{url:`${config.userpicRoot}/${picture.picid}/${journal.userid}`,
        width:picture.width*factor,height:picture.height*factor,
        alttext:escapeHtml(alt),extra:{title:escapeHtml(title)}});
}

export function prepare(input: RenderInput, ctx: Context,
    content: RenderContentPreparation): S2Object {
    const { journal: j, config: c } = input;
    const base = j.baseUrl;
    const user = object("User", {user: j.username, username: j.username, name: escapeHtml(j.name),
        journal_type: "P", userpic_listing_url: `${base}/icons`, host_userid: j.userid,
        link_keyseq: ["manage_membership", "trust", "watch", "post_entry", "track", "message", "tell_friend"],
        default_pic: prepareUserpic(input,j.defaultUserpic), website_url: escapeHtml(j.websiteUrl), website_name: escapeHtml(j.websiteName)});
    if (input.page.kind === "entry") return prepareEntry(input, ctx, content, user, base);
    // The primary loader has already applied the public SQL window, source
    // buffer ordering and lookahead removal. Preserve approved entry identity
    // for the child cleaner callbacks; applying skip again would lose rows.
    const {itemshow, pageSkip: skip, maxScrollback, hasPrevious} = input.page;
    const maxSkip = maxScrollback - itemshow;
    const selected = j.entries;
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
        return object("Entry", {...subjectFields(content,e,url), text: content.body(e, url), journal: user, poster: user,
            time: date(e.eventtime), system_time: date(e.logtime), new_day: Number(newday),
            end_day: Number(newday), comments, userpic: prepareUserpic(input,e.userpic,ctx), permalink_url: url,
            itemid: e.id, tags: prepareEntryTags(e.tags,base), metadata: currentFields(content,e,url), mood_icon: prepareMoodIcon(e), depth: 0, timeformat24: 0, admin_post: 0,
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
        view_url: views, linklist: j.links.map(link=>object("UserLink",{is_heading:Number(link.isHeading),
            url:escapeHtml(link.url),title:escapeHtml(link.title),hover:escapeHtml(link.hover),children:[]})), customtext_title: ctx.prop._text_module_customtext,
        customtext_content: ctx.prop._text_module_customtext_content,
        customtext_url: ctx.prop._text_module_customtext_url,
        views_order: ["recent", "archive", "read", "tags", "memories", "userinfo"],
        global_title: escapeHtml(j.title), global_subtitle: escapeHtml(j.subtitle),
        show_control_strip: Number(j.showControlStrip), head_content: "", is_canary: 0,
        data_link: links, data_links_order: ["rss", "atom"], timeformat24: 0,
        include_meta_viewport: 1, session_msgs: [], has_activeentries: 0, activeentries: [],
        entries, filter_active: 0, filter_name: "", filter_tags: 0, nav});
}

function subjectFields(content: RenderContentPreparation, entry: ApprovedEntry, url: string): Record<string,unknown> {
    const subject = content.subject(entry,url);
    return {subject:subject.html,_subject_recent:subject.recentHtml,_subject_all:subject.all};
}
function currentFields(content: RenderContentPreparation, entry: ApprovedEntry, url: string): Record<string,unknown> {
    const result: Record<string,unknown> = {};
    for (const [name,raw] of Object.entries(entry.currents ?? {})) {
        result[name] = content.subject(entry,url,raw).html;
    }
    if (entry.moodName !== undefined && (!result.mood || result.mood === "0")) result.mood = entry.moodName;
    return result;
}
function prepareMoodIcon(entry: ApprovedEntry): S2Object {
    const icon = entry.moodIcon;
    return icon ? object("Image",{url:icon.url,width:icon.width,height:icon.height,alttext:"",extra:{}}) : nullObject("Image");
}

function prepareEntry(input: RenderInput, ctx: Context, content: RenderContentPreparation,
    user: S2Object, base: string): S2Object {
    if (input.page.kind !== "entry" || input.skip !== 0 || input.skipPresent) {
        throw new Error("Invalid entry render selection");
    }
    const {journal: j, config: c} = input;
    const ditemid = input.page.ditemid;
    const selected = j.entries.filter(entry => entry.id === ditemid);
    if (selected.length !== 1) throw new Error("Missing approved entry render target");
    const e = selected[0]!;
    const url = `${base}/${e.id}.html`;
    const enabled = Number(e.commentsEnabled);
    const comments = object("CommentInfo", {count: 0, read_url: url,
        post_url: url + "?mode=reply", permalink_url: url, enabled,
        maxcomments: 0, screened: 0, screened_count: 0,
        show_readlink: 0, show_readlink_hidden: enabled, show_postlink: enabled,
        comments_disabled_maintainer: 0});
    const entry = object("Entry", {
        ...subjectFields(content,e,url), text: content.body(e, url), journal: user, poster: user,
        time: date(e.eventtime), system_time: date(e.logtime), new_day: 0, end_day: 0,
        comments, userpic: prepareUserpic(input,e.userpic,ctx), permalink_url: url, itemid: e.id,
        tags: prepareEntryTags(e.tags,base), metadata: currentFields(content,e,url), mood_icon: prepareMoodIcon(e), depth: 0, timeformat24: 0, admin_post: 0,
        dom_id: `entry-${j.username}-${e.id}`, adult_content_level: "",
        link_keyseq: ["edit_entry", "edit_tags", "mem_add", "tell_friend",
            "watch_comments", "unwatch_comments"],
    });
    const commentPages = object("ItemRange", {
        all_subitems_displayed: 1, current: 1, from_subitem: 0,
        num_subitems_displayed: 0, to_subitem: 0, total: 1, total_subitems: 0,
        url_all: "",
    });
    const commentNav = object("CommentNav", {view_mode: "threaded", url,
        current_page: 1, show_expand_all: 0});
    const views = {
        recent: c.canonicalAppOrigin + "/", userinfo: base + "/profile",
        archive: c.canonicalAppOrigin + "/archive", read: c.canonicalAppOrigin + "/read",
        network: c.canonicalAppOrigin + "/network", tags: c.canonicalAppOrigin + "/tag/",
        memories: `${c.siteRoot}/tools/memories?user=${j.username}`,
    };
    return object("EntryPage", {view: "entry", args: {}, journal: user, journal_type: "P",
        layout_name: "Tabula Rasa", theme_name: "(Layout Default)", layout_url: "",
        time: date(input.nowSeconds), local_time: date(input.nowSeconds), base_url: base,
        stylesheet_url: `${base}/res/${j.styleid}/stylesheet?${j.styleTime}`,
        view_url: views, linklist: j.links.map(link=>object("UserLink",{is_heading:Number(link.isHeading),
            url:escapeHtml(link.url),title:escapeHtml(link.title),hover:escapeHtml(link.hover),children:[]})), customtext_title: ctx.prop._text_module_customtext,
        customtext_content: ctx.prop._text_module_customtext_content,
        customtext_url: ctx.prop._text_module_customtext_url,
        views_order: ["recent", "archive", "read", "tags", "memories", "userinfo"],
        global_title: escapeHtml(j.title), global_subtitle: escapeHtml(j.subtitle),
        show_control_strip: Number(j.showControlStrip), head_content: "", is_canary: 0,
        data_link: {}, data_links_order: [], timeformat24: 0, include_meta_viewport: 1,
        session_msgs: [], has_activeentries: 0, activeentries: [], entry,
        comments: [], comment_pages: commentPages, comment_nav: commentNav,
        multiform_on: 0, viewing_thread: 0, _viewing_thread_id: 0,
    });
}
