// feed.ts
//
// A journal's RSS and Atom feeds, as LJ::Feed::make_feed serves them to an
// anonymous reader. Adult content needs a login here, so an adult entry is an
// item that links to it and says so, where Perl's feed carries the entry.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { cleanSubjectAll } from "@dreamwidth/content";
import { type Databases, int, text } from "../data/db";
import { Entry, truthy } from "../data/entry";
import { Moods } from "../data/moods";
import { type Site, User } from "../data/user";
import { Userpics } from "../data/userpic";
import { ljuserTag } from "./chrome";
import { ContentCleaner } from "./content";
import { moduleContent, pollName } from "./embedded";
import type { JournalFilter, RenderResult } from "./render";

// $LJ::EndOfTime
const END_OF_TIME = 2147483647;
const ATOM_NS = "http://www.w3.org/2005/Atom";

// What the feed shows for an entry an anonymous reader must log in to read.
const LOGIN_TITLE = "Log in to read this entry";
const loginBody = (url: string) =>
    `This entry is only for readers who are logged in. <a href="${url}">Log in to read it.</a>`;

export interface FeedRequest {
    readonly pathextra?: string;
    readonly args: Readonly<Record<string, string>>;
    readonly filter: JournalFilter;
    readonly ifModifiedSince?: string;
}

// "notfound" for a feed with no such type or entry; "perl" for the feed
// types this server leaves to Perl.
export type FeedResult = RenderResult | "notfound" | "perl";

interface Item {
    readonly entry: Entry;
    readonly poster: User;
    readonly subject: string;
    readonly event: string;
    readonly createtime: number;
    readonly modtime: number;
    readonly comments: boolean;
    readonly music?: string;
    readonly mood?: string;
    readonly tags: readonly string[];
    readonly replycount?: string;
    readonly url: string;
    // An adult entry, shown only as a link to log in.
    readonly loginOnly: boolean;
}

// LJ::Feed::make_feed
export async function renderFeed(db: Databases, site: Site, journal: User, request: FeedRequest): Promise<FeedResult> {
    const feedtype = /^\/(\w+)/.exec(request.pathextra ?? "")?.[1];
    if (feedtype === "userpics" || feedtype === "comments") return "perl";
    if (feedtype !== "rss" && feedtype !== "atom") return "notfound";
    const { config } = site;
    const contentType = "text/xml; charset=utf-8";

    await journal.loadProps(db, ["journaltitle", "journalsubtitle", "opt_synlevel", "adult_content", "opt_blockrobots"]);
    const synlevel = /^(full|cut|summary|title)$/.test(journal.props.opt_synlevel ?? "")
        ? journal.props.opt_synlevel! : "cut";
    const link = `${journal.journalBase(site)}/`;
    const title = journal.props.journaltitle || journal.name || journal.user;
    const subtitle = journal.props.journalsubtitle || journal.name;

    // A feed account's feed is the one it reads.
    if (journal.isSyndicated()) {
        const [row] = await db.global("SELECT synurl FROM syndicated WHERE userid = ?", [journal.userid]);
        const synurl = text(row?.synurl);
        return synurl ? { status: 303, body: "", location: synurl }
            : { status: 200, body: "No syndication URL available.", contentType };
    }

    const ditemid = Math.trunc(Number.parseFloat(request.args.itemid ?? "")) || 0;
    let entries: Entry[];
    if (ditemid) {
        const entry = await Entry.byDitemid(db, journal, ditemid);
        if (!entry || !await entry.visibleTo(db, null)) return "notfound";
        entries = [entry];
    } else {
        entries = await Entry.recent(db, journal, {
            itemshow: 25, skip: 0, maxScrollback: config.maxScrollback, tagids: request.filter.tagids,
            tagmode: request.filter.tagmode, tagIntersection: config.tagIntersection, order: "logtime",
        });
    }
    await Entry.fill(db, journal, entries);

    const createtime = (entry: Entry) => Date.parse(`${entry.logtime.replace(" ", "T")}Z`) / 1000;
    let lastmod = 0;
    for (const entry of entries) lastmod = Math.max(lastmod, int(entry.props.revtime) || createtime(entry));
    const lastModified = lastmod ? httpDate(lastmod) : undefined;
    // DW::Request::Plack::meets_conditions
    const since = Date.parse(request.ifModifiedSince ?? "");
    if (lastmod && !Number.isNaN(since) && lastmod <= Math.floor(since / 1000)) {
        return { status: 304, body: "", lastModified };
    }

    const email = await journal.emailForFeeds(db, config, null);
    const posters = await User.byIds(db, [...new Set(entries.map(entry => entry.posterid))]);
    posters.set(journal.userid, journal);
    const content = new ContentCleaner(site);
    await content.preload(db, entries.map(entry => entry.event));
    const moods = await Moods.load(db, []);
    const adultGate = config.enabled.adult_content;

    const items: Item[] = [];
    for (const entry of entries) {
        const poster = posters.get(entry.posterid);
        if (!poster || poster.isSuspended() || entry.isSuspended()) continue;
        const url = entry.url(site);
        const loginOnly = adultGate && entry.adultContent() !== "none";
        const created = createtime(entry);
        const common = {
            entry, poster, url, loginOnly, createtime: created, modtime: int(entry.props.revtime) || created,
            comments: !(entry.props.opt_nocomments !== undefined && perlNumber(entry.props.opt_nocomments) !== 0),
            // LJ::load_log_props2 takes the count from log2.
            replycount: String(entry.replycount),
        };
        if (loginOnly) {
            items.push({ ...common, subject: LOGIN_TITLE, event: loginBody(url), tags: [] });
            continue;
        }
        let subject = entry.subject;
        if (truthy(subject)) subject = cleanSubjectAll(subject.replace(/[\r\n]/g, " "), content.site);
        let event = synlevel === "title" ? "" : await feedEvent(db, site, content, journal, entry, poster, synlevel, url);
        if (!truthy(request.args.no_comment_count)) {
            const alt = config.strings["setting.xpost.option.footer.vars.comment_image.alt"] ?? "";
            const counter = `${config.siteRoot}/tools/commentcount?user=${journal.user}&ditemid=${entry.ditemid}`;
            event += `<br /><br /><img src="${counter}"` +
                ` width="30" height="12" alt="${alt}" style="vertical-align: middle;"/> comments`;
        }
        const moodid = int(entry.props.current_moodid);
        items.push({
            ...common, subject, event, music: entry.props.current_music,
            mood: entry.props.current_mood || (moodid ? moods.name(moodid) : undefined),
            tags: entry.tags.map(tag => tag.name),
        });
    }

    // The newest entry's posting time, or the end of time with none.
    const builddate = httpDate(entries[0] ? createtime(entries[0]) : END_OF_TIME);
    const info = { journal, link, title, subtitle, email, builddate, modtime: lastmod, synlevel };
    const body = feedtype === "rss"
        ? await rss(db, site, info, items)
        : await atom(db, site, info, items);
    return { status: 200, body, contentType, lastModified };
}

