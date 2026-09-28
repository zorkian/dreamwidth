// pages.ts
//
// Build the S2 page objects for journal views, following LJ::S2::Page,
// LJ::S2::RecentPage and LJ::S2::Entry_from_entryobj.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import type { Context } from "../runtime/s2runtime";
import type { StyleInfo } from "../compile/styles";
import { type Databases, int, text } from "../data/db";
import { Entry, truthy } from "../data/entry";
import { Moods } from "../data/moods";
import { type Site, User } from "../data/user";
import { Userpics } from "../data/userpic";
import type { ContentCleaner } from "./content";
import { escapeValue, type PropertyCleaners } from "./context";
import {
    type S2Object, DateTimeParts, DateTimeUnix, Image, ImageStd, ImageUserpic, Link, S2Date, Tag, UserLite,
    UserObject, ehtml, eurl, nullObject, s2,
} from "./objects";

export interface PageContext {
    readonly db: Databases;
    readonly site: Site;
    readonly journal: User;
    readonly ctx: Context;
    readonly content: ContentCleaner;
    readonly cleaners: PropertyCleaners;
    readonly style: StyleInfo;
    readonly nowSeconds: number;
    // Everyone whose name or icon appears on the page, by userid.
    readonly users: Map<number, User>;
}

export const JOURNAL_PROPS = ["s2_style", "journaltitle", "journalsubtitle", "url", "urlname", "customtext_title",
    "customtext_url", "customtext_content", "opt_blockrobots", "icbm", "control_strip_display",
    "control_strip_color", "sticky_entry", "timezone", "adult_content"];

const props = (pc: PageContext) => pc.ctx.prop as Record<string, any>;

// LJ::S2::Page
export async function Page(pc: PageContext, view: string, defaultPic: S2Object): Promise<S2Object> {
    const { site, journal, style } = pc;
    const config = site.config;
    const base = journal.journalBase(site);
    const origin = `${config.protocol}://${site.host}`;
    const p = props(pc);

    const links = await journal.cluster(pc.db, "SELECT ordernum, title, url, hover FROM links WHERE journalid = ?",
        [journal.userid]);
    const linklist = links.sort((a, b) => int(a.ordernum) - int(b.ordernum)).map(row => {
        const url = text(row.url), title = text(row.title);
        return s2("UserLink", {
            is_heading: url ? 0 : 1, url: ehtml(url), title: ehtml(title === "-" ? "" : title),
            hover: ehtml(text(row.hover)), children: [],
        });
    });

    // Page stores these props from the style when the journal has none.
    const jp = journal.props;
    const customTitle = jp.customtext_title === undefined || jp.customtext_title === "" || jp.customtext_title === "Custom Text"
        ? p._text_module_customtext : jp.customtext_title;

    const page = s2("Page", {
        $journal: journal,
        view, args: {}, journal: UserObject(site, journal, defaultPic), journal_type: journal.journaltype,
        layout_name: style.layoutName, theme_name: style.themeName, layout_url: style.layoutUrl,
        time: DateTimeUnix(pc.nowSeconds), local_time: DateTimeUnix(pc.nowSeconds),
        base_url: base, stylesheet_url: `${base}/res/${style.styleid}/stylesheet?${style.modtime}`,
        view_url: {
            recent: `${origin}/`, userinfo: `${base}/profile`, archive: `${origin}/archive`, read: `${origin}/read`,
            network: `${origin}/network`, tags: `${origin}/tag/`, memories: `${config.siteRoot}/tools/memories?user=${journal.user}`,
        },
        linklist,
        customtext_title: escapeValue(customTitle, "plain", pc.cleaners),
        customtext_url: escapeValue(jp.customtext_url || p._text_module_customtext_url, "plain", pc.cleaners),
        customtext_content: escapeValue(jp.customtext_content || p._text_module_customtext_content, "html", pc.cleaners),
        views_order: ["recent", "archive", "read", "tags", "memories", "userinfo"],
        global_title: ehtml(jp.journaltitle || journal.name), global_subtitle: ehtml(jp.journalsubtitle),
        show_control_strip: showControlStrip(journal) ? 1 : 0,
        head_content: "", is_canary: 0, data_link: {}, data_links_order: [], timeformat24: 0,
        include_meta_viewport: 1, session_msgs: [], has_activeentries: 0,
    });
    if (journal.journaltype === "Y") page._views_order = ["recent", "archive", "userinfo"];
    return page;
}

