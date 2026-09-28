// entry-page.ts
//
// Build the S2 EntryPage, following LJ::S2::EntryPage and the comment
// threading in LJ::Talk::load_comments. The viewer is anonymous, so
// screened comments are hidden and nothing is manageable.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { type CommentRow, commentProps, commentRows, commentTexts } from "../data/comment";
import { Entry, truthy } from "../data/entry";
import { User } from "../data/user";
import { type S2Object, DateTimeUnix, ImageUserpic, ItemRange, UserLite, ehtml, s2 } from "./objects";
import { type PageContext, Page, entryObjects, journalDefaultPic, loadUserpics, robotMetaTags } from "./pages";

export interface EntryArgs {
    readonly thread?: number;
    readonly page?: number;
    readonly view?: string;
    readonly mode?: string;
    readonly expandAll?: boolean;
}

interface Post extends CommentRow {
    show: boolean;
    loaded?: boolean;
    showableChildren?: number;
    children: Post[];
    hideChildren?: boolean;
    hiddenChild?: boolean;
    subject?: string;
    body?: string;
    props?: Record<string, string>;
}

// null when the entry does not exist or the visitor may not see it.
export async function EntryPage(pc: PageContext, ditemid: number, args: EntryArgs,
    chromeHead: string): Promise<S2Object | null> {
    const { site, journal, db } = pc;
    const config = site.config;
    const entry = await Entry.byDitemid(db, journal, ditemid);
    if (!entry) return null;
    await Entry.fill(db, journal, [entry]);
    if (!entry.isPublic()) return null;

    const [s2entry] = await entryObjects(pc, [entry], "entry");
    const poster = pc.users.get(entry.posterid);
    if (poster?.statusvis === "S") return null;
    s2entry!._comments._show_postlink &&= args.mode !== "reply" ? 1 : 0;
    s2entry!._comments._show_readlink &&= args.mode === "reply" ? 1 : 0;

    const page = await Page(pc, "entry", await journalDefaultPic(pc));
    page[".type"] = "EntryPage";
    page._entry = s2entry;
    page._multiform_on = 0;
    page._viewing_thread = args.thread ? 1 : 0;
    page._viewing_thread_id = args.thread ?? 0;
    page.$viewing_thread_id = args.thread ?? 0;

    const permalink = entry.url(site);
    let head = page._head_content;
    if (truthy(journal.props.opt_blockrobots)) head += robotMetaTags();
    head += '<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />\n';
    const go = (dir: string) => `${config.protocol}://${site.host}/go?dir=${dir}&itemid=${entry.ditemid}&journal=${journal.user}`;
    head += `<link rel="prev" href="${go("prev")}" />\n<link rel="next" href="${go("next")}" />\n`;
    head += `<link rel="canonical" href="${permalink}${args.thread ? `?thread=${args.thread}#cmt${args.thread}` : ""}" />\n`;

    const comments = await loadComments(pc, entry, args);
    const flat = /\bflat\b/.test(args.view ?? ""), topOnly = /\btop-only\b/.test(args.view ?? "");
    page._comments = convertComments(pc, entry, comments.roots, 1, permalink, page._viewing_thread_id);
    head += commentInfoScript(journal.user, page._comments);

    // Open Graph data leads the head for public entries.
    head = openGraph(pc, entry, s2entry!, permalink) + head;
    page._head_content = head + chromeHead;

    page._comment_nav = s2("CommentNav", {
        view_mode: flat ? "flat" : topOnly ? "top-only" : "threaded", url: permalink,
        current_page: comments.page, show_expand_all: 0,
    });
    const style = flat ? "view=flat&" : topOnly ? "view=top-only&" : "";
    page._comment_pages = ItemRange({
        all_subitems_displayed: comments.pages === 1 ? 1 : 0, current: comments.page,
        from_subitem: comments.first, num_subitems_displayed: comments.roots.length, to_subitem: comments.last,
        total: comments.pages, total_subitems: comments.items,
    }, n => `${permalink}?${style}page=${Math.trunc(n)}`);
    return page;
}

