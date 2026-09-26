// cohort.ts
//
// Local S2 cohort admission and source-derived rendering.
//
// Portions adapted from LJ::User::Account, LJ::Capabilities, LJ::S2::RecentPage
// and DW::Logic::LogItems. The LJ-derived portions were forked from LiveJournal,
// owned and operated by Live Journal, Inc., and modified by Dreamwidth Studios,
// LLC. Under the inherited license these portions and modifications are provided
// under the GNU General Public License; see LICENSE in this distribution.
// Original: http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.
//

import type { RawJournalSnapshot, RawEntryHeader, PublicAppConfig } from "../contracts";
import type { SourceCapabilities } from "../startup-types";
import type { ApprovedJournal, ApprovedEntry } from "../render/types";
import { rawBody, plainSubject, Unsupported } from "./content";

import {approveTags} from "../domain/tags";
import {approveLinks, navigationUrl, websiteName} from "../domain/links";

import {UserpicSelection} from "../domain/userpics";

import { SOURCE_HASHES } from "../render/source-hashes";
export { SOURCE_HASHES } from "../render/source-hashes";

const perlTrue = (value: string | null | undefined): boolean =>
    value !== undefined && value !== null && value !== "" && value !== "0";

export function canonicalUsername(value: string, maxLength: number): string | null {
    // LJ::canonical_username: ASCII source domain; URL admission rejects encoded
    // or whitespace path spellings before reaching this scalar canonicalizer.
    const name = value.toLowerCase().replace(/-/g, "_");
    return Number.isSafeInteger(maxLength) && maxLength >= 1 &&
        name.length <= Math.min(maxLength, 25) && /^[a-z0-9_]+$/.test(name) ? name : null;
}