// The show_control_strip hook for a logged-out visitor.
export function showControlStrip(journal: User): boolean {
    const display = journal.props.control_strip_display;
    if (display === "none") return false;
    return /^\d+$/.test(display ?? "") ? (Number(display) & 1) !== 0 : true;
}

// LJ::S2::RecentPage
export async function RecentPage(pc: PageContext, skipArg: number, hasSkip: boolean,
    chromeHead: string): Promise<S2Object> {
    const { site, journal, db } = pc;
    const config = site.config;
    const base = journal.journalBase(site);
    const p = props(pc);

    let itemshow = Math.trunc(Number(p._num_items_recent) || 0);
    if (itemshow < 1) itemshow = 20;
    else if (itemshow > 50) itemshow = 50;
    const maxskip = config.maxScrollback - itemshow;
    const skip = Math.max(0, Math.min(skipArg, maxskip));

    const window = await Entry.recent(db, journal, itemshow + 1, skip, config.maxScrollback);
    const more = window.length > itemshow;
    const items = window.slice(0, itemshow);

    // Stickies lead the first page and are not repeated in place.
    const stickyIds = skip === 0 ? (journal.props.sticky_entry ?? "").split(",").map(Number).filter(Boolean) : [];
    const stickies = (await Promise.all(stickyIds.map(id => Entry.byDitemid(db, journal, id))))
        .filter((entry): entry is Entry => !!entry && entry.isPublic());
    const stickySet = new Set(stickies.map(entry => entry.ditemid));
    await Entry.fill(db, journal, [...stickies, ...items]);

    const defaultPic = await journalDefaultPic(pc);
    const page = await Page(pc, "recent", defaultPic);
    page[".type"] = "RecentPage";
    page._entries = [];
    page._filter_active = 0;
    page._filter_name = "";
    page._filter_tags = 0;

    const kind = journal.journaltype === "C" ? "members" : "friends";
    // The journal handler asks Page to state the charset first.
    let head = '<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />\n' + metaDiscoveryLinks(pc) +
        `<link rel="help" href="${config.siteRoot}/support/faq" />\n` +
        '<meta property="og:image:width" content="363"/>\n<meta property="og:image:height" content="363"/>\n' +
        `<link rel="group ${journal.journaltype === "C" ? "members" : "friends made"}" title="${ehtml(`${config.siteNameShort} ${kind}`)}" href="${ehtml(`${base}/read`)}" />\n`;
    page._data_link = {
        rss: Link(`${base}/data/rss`, "RSS", ImageStd(config, p, "rss")),
        atom: Link(`${base}/data/atom`, "Atom", ImageStd(config, p, "atom")),
    };
    page._data_links_order = ["rss", "atom"];
    if (truthy(journal.props.opt_blockrobots) || hasSkip && skipArg) head += robotMetaTags();
    if (journal.props.icbm) head += `<meta name="ICBM" content="${journal.props.icbm}" />\n`;
    head += `
  <script type='text/javascript'>
  expanded = '${site.config.strings["widget.cuttag.expanded"] ?? ""}';
  collapsed = '${site.config.strings["widget.cuttag.collapsed"] ?? ""}';
  collapseAll = '${site.config.strings["widget.cuttag.collapseAll"] ?? ""}';
  expandAll = '${site.config.strings["widget.cuttag.expandAll"] ?? ""}';
  </script>
    `;

    const documentUrl = `${base}/${hasSkip ? `?skip=${skipArg}` : ""}`;
    const entries = await entryObjects(pc, [...stickies, ...items.filter(entry => !stickySet.has(entry.ditemid))],
        documentUrl, "recent");
    const stickyObjects = entries.slice(0, stickies.length).map(entry => ({
        ...entry, ".type": "StickyEntry", _sticky_entry_icon: ImageStd(config, p, "sticky-entry"),
    }));
    const posters = pc.users;
    let lastdate = "";
    let last: S2Object | undefined;
    const shown: S2Object[] = [];
    for (const [index, entry] of entries.slice(stickies.length).entries()) {
        const source = items.filter(item => !stickySet.has(item.ditemid))[index]!;
        if (posters.get(source.posterid)?.statusvis === "S") continue;
        const date = source.alldatepart.slice(0, 10);
        entry._new_day = 0;
        if (date !== lastdate) {
            entry._new_day = 1;
            lastdate = date;
            if (last) last._end_day = 1;
        }
        last = entry;
        shown.push(entry);
    }
    page._entries = [...stickyObjects, ...shown];
    if (page._entries.length) page._entries.at(-1)._end_day = 1;

    const nav = s2("RecentNav", { version: 1, skip, count: items.length });
    if (skip) {
        const back = Math.max(0, skip - itemshow);
        nav._forward_skip = back;
        nav._forward_url = back ? `${base}/?skip=${back}` : `${base}/`;
        nav._forward_count = itemshow;
        head += `<link rel="next" href="${nav._forward_url}" />\n`;
    }
    if (items.length === itemshow) {
        nav._backward_count = itemshow;
        if (skip === maxskip) {
            nav._backward_url = `${base}/${lastdate.replaceAll(" ", "/")}`;
        } else if (more) {
            nav._backward_skip = skip + itemshow;
            nav._backward_url = `${base}/?skip=${skip + itemshow}`;
        }
        head += `<link rel="prev" href="${nav._backward_url ?? ""}" />\n`;
    }
    page._nav = nav;
    page._head_content = head + chromeHead;
    return page;
}