// LJ::Talk::load_comments for an anonymous viewer.
async function loadComments(pc: PageContext, entry: Entry, args: EntryArgs) {
    const { db, journal, site } = pc;
    const config = site.config;
    const empty = { roots: [] as Post[], page: 1, pages: 1, items: 0, first: undefined, last: undefined };
    if (!(journal.optShowtalklinks === "Y" && !entry.commentsDisabled())) return empty;

    const rows = await commentRows(db, journal, entry.jitemid);
    const posts = new Map<number, Post>([...rows].map(([id, row]) => [id, { ...row, show: false, children: [] }]));
    const children = new Map<number, number[]>();
    const showable = new Map<number, number>();
    const flat = /\bflat\b/.test(args.view ?? ""), topOnly = /\btop-only\b/.test(args.view ?? "");
    const posterIds = [...new Set([...posts.values()].map(post => post.posterid).filter(Boolean))];
    for (const [id, user] of await User.byIds(db, posterIds.filter(id => !pc.users.has(id)))) pc.users.set(id, user);
    await loadUserpics(pc, posterIds);

    let count = 0;
    for (const post of [...posts.values()].sort((a, b) => b.talkid - a.talkid)) {
        if (flat) post.parenttalkid = 0;
        post.show = post.state !== "D" && post.state !== "S";
        count += post.show ? 1 : 0;
        if (post.parenttalkid && !posts.has(post.parenttalkid)) post.parenttalkid = 0;
        post.children = (children.get(post.talkid) ?? []).map(id => posts.get(id)!);
        const sum = (post.show ? 1 : 0) + (showable.get(post.talkid) ?? 0);
        if (sum) {
            showable.set(post.parenttalkid, (showable.get(post.parenttalkid) ?? 0) + sum);
            children.set(post.parenttalkid, [post.talkid, ...(children.get(post.parenttalkid) ?? [])]);
            if (post.parenttalkid) posts.get(post.parenttalkid)!.showableChildren = showable.get(post.parenttalkid);
        }
    }

    let thread = args.thread ? args.thread >> 8 : 0;
    if (!posts.has(thread)) thread = 0;
    if (!thread && !children.get(0)) return empty;

    let pageSize = config.talkPageSize;
    if (count < config.talkThreadPoint) pageSize = config.talkThreadPoint;
    const allTop = thread ? [thread] : children.get(0)!;
    const pages = Math.max(1, Math.ceil(allTop.length / pageSize));
    const page = Math.max(1, Math.min(pages, Math.trunc(args.page ?? 0) || 1));
    const first = pageSize * (page - 1) + 1;
    const last = page === pages ? allTop.length : pageSize * page;
    const top = allTop.slice(first - 1, last);

    const toLoad = [...top];
    const subjects: number[] = [];
    const ignored: number[] = [];
    const expand = new Set(topOnly ? [] : top);
    const check = [...toLoad];
    while (check.length) {
        const id = check.shift()!;
        for (const child of children.get(id) ?? []) {
            if (!topOnly && (toLoad.length < pageSize || expand.has(id) || args.expandAll)) {
                toLoad.push(child);
                expand.delete(id);
            } else {
                if (topOnly) posts.get(child)!.hiddenChild = true;
                (subjects.length < config.talkMaxSubjects ? subjects : ignored).push(child);
            }
            check.push(child);
        }
    }

    const [texts, subjectTexts, props] = await Promise.all([
        commentTexts(db, journal, toLoad), commentTexts(db, journal, subjects, true), commentProps(db, journal, toLoad),
    ]);
    for (const id of toLoad) {
        const post = posts.get(id)!;
        if (topOnly) post.hideChildren = true;
        if (!post.show) continue;
        post.loaded = true;
        post.subject = texts.get(id)?.subject ?? "";
        post.body = texts.get(id)?.body ?? "";
        post.props = props.get(id) ?? {};
    }
    await pc.content.preload(db, toLoad.map(id => posts.get(id)!.body ?? ""));
    for (const id of subjects) {
        const post = posts.get(id)!;
        if (post.show) post.subject = subjectTexts.get(id)?.subject ?? "";
    }
    for (const id of ignored) {
        const post = posts.get(id)!;
        if (post.show) post.subject = "...";
    }
    return { roots: top.map(id => posts.get(id)!), page, pages, items: allTop.length, first, last };
}