interface FeedInfo {
    readonly journal: User;
    readonly link: string;
    readonly title: string;
    readonly subtitle: string;
    readonly email?: string;
    readonly builddate: string;
    readonly modtime: number;
    readonly synlevel: string;
}

// The entry text make_feed puts in an item, before its comment count.
async function feedEvent(db: Databases, site: Site, content: ContentCleaner, journal: User, entry: Entry,
    poster: User, synlevel: string, url: string): Promise<string> {
    let event = entry.event;
    if (!event) return "";
    const readmore = `<b>(<a href="${url}">Read more ...</a>)</b>`;
    // Accounts without full_rss get their text shortened, before cleaning
    // so the cleaner can mend what is cut.
    if (!truthy(journal.getCap(site.config, "full_rss"))) {
        const trunc = textTrim(event, 80);
        if (trunc !== event) event = `${trunc} ${readmore}`;
    }
    event = content.syndicated(entry, event, synlevel === "cut" ? url : undefined);
    if (synlevel === "summary") event = summarize(event, readmore);
    if (journal.journaltype === "C") event = `Posted by: ${ljuserTag(site, poster)}<br /><br />${event}`;
    const polls = [...new Set([...event.matchAll(/<(?:lj-)?poll-(\d+)>/g)].map(match => Number(match[1])))];
    for (const pollid of polls) {
        const name = await pollName(db, content.site, pollid) ?? `#${pollid}`;
        event = event.replace(new RegExp(`<(lj-)?poll-${pollid}>`, "g"),
            `<div><a href="${site.config.siteRoot}/poll/?id=${pollid}">View Poll: ${name}</a></div>`);
    }
    // LJ::EmbedModule::expand_entry with expand_full: the embed's own content.
    const embeds = [...event.matchAll(/(<(?:lj|site)-embed[^>]+\/>)/g)];
    const expanded = await Promise.all(embeds.map(async ([tag]) => {
        const id = /(?:^|\W)id="?(-?\d+)"?/.exec(tag!)?.[1];
        return id && Number(id) ? (await moduleContent(db, journal, Number(id))).content
            : "[invalid site-embed, id is missing]";
    }));
    let at = 0, out = "";
    embeds.forEach((match, i) => {
        out += event.slice(at, match.index) + expanded[i];
        at = match.index! + match[0].length;
    });
    return out + event.slice(at);
}