// LJ::User::meta_discovery_links with feeds and openid, then Page's own links.
function metaDiscoveryLinks(pc: PageContext): string {
    const base = pc.journal.journalBase(pc.site);
    const root = pc.site.config.siteRoot;
    return `<link rel="alternate" type="application/rss+xml" title="RSS: all entries" href="${base}/data/rss" />\n` +
        `<link rel="alternate" type="application/atom+xml" title="Atom: all entries" href="${base}/data/atom" />\n` +
        `<link rel="service" type="application/atomsvc+xml" title="AtomAPI service document" href="${root}/interface/atom" />\n` +
        `<link rel="openid.server" href="${root}/openid/server" />\n`;
}

export function robotMetaTags(): string {
    return '<meta name="robots" content="noindex, nofollow, noarchive" />\n' +
        '<meta name="googlebot" content="noindex, nofollow, noarchive, nosnippet" />\n';
}

async function journalDefaultPic(pc: PageContext): Promise<S2Object> {
    const pics = await Userpics.load(pc.db, pc.journal);
    return ImageUserpic(pc.site.config, pc.journal, pics.get(pc.journal.defaultpicid));
}

// Entry_from_entryobj for each entry, loading posters, icons and moods together.
export async function entryObjects(pc: PageContext, entries: readonly Entry[], documentUrl: string,
    cuts: "recent" | "entry"): Promise<S2Object[]> {
    const { site, journal, db } = pc;
    const config = site.config;
    const p = props(pc);

    const posterIds = [...new Set(entries.map(entry => entry.posterid))].filter(id => !pc.users.has(id));
    for (const [id, user] of await User.byIds(db, posterIds)) pc.users.set(id, user);
    const pics = new Map<number, Userpics>();
    for (const id of new Set([journal.userid, ...entries.map(entry => entry.posterid)])) {
        const user = pc.users.get(id);
        if (user) pics.set(id, await Userpics.load(db, user));
    }
    const moodTheme = (poster: User) => journal.optForcemoodtheme === "Y" ? journal.moodthemeid : poster.moodthemeid;
    const moods = await Moods.load(db, [...new Set(entries.map(entry =>
        moodTheme(pc.users.get(entry.posterid) ?? journal)))]);

    const userpicPosition = String(p._userpics_position ?? "");
    return entries.map(entry => {
        const poster = pc.users.get(entry.posterid) ?? journal;
        const url = entry.url(site);
        const subject = pc.content.subject(entry.subject, documentUrl);

        let userpic: S2Object = nullObject("Image");
        if (userpicPosition !== "none") {
            if (entry.posterid === journal.userid || !truthy(p._use_shared_pic)) {
                const posterPics = pics.get(poster.userid)!;
                const keyword = poster.dversion >= 9
                    ? (entry.props.picture_mapid ? posterPics.keywordFromMapid(int(entry.props.picture_mapid)) : undefined)
                    : entry.props.picture_keyword;
                const picid = posterPics.picidFromKeyword(keyword);
                userpic = ImageUserpic(config, poster, posterPics.get(picid), keyword);
            } else {
                const journalPics = pics.get(journal.userid)!;
                userpic = ImageUserpic(config, journal, journalPics.get(journal.defaultpicid));
            }
            const style = p._entry_userpic_style;
            if (userpic._url && (style === "small" || style === "smaller")) {
                const factor = style === "small" ? 3 / 4 : 1 / 2;
                userpic._width *= factor;
                userpic._height *= factor;
            }
        }

        const tags = entry.tags.map(tag => Tag(journal.journalBase(site), tag.kwid, tag.name))
            .sort((a, b) => a._name < b._name ? -1 : a._name > b._name ? 1 : 0);
        const enabled = journal.optShowtalklinks === "Y" && !entry.commentsDisabled() ? 1 : 0;
        const replies = enabled ? entry.replyCount() : 0;
        const maxComments = Number(journal.getCap(config, "maxcomments") ?? 0);
        const comments = s2("CommentInfo", {
            read_url: url, post_url: `${url}?mode=reply`, permalink_url: url, count: replies,
            maxcomments: replies >= maxComments ? 1 : 0, enabled,
            comments_disabled_maintainer: truthy(entry.props.opt_nocomments_maintainer) &&
                !truthy(entry.props.opt_nocomments) ? 1 : 0,
            screened: 0, screened_count: 0, show_readlink: enabled && replies ? 1 : 0,
            show_readlink_hidden: enabled, show_postlink: enabled,
        });

        const e = s2("Entry", {
            $subject_noa: subject.noLinks, $subject_all: subject.text,
            link_keyseq: ["edit_entry", "edit_tags", "mem_add", "tell_friend", "watch_comments", "unwatch_comments"],
            metadata: {},
            subject: subject.html,
            text: pc.content.event(entry, documentUrl, cuts),
            journal: UserLite(site, journal), poster: UserLite(site, poster),
            new_day: 0, end_day: 0, comments, userpic, permalink_url: url, itemid: entry.ditemid, tags,
            timeformat24: 0, admin_post: 0, dom_id: `entry-${journal.user}-${entry.ditemid}`,
            time: DateTimeParts(entry.alldatepart), system_time: DateTimeParts(entry.systemAlldatepart),
            depth: 0, adult_content_level: "",
        });
        if (entry.security === "usemask" || entry.security === "private") {
            const security = entry.security === "private" || entry.allowmask === 0 ? "private" : "protected";
            e._security = security;
            e._security_icon = ImageStd(config, p, `security-${security}`);
        }
        const adult = entry.props.adult_content_maintainer || entry.props.adult_content || journal.props.adult_content;
        if (adult === "explicit") {
            e._adult_content_level = "18";
            e._adult_content_icon = ImageStd(config, p, "adult-18");
        } else if (adult === "concepts") {
            e._adult_content_level = "NSFW";
            e._adult_content_icon = ImageStd(config, p, "adult-nsfw");
        }
        Object.assign(e._metadata, currents(pc, entry, moods, moodTheme(poster), e, documentUrl));
        if (/<(script|object|applet|embed|iframe)\b/i.test(e._text)) e._text_must_print_trusted = 1;
        return e;
    });
}