// The comment conversion in LJ::S2::EntryPage.
function convertComments(pc: PageContext, entry: Entry, posts: Post[], depth: number, permalink: string,
    viewingThread: number): S2Object[] {
    const { site, journal } = pc;
    const config = site.config;
    const p = pc.ctx.prop as Record<string, any>;
    return posts.map(post => {
        const dtalkid = post.talkid * 256 + entry.anum;
        const poster = post.posterid ? pc.users.get(post.posterid) : undefined;
        const time = DateTimeUnix(post.datepostUnix);
        const anchor = `#cmt${dtalkid}`;
        const props = post.props ?? {};

        let userpic: S2Object | undefined;
        const keyword = poster && poster.dversion >= 9
            ? (props.picture_mapid ? pc.userpics.get(poster.userid)?.keywordFromMapid(Number(props.picture_mapid)) : undefined)
            : props.picture_keyword || undefined;
        if (p._userpics_position !== "none" && poster && post.loaded) {
            const pics = pc.userpics.get(poster.userid);
            const picid = pics?.picidFromKeyword(keyword);
            const pic = picid ? pics?.get(picid) : undefined;
            if (pic) {
                const factor = p._comment_userpic_style === "small" ? 3 / 4 : p._comment_userpic_style === "smaller" ? 1 / 2 : 1;
                userpic = ImageUserpic(config, poster, { ...pic, width: pic.width * factor, height: pic.height * factor }, keyword);
            }
        }

        const text = post.loaded
            ? pc.content.comment(post.body ?? "", props, post.datepost, !poster || poster.journaltype === "I")
            : "";
        const comment = s2("Comment", { $hide_children: post.hideChildren ? 1 : 0,
            $js_expand_url: `${permalink}?thread=${dtalkid}&destination_thread=${viewingThread}${anchor}`,
            journal: UserLite(site, journal),
            metadata: { picture_keyword: keyword },
            permalink_url: `${permalink}?thread=${dtalkid}${anchor}`,
            reply_url: `${permalink}?replyto=${dtalkid}`,
            poster: poster ? UserLite(site, poster) : undefined,
            replies: [], subject: ehtml(post.subject ?? ""), talkid: dtalkid, ditemid: entry.ditemid, text,
            userpic, time, system_time: time, tags: [], full: post.loaded ? 1 : 0, depth,
            parent_url: post.parenttalkid
                ? `${permalink}?thread=${(post.parenttalkid << 8) + entry.anum}#cmt${(post.parenttalkid << 8) + entry.anum}` : undefined,
            threadroot_url: post.loaded && post.parenttalkid
                ? `${config.siteRoot}/go?redir_type=threadroot&journal=${journal.user}&talkid=${dtalkid}` : undefined,
            screened: post.state === "S" ? 1 : 0, screened_noshow: 0, frozen: post.state === "F" ? 1 : 0,
            deleted: 0, fromsuspended: 0, link_keyseq: ["delete_comment"],
            anchor: `cmt${dtalkid}`, dom_id: `cmt${dtalkid}`, comment_posted: "",
            edited: props.edit_time ? 1 : 0, edit_url: `${permalink}?edit=${dtalkid}`,
            edittime: props.edit_time ? DateTimeUnix(Number(props.edit_time)) : undefined,
            editreason: props.edit_time ? ehtml(props.edit_reason) : undefined,
            time_poster: undefined, seconds_since_entry: post.datepostUnix - Math.floor(Date.parse(entry.logtime + "Z") / 1000),
            timeformat24: 0, showable_children: post.showableChildren, hide_children: post.hideChildren ? 1 : 0,
            hidden_child: post.hiddenChild ? 1 : 0, admin_post: 0,
            expand_url: `${permalink}?thread=${dtalkid}${anchor}`,
        });
        const hide = (reason: "fromsuspended" | "deleted" | "screened") => {
            comment[`_${reason}`] = 1;
            Object.assign(comment, { _full: 0, _poster: undefined, _userpic: undefined, _subject: "", _subject_icon: undefined, _text: "" });
        };
        if (poster?.statusvis === "S") { hide("fromsuspended"); comment._screened = undefined; }
        if (post.state === "D") { hide("deleted"); comment._screened = undefined; }
        if (post.state === "S") { hide("screened"); comment._screened_noshow = 1; }
        comment._link_keyseq.push(comment._screened ? "unscreen_comment" : "screen_comment",
            comment._frozen ? "unfreeze_thread" : "freeze_thread", "watch_thread", "unwatch_thread", "watching_parent");
        comment._link_keyseq.unshift("edit_comment");
        if (post.children.length) comment._thread_url = comment._expand_url;
        if (props.imported_from) comment._metadata.imported_from = props.imported_from;
        comment._replies = convertComments(pc, entry, post.children, depth + 1, permalink, viewingThread);
        return comment;
    });
}