// LJ::Feed::create_view_rss
async function rss(db: Databases, site: Site, info: FeedInfo, items: readonly Item[]): Promise<string> {
    const { config } = site;
    const { journal } = info;
    let out = "<?xml version='1.0' encoding='utf-8' ?>\n\n";
    out += "<rss version='2.0' xmlns:lj='http://www.livejournal.org/rss/lj/1.0/' "
        + "xmlns:atom10='http://www.w3.org/2005/Atom'>\n";
    out += "<channel>\n";
    out += `  <title>${exml(info.title)}</title>\n`;
    out += `  <link>${info.link}</link>\n`;
    out += `  <description>${exml(`${info.title} - ${config.siteName}`)}</description>\n`;
    if (info.email) out += `  <managingEditor>${exml(info.email)}</managingEditor>\n`;
    out += `  <lastBuildDate>${info.builddate}</lastBuildDate>\n`;
    out += `  <generator>LiveJournal / ${config.siteName}</generator>\n`;
    out += `  <lj:journal>${journal.user}</lj:journal>\n`;
    out += `  <lj:journaltype>${journaltypeReadable(journal)}</lj:journaltype>\n`;
    if (journal.defaultpicid) {
        const pic = (await Userpics.loadAll(db, [journal])).get(journal.userid)?.get(journal.defaultpicid);
        out += "  <image>\n";
        out += `    <url>${config.userpicRoot}/${journal.defaultpicid}/${journal.userid}</url>\n`;
        out += `    <title>${exml(info.title)}</title>\n`;
        out += `    <link>${info.link}</link>\n`;
        out += `    <width>${pic?.width ?? ""}</width>\n`;
        out += `    <height>${pic?.height ?? ""}</height>\n`;
        out += "  </image>\n\n";
    }
    for (const it of items) {
        out += "<item>\n";
        out += `  <guid isPermaLink='true'>${info.link}${it.entry.ditemid}.html</guid>\n`;
        out += `  <pubDate>${httpDate(it.createtime)}</pubDate>\n`;
        if (truthy(it.subject)) out += `  <title>${exml(it.subject)}</title>\n`;
        if (info.email) out += `  <author>${exml(info.email)}</author>`;
        out += `  <link>${it.url}</link>\n`;
        if (info.synlevel !== "title" || it.loginOnly) out += `  <description>${exml(it.event)}</description>\n`;
        if (it.comments) out += `  <comments>${it.url}</comments>\n`;
        for (const tag of it.tags) out += `  <category>${exml(tag)}</category>\n`;
        if (truthy(it.music)) out += `  <lj:music>${exml(it.music)}</lj:music>\n`;
        if (truthy(it.mood)) out += `  <lj:mood>${exml(it.mood)}</lj:mood>\n`;
        if (truthy(it.entry.security)) out += `  <lj:security>${exml(it.entry.security)}</lj:security>\n`;
        if (!journal.equals(it.poster)) out += `  <lj:poster>${exml(it.poster.user)}</lj:poster>\n`;
        out += `  <lj:reply-count>${it.replycount ?? ""}</lj:reply-count>\n`;
        out += "</item>\n";
    }
    return `${out}</channel>\n</rss>\n`;
}