// LJ::currents, lowercased as Entry stores them.
function currents(pc: PageContext, entry: Entry, moods: Moods, themeid: number, e: S2Object,
    documentUrl: string): Record<string, string> {
    const result: Record<string, string> = {};
    const p = entry.props;
    if (truthy(p.current_mood) || truthy(p.current_moodid)) {
        let name = truthy(p.current_mood) ? pc.content.subject(p.current_mood!, documentUrl).html : "";
        const moodid = int(p.current_moodid);
        if (moodid) {
            name ||= moods.name(moodid);
            const picture = moods.picture(pc.site.config, themeid, moodid);
            if (picture) e._mood_icon = Image(picture.url, picture.width, picture.height, "");
        }
        result.mood = name;
    }
    if (truthy(p.current_music)) result.music = pc.content.subject(p.current_music!, documentUrl).html;
    if (truthy(p.current_location) || truthy(p.current_coords)) {
        result.location = pc.content.subject(p.current_location ?? "", documentUrl).html;
    }
    return result;
}

// LJ::S2::YearMonth for Page::get_latest_month
export async function latestMonth(pc: PageContext): Promise<S2Object> {
    const { journal, site } = pc;
    const base = journal.journalBase(site);
    const rows = await journal.cluster(pc.db,
        "SELECT year, month, day, COUNT(*) AS n FROM log2 WHERE journalid = ? AND security = 'public' GROUP BY 1, 2, 3",
        [journal.userid]);
    const counts = new Map<string, number>();
    const months = new Set<number>();
    for (const row of rows) {
        counts.set(`${int(row.year)}-${int(row.month)}-${int(row.day)}`, int(row.n));
        months.add(int(row.year) * 12 + int(row.month));
    }
    const now = new globalThis.Date(pc.nowSeconds * 1000);
    const [curYear, curMonth] = [now.getUTCFullYear(), now.getUTCMonth() + 1];
    let [year, month] = [curYear, curMonth];
    const years = [...new Set([...months].map(value => Math.floor((value - 1) / 12)))].filter(y => y <= curYear).sort((a, b) => a - b);
    if (years.length) {
        year = years.at(-1)!;
        const inYear = [...months].filter(value => Math.floor((value - 1) / 12) === year)
            .map(value => value - year * 12).filter(m => year < curYear || m <= curMonth).sort((a, b) => a - b);
        month = inYear.at(-1) ?? month;
    }

    const monday = props(pc)._reg_firstdayofweek === "monday";
    const pad = (n: number) => String(n).padStart(2, "0");
    const hasEntries = [...counts.keys()].some(key => key.startsWith(`${year}-${month}-`));
    const weeks: S2Object[] = [];
    let week: S2Object | undefined;
    const days = new globalThis.Date(Date.UTC(year, month, 0)).getUTCDate();
    let dayOfWeek = new globalThis.Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    for (let day = 1; day <= days; day++) {
        const count = counts.get(`${year}-${month}-${day}`) ?? 0;
        const d = s2("YearDay", { day, date: S2Date(year, month, day, dayOfWeek + 1), num_entries: count });
        if (count) d._url = `${base}/${year}/${pad(month)}/${pad(day)}/`;
        if (!week) {
            let leading = dayOfWeek;
            if (monday && --leading < 0) leading = 6;
            week = s2("YearWeek", { days: [], pre_empty: leading, post_empty: 0 });
        }
        week._days.push(d);
        if (week._pre_empty + week._days.length === 7) {
            weeks.push(week);
            week = undefined;
        }
        dayOfWeek = (dayOfWeek + 1) % 7;
    }
    if (week) {
        week._post_empty = 7 - week._pre_empty - week._days.length;
        weeks.push(week);
    }
    const result = s2("YearMonth", { year, month, weeks, url: `${base}/${year}/${pad(month)}/`, has_entries: hasEntries ? 1 : 0 });
    const current = year * 12 + month;
    const before = [...months].filter(value => value < current).sort((a, b) => b - a)[0];
    const after = [...months].filter(value => value > current).sort((a, b) => a - b)[0];
    for (const [key, value] of [["prev", before], ["next", after]] as const) {
        if (value === undefined) continue;
        const [y, m] = [Math.floor((value - 1) / 12), ((value - 1) % 12) + 1];
        result[`_${key}_url`] = `${base}/${String(y).padStart(4, "0")}/${pad(m)}/`;
        result[`_${key}_date`] = S2Date(y, m, 0);
    }
    return result;
}

// Page::visible_tag_list: public use counts only.
export async function visibleTags(pc: PageContext): Promise<S2Object[]> {
    const { journal, site } = pc;
    const rows = await journal.cluster(pc.db,
        `SELECT k.kwid, k.keyword, COUNT(*) AS uses FROM logtags t
         JOIN log2 l ON l.journalid = t.journalid AND l.jitemid = t.jitemid AND l.security = 'public'
         JOIN userkeywords k ON k.userid = t.journalid AND k.kwid = t.kwid
         WHERE t.journalid = ? GROUP BY k.kwid, k.keyword`, [journal.userid]);
    const base = journal.journalBase(site);
    return rows.map(row => {
        const tag = Tag(base, int(row.kwid), text(row.keyword));
        return { ...tag, ".type": "TagDetail", _visibility: "public", _use_count: int(row.uses),
            _security_counts: { public: int(row.uses) } };
    });
}

export { eurl };