// LJ_cmtinfo for the comment JavaScript.
function commentInfoScript(journal: string, comments: S2Object[]): string {
    const info: Record<string, unknown> = { canAdmin: null, canSpam: 1, journal, remote: "", form_auth: "" };
    const visit = (list: S2Object[], parent?: number) => {
        for (const c of list) {
            info[c._talkid] = {
                rc: c._replies.map((r: S2Object) => r._talkid), u: c._poster?._username ?? "",
                parent: parent ?? null, full: c._full, deleted: c._deleted, screened: c._screened ?? 0,
            };
            visit(c._replies, c._talkid);
        }
    };
    visit(comments);
    return "<script>\n// don't crawl this.  read http://www.livejournal.com/developer/exporting\n" +
        `var LJ_cmtinfo = ${JSON.stringify(info)}\n</script>`;
}

// The Open Graph tags EntryPage adds for public entries.
function openGraph(pc: PageContext, entry: Entry, s2entry: S2Object, permalink: string): string {
    const { site } = pc;
    const text = pc.content.metadata(entry);
    const description = ehtml([...text.event.replace(/\s+/g, " ").trim()].slice(0, 300).join("").trim());
    let og = `<meta property="og:title" content="${ehtml(text.subject || "(no subject)")}"/>\n` +
        '<meta property="og:type" content="article"/>\n' +
        `<meta property="og:url" content="${ehtml(permalink)}"/>\n` +
        `<meta property="og:site_name" content="${ehtml(site.config.siteName)}"/>\n` +
        `<meta property="og:description" content="${description}"/>\n`;
    if (s2entry._userpic?._url) {
        og += `<meta property="og:image" content="${ehtml(s2entry._userpic._url)}"/>\n` +
            '<meta property="og:image:width" content="100"/>\n<meta property="og:image:height" content="100"/>\n';
    }
    og += `<meta property="article:published_time" content="${entry.eventtime.replace(" ", "T")}"/>\n`;
    const poster = pc.users.get(entry.posterid);
    if (poster) og += `<meta property="article:author" content="${ehtml(poster.journalBase(site) + "/profile")}"/>\n`;
    for (const tag of entry.tags) og += `<meta property="article:tag" content="${ehtml(tag.name)}"/>\n`;
    return og;
}