// LJ::Feed::create_view_atom, as XML::Atom and XML::LibXML write it.
async function atom(db: Databases, site: Site, info: FeedInfo, items: readonly Item[]): Promise<string> {
    const { config } = site;
    const { journal } = info;
    const prefix = config.siteNameAbbrev.toLowerCase();
    const api = `${journal.journalBase(site)}/data/atom`;
    const [created] = await db.global("SELECT DATE_FORMAT(timecreate, '%Y-%m-%d') AS d FROM userusage WHERE userid = ?",
        [journal.userid]);
    // LJ::User::atomid
    const atomid = `tag:${config.domain},${text(created?.d)}:${journal.userid}`;
    const person = async (u: User, email: string | undefined, indent: string) =>
        `${indent}<author>\n${email ? `${indent}  <email>${xmlText(email)}</email>\n` : ""}` +
        `${indent}  <name>${xmlText(u.name)}</name>\n${indent}</author>\n`;

    let out = `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="${ATOM_NS}"`;
    if (journal.shouldBlockRobots(config)) out += ' xmlns:idx="urn:atom-extension:indexing" idx:index="no"';
    // XML::LibXML leaves out a namespace declared with an empty URI.
    if (config.siteRoot) out += ` xmlns:${prefix}="${xmlAttr(config.siteRoot)}"`;
    out += ">\n";
    out += `  <id>${xmlText(atomid)}</id>\n`;
    out += `  <title>${xmlText(info.title || journal.user)}</title>\n`;
    if (info.subtitle) out += `  <subtitle>${xmlText(info.subtitle)}</subtitle>\n`;
    out += await person(journal, info.email, "  ");
    out += `  <link rel="alternate" type="text/html" href="${xmlAttr(info.link)}"/>\n`;
    out += `  <link rel="self" type="text/xml" href="${xmlAttr(api)}"/>\n`;
    out += `  <updated>${w3cDate(info.modtime)}</updated>\n`;
    out += `  <${prefix}:journal username="${xmlAttr(exml(journal.user))}"` +
        ` type="${xmlAttr(exml(journaltypeReadable(journal)))}"/>\n`;
    for (const it of items) {
        out += "  <entry>\n";
        out += `    <id>${xmlText(`${atomid}:${it.entry.ditemid}`)}</id>\n`;
        if (!journal.equals(it.poster)) {
            out += await person(it.poster, (await it.poster.emailsVisible(db, config, null))[0], "    ");
            out += `    <${prefix}:poster user="${xmlAttr(exml(it.poster.user))}"/>\n`;
        }
        out += `    <link rel="alternate" type="text/html" href="${xmlAttr(`${info.link}${it.entry.ditemid}.html`)}"/>\n`;
        out += `    <link rel="self" type="text/xml" href="${xmlAttr(`${api}/?itemid=${it.entry.ditemid}`)}"/>\n`;
        const [year, month, day, hour, min, sec] = it.entry.alldatepart.split(" ");
        const fallback = `${journal.user} @ ${year}-${month}-${day}T${hour}:${min}:${sec}`;
        out += `    <title>${xmlText(it.subject || fallback)}</title>\n`;
        out += `    <published>${w3cDate(it.createtime)}</published>\n`;
        out += `    <updated>${w3cDate(it.modtime)}</updated>\n`;
        for (const tag of it.tags) out += `    <category term="${xmlAttr(tag)}"/>\n`;
        if (!it.loginOnly) {
            for (const [key, value] of [["music", it.music], ["mood", it.mood], ["security", it.entry.security],
                ["reply-count", it.replycount]] as const) {
                if (value !== undefined) out += `    <${prefix}:${key}>${xmlText(value)}</${prefix}:${key}>\n`;
            }
        }
        if (it.loginOnly || info.synlevel === "full" || info.synlevel === "cut") {
            out += `    <content type="html">${xmlText(it.event)}</content>\n`;
        } else if (info.synlevel === "summary") {
            out += `    <summary type="html">${xmlText(it.event)}</summary>\n`;
        }
        out += "  </entry>\n";
    }
    return `${out}</feed>\n`;
}

// LJ::User::journaltype_readable
function journaltypeReadable(u: User): string {
    return ({ R: "redirect", I: "identity", P: "personal", Y: "syndicated", C: "community" } as Record<string, string>)[
        u.journaltype] ?? "";
}

// LJ::Entry::summarize: the first paragraph, then a link to the rest.
function summarize(event: string, readmore: string): string {
    const match = /(.*?(?:(?:<br\s*\/?>(?:<\/br\s*>)?\s*){2}|<\/p\s*>))/i.exec(event);
    return match ? match[1] + readmore : event;
}

// LJ::text_trim to a number of characters, after trimming whitespace.
function textTrim(text: string, chars: number): string {
    return [...text.trim()].slice(0, chars).join("");
}

// LJ::time_to_http
function httpDate(time: number): string {
    return new Date(time * 1000).toUTCString();
}

// LJ::time_to_w3c in UTC
function w3cDate(time: number): string {
    return new Date(time * 1000).toISOString().replace(/\.\d+Z$/, "Z");
}

// LJ::exml
function exml(value: string | undefined): string {
    return (value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&apos;")
        .replaceAll("<", "&lt;").replaceAll(">", "&gt;").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

// XML::LibXML's escaping of text and of attribute values.
function xmlText(value: string): string {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\r", "&#13;");
}

function xmlAttr(value: string): string {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
        .replaceAll("\r", "&#13;").replaceAll("\n", "&#10;").replaceAll("\t", "&#9;");
}

// Perl's numeric value of a string: its leading number, or 0.
function perlNumber(value: string): number {
    return Number.parseFloat(value) || 0;
}