export function journalBase(username: string, config: PublicAppConfig): string {
    // LJ::journal_base (User/Account.pm): configured P rule for admitted personal
    // journals. Dynamic hook URLs cannot be invented from a presence flag.
    const rules = config.journalUrls;
    if (rules.hookConfigured) throw new Unsupported();
    const rule = rules.subdomainRules.P;
    if (!rule) throw new Unsupported();
    let base: string;
    if (rule[0] && !username.startsWith("_") && !username.endsWith("_")) {
        if (!rules.domain) throw new Unsupported();
        base = `${rules.protocol}://${username.replace(/_/g, "-")}.${rules.domain}`;
    } else if (!rule[1] && rules.isDevServer) {
        base = `${rules.protocol}://${new URL(config.canonicalAppOrigin).host}/~${username}`;
    } else base = `${rules.protocol}://${rule[1]}/${username}`;
    const parsed = new URL(base);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password ||
        parsed.search || parsed.hash || /[\x00-\x20"'<>\\]/.test(base)) throw new Unsupported();
    return base;
}

function integer(value: number, min = 0, max = Number.MAX_SAFE_INTEGER): boolean {
    return Number.isSafeInteger(value) && value >= min && value <= max;
}

export function supportsEntry(caps: string, source: SourceCapabilities): boolean {
    if (source.s2ViewEntry.hookConfigured) throw new Unsupported();
    let selected: number | null = null;
    const bits = new Set<number>();
    for (const item of source.s2ViewEntry.byBit) {
        if (!integer(item.bit, 0, 15) || bits.has(item.bit) || !Number.isFinite(item.value)) {
            throw new Unsupported();
        }
        bits.add(item.bit);
        if ((BigInt(caps) & (1n << BigInt(item.bit))) !== 0n) {
            selected = selected === null ? item.value : Math.max(selected, item.value);
        }
    }
    const result = selected ?? source.s2ViewEntry.defaultValue;
    if (result !== null && !Number.isFinite(result)) throw new Unsupported();
    return result !== null && result !== 0;
}

const HEADER_FIELDS = ["journalid", "jitemid", "anum", "posterid", "eventtime", "logtime",
    "rlogtime", "revttime", "year", "month", "day", "security", "allowmask", "replycount",
    "compressed"] as const satisfies readonly (keyof RawEntryHeader)[];

function selectedHeaders(snapshot: RawJournalSnapshot, config: PublicAppConfig): readonly RawEntryHeader[] {
    const selection = snapshot.selection;
    const request = snapshot.request;
    if (selection.kind !== request.page.kind) throw new Unsupported();
    let selected: readonly RawEntryHeader[];
    if (selection.kind === "entry") {
        if (request.page.kind !== "entry" || selection.ditemid !== request.page.ditemid ||
            selection.target.jitemid * 256 + selection.target.anum !== selection.ditemid) throw new Unsupported();
        selected = [selection.target];
    } else {
        if (request.page.kind !== "recent" || !integer(request.page.skip) ||
            request.page.itemshow !== 20 || selection.itemshow !== 20 ||
            selection.maxScrollback !== config.maxScrollback || !integer(config.maxScrollback, 21) ||
            selection.pageSkip !== Math.min(request.page.skip, config.maxScrollback - 20) ||
            selection.loadSkip !== Math.min(selection.pageSkip, config.maxScrollback - 21) ||
            selection.window.length > 21) throw new Unsupported();
        const ids = new Set<number>();
        for (let index = 0; index < selection.window.length; index++) {
            const row = selection.window[index]!;
            const previous = selection.window[index - 1];
            if (row.security !== "public" || row.journalid !== snapshot.owner.userid ||
                !integer(row.jitemid, 1, 16777215) || ids.has(row.jitemid) ||
                !integer(row.anum, 0, 255) || !integer(row.revttime, 0, 2147483647) ||
                (previous && (row.revttime < previous.revttime ||
                    (row.revttime === previous.revttime && row.jitemid < previous.jitemid)))) {
                throw new Unsupported();
            }
            ids.add(row.jitemid);
        }
        // DW::Logic::LogItems flushes each contiguous full event-time group AFTER
        // SQL LIMIT and sorts that group by itemid descending. Then RecentPage
        // removes the extra row. S2 alldatepart includes seconds despite the
        // retained per-minute comment. Never slice selected bodies again.
        const reordered: RawEntryHeader[] = [];
        for (let start = 0; start < selection.window.length;) {
            let end = start + 1;
            const time = selection.window[start]!.eventtime;
            while (end < selection.window.length && selection.window[end]!.eventtime === time) end++;
            reordered.push(...selection.window.slice(start, end).sort((a, b) => b.jitemid - a.jitemid));
            start = end;
        }
        selected = reordered.slice(0, selection.itemshow);
        if (JSON.stringify(selected.map(row => row.jitemid)) !== JSON.stringify(selection.selectedJitemids)) {
            throw new Unsupported();
        }
    }
    if (snapshot.entries.length !== selected.length || new Set(snapshot.entries.map(row => row.jitemid)).size !== selected.length) {
        throw new Unsupported();
    }
    for (const header of selected) {
        const row = snapshot.entries.find(entry => entry.jitemid === header.jitemid);
        if (!row || HEADER_FIELDS.some(key => row[key] !== header[key])) throw new Unsupported();
    }
    return selected;
}

function approveCalendar(snapshot: RawJournalSnapshot): ApprovedJournal["calendar"] {
    const calendar = snapshot.calendar;
    const validMonth = (value: {year: number; month: number}, zero = false): boolean =>
        integer(value.year, 1, 9999) && integer(value.month, zero ? 0 : 1, 12);
    if (!validMonth(snapshot.request.calendarNow) || !validMonth(calendar.current, true) ||
        calendar.current.year > snapshot.request.calendarNow.year ||
        (calendar.current.year === snapshot.request.calendarNow.year &&
            calendar.current.month > snapshot.request.calendarNow.month) ||
        calendar.days.length > 31 || calendar.otherPosterCount !== 0) throw new Unsupported();
    const days = new Set<number>();
    let total = 0;
    const {year, month} = calendar.current;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const maxDay = [0,31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31][month]!;
    for (const day of calendar.days) {
        if (!integer(day.day, 1, maxDay) || !integer(day.count, 1) || days.has(day.day)) throw new Unsupported();
        days.add(day.day); total += day.count;
    }
    const statuses = new Set<string | null>();
    let contributors = 0;
    for (const row of calendar.entryStatusCounts) {
        if (![null, "", "V"].includes(row.statusvis) || !integer(row.count, 1) || statuses.has(row.statusvis)) {
            throw new Unsupported();
        }
        statuses.add(row.statusvis); contributors += row.count;
    }
    if (!integer(total) || !integer(contributors) || contributors < total) throw new Unsupported();
    // LJ/S2/YearPage.pm157-190 filters year AND month independently before
    // selecting a neighbor. Preserve that source quirk across year boundaries;
    // ordinary chronological ordering would admit a different visible link.
    if (calendar.previous && (!validMonth(calendar.previous) ||
        calendar.previous.year > year || calendar.previous.month >= month)) throw new Unsupported();
    if (calendar.next && (!validMonth(calendar.next) || calendar.next.year < year || calendar.next.month <= month)) {
        throw new Unsupported();
    }
    return {year, month, days: calendar.days.map(day => ({...day})),
        previous: calendar.previous && {...calendar.previous}, next: calendar.next && {...calendar.next}};
}

export function approveSnapshot(snapshot: RawJournalSnapshot, config: PublicAppConfig,
    capabilities: SourceCapabilities): ApprovedJournal {
    const u = snapshot.owner;
    const p = u.publicSettings;
    if (u.user !== snapshot.request.username || canonicalUsername(u.user, config.usernameMaxLength) !== u.user ||
        u.status !== "A" || u.statusvis !== "V" || u.journaltype !== "P" ||
        !integer(u.clusterid, 1) || !integer(u.dversion) || !/^(0|[1-9][0-9]*)$/.test(u.caps) ||
        BigInt(u.caps) > 65535n || !integer(capabilities.moveInProgressMask, 0, 65535) ||
        (BigInt(u.caps) & BigInt(capabilities.moveInProgressMask)) !== 0n || !integer(u.defaultpicid) ||
        !["Y", "N"].includes(u.optShowTalkLinks) ||
        u.optWhocanReply !== "all" ||
        u.optForceMoodtheme !== "N" || ![0, 1].includes(u.moodthemeid) ||
        !Number.isSafeInteger(u.userid) || u.userid <= 0) throw new Unsupported();
    const empty = ["adult_content_reason", "sticky_entry", "icbm",
        "google_analytics", "ga4_analytics", "renamedto", "customtext_content",
        "customtext_url"] as const;
    if (empty.some(key => p[key] !== null && p[key] !== "") ||
        ![null, "", "none"].includes(p.adult_content) ||
        ![null, "", "Custom Text"].includes(p.customtext_title) ||
        ![null, "", "N", "Y"].includes(p.opt_blockrobots) ||
        ![null, "", "dark", "light"].includes(p.control_strip_color) ||
        ![null, "", "off", "off:dark", "dark"].includes(p.show_control_strip) ||
        ![null, "", "off", "off:dark", "dark"].includes(p.view_control_strip)) throw new Unsupported();
    // Preserve the supported picture/comment rendering feature boundary. The
    // private viewer intentionally does not implement request captcha defenses.
    if (![null, "", "N"].includes(p.opt_usesharedpic)) throw new Unsupported();
    // LJ/S2.pm calls use_journalstyle_entry_page even for recent requests and
    // persists Y from the stock core2 default. Its switch affects entry/reply
    // only; admit that normal derived value without writing absent defaults.
    if (snapshot.selection.kind === "entry" &&
        (p.use_journalstyle_entry_page === "N" || !supportsEntry(u.caps, capabilities))) throw new Unsupported();
    for (const key of ["opt_allowsearchby", "opt_blockglobalsearch", "opt_ctxpopup",
        "opt_whoscreened", "opt_usermsg", "opt_tagpermissions",
        "opt_embedplaceholders", "opt_imagelinks", "opt_imageundef", "opt_maxpicheight",
        "opt_maxpicwidth", "exclude_from_own_stats"] as const) {
        if (p[key] !== null && p[key] !== "") throw new Unsupported();
    }
    const style = snapshot.style;
    if (!style || style.layers.length !== 2 || !integer(style.modtime) ||
        (style.origin === "persisted" ? (style.ownerid !== u.userid ||
            !/^0*2$/.test(p.stylesys ?? "") || !/^[0-9]+$/.test(p.s2_style ?? "") ||
            Number(p.s2_style) !== style.styleid || !integer(style.styleid, 1)) :
            (style.origin !== "default" || style.styleid !== 0 || style.ownerid !== null))) {
        throw new Unsupported();
    }
    for (const [index, type] of ["core", "layout"].entries()) {
        const layer = style.layers.find(layer => layer.type === type);
        if (!layer || layer.ownerUsername !== "system" || layer.sourceHash !== SOURCE_HASHES[index] ||
            !Number.isSafeInteger(layer.ownerid) || layer.ownerid <= 0 ||
            !Number.isSafeInteger(layer.s2lid) || layer.s2lid <= 0 ||
            !integer(layer.compiledTime)) throw new Unsupported();
    }
    if (["comments"].some(key => snapshot.features[key as keyof typeof snapshot.features] !== 0) ||
        snapshot.posters.length !== 1 || snapshot.posters.some(poster =>
            poster.userid !== u.userid || poster.user !== u.user || poster.clusterid !== u.clusterid ||
            poster.statusvis !== "V" || poster.status !== "A")) throw new Unsupported();
    if (snapshot.features.links !== snapshot.links.length || snapshot.features.usertags!==snapshot.tags.definitions.length ||
        snapshot.features.logkwsum!==snapshot.tags.summaries.length || snapshot.features.logtags<snapshot.tags.associations.length) throw new Unsupported();
    const headers = selectedHeaders(snapshot, config);
    if(config.tagListHookConfigured && headers.length)throw new Unsupported();
    const tags=approveTags(snapshot.tags,headers.map(header=>header.jitemid),config.tagsEnabled);
    const calendar = approveCalendar(snapshot);
    const pictures = new UserpicSelection(snapshot.userpics,u.userid,u.defaultpicid,u.dversion);
    const defaultUserpic = pictures.defaultPicture();
    const entries: ApprovedEntry[] = [];
    const ids = new Set<number>();
    let bytes = 0;
    for (const header of headers) {
        const entry = snapshot.entries.find(row => row.jitemid === header.jitemid)!;
        if (entry.journalid !== u.userid || entry.posterid !== u.userid ||
            entry.security !== "public" ||
            !/^(0|[1-9][0-9]*)$/.test(entry.allowmask) || BigInt(entry.allowmask) > 18446744073709551615n ||
            !integer(entry.jitemid, 1, 16777215) || ids.has(entry.jitemid) ||
            !Number.isInteger(entry.anum) || entry.anum < 0 || entry.anum > 255 ||
            entry.replycount !== 0) throw new Unsupported();
        ids.add(entry.jitemid);
        if (!snapshot.posters.some(poster => poster.userid === entry.posterid)) throw new Unsupported();
        bytes += Buffer.byteLength(entry.subjectText) + Buffer.byteLength(entry.eventText);
        if (bytes > 2097152) throw new Unsupported();
        const props = entry.props;
        const allowed = new Set(["editor", "opt_preformatted", "opt_backdated", "opt_nocomments",
            "opt_nocomments_maintainer", "revnum", "revtime", "interface", "useragent",
            "opt_noemail", "opt_screening", "statusvis", "picture_mapid", "picture_keyword"]);
        if (Object.entries(props).some(([key, value]) => value && !allowed.has(key)) ||
            props.editor !== "html_raw0" || ![undefined, null, "", "0", "1"].includes(props.opt_preformatted) ||
            (props.statusvis && props.statusvis !== "V")) throw new Unsupported();
        for (const flag of ["opt_preformatted", "opt_backdated", "opt_nocomments",
            "opt_nocomments_maintainer", "opt_noemail"] as const) {
            if (![undefined, null, "", "0", "1"].includes(props[flag])) throw new Unsupported();
        }
        if (perlTrue(props.opt_nocomments_maintainer)) throw new Unsupported();
        for (const time of [entry.eventtime, entry.logtime]) {
            if (!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(time) ||
                !Number.isFinite(Date.parse(time.replace(" ", "T") + "Z")) ||
                new Date(time.replace(" ", "T") + "Z").toISOString().slice(0, 19).replace("T", " ") !== time) {
                throw new Unsupported();
            }
        }
        if (!Number.isSafeInteger(entry.revttime) || entry.revttime < 0 || entry.revttime > 2147483647 ||
            entry.year !== Number(entry.eventtime.slice(0, 4)) ||
            entry.month !== Number(entry.eventtime.slice(5, 7)) ||
            entry.day !== Number(entry.eventtime.slice(8, 10))) throw new Unsupported();
        entries.push({
            id: entry.jitemid * 256 + entry.anum, tags: tags.entries.get(entry.jitemid) ?? [],
            subject: plainSubject(entry.subjectText), rawBody: rawBody(entry.eventText),
            eventtime: entry.eventtime, logtime: entry.logtime, reverseTime: entry.revttime,
            year: entry.year, month: entry.month, day: entry.day,
            userpic: pictures.forEntry(props),
            commentsEnabled: u.optShowTalkLinks === "Y" && !perlTrue(props.opt_nocomments),
        });
    }
    if (snapshot.selection.kind === "entry" && config.userpicUrlHookConfigured &&
        entries.some(entry=>entry.userpic!==null)) throw new Unsupported();
    const display = p.control_strip_display;
    if (display !== null && display !== "" && display !== "none" && !/^[0-7]$/.test(display)) {
        throw new Unsupported();
    }
    const text = (value: string): string => {
        if (value.length > 1024 || /[<>\x00-\x1f]/.test(value)) throw new Unsupported();
        return value;
    };
    return {
        userid: u.userid, username: u.user, name: text(u.name),
        baseUrl: journalBase(u.user, config), calendar,
        title: text(p.journaltitle || u.name), subtitle: text(p.journalsubtitle || ""),
        styleid: style.styleid,
        styleTime: Math.max(style.modtime, ...style.layers.map(layer => layer.compiledTime)),
        showControlStrip: display === null || display === "" ||
            (display !== "none" && (Number(display) & 1) !== 0),
        controlStripColor: p.control_strip_color === "light" ? "light" : "dark",
        blockRobots: p.opt_blockrobots === "Y", entries, defaultUserpic,
        websiteUrl: navigationUrl(p.url ?? ""), websiteName: websiteName(p.urlname ?? ""),
        links: approveLinks(snapshot.links), sidebarTags: tags.sidebar,
    };
}
