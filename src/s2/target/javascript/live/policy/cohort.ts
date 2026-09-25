// cohort.ts
//
// Local S2 cohort admission and source-derived rendering.
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

import type { RawJournalSnapshot } from "../contracts";
import type { ApprovedJournal, ApprovedEntry } from "../render/types";
import { rawBody, plainSubject, Unsupported } from "./content";

export const USERNAME = "s2js_slice3";
export const MARKER = "s2-js-slice3 live dev v1";
export const SOURCE_HASHES = [
    "8621d96ebc6f9ee9eaf19f4cc0ac9e029b0e816d982653d19d52b04918cd9db6",
    "c1f6fb95fbecc202a024efa7558c6cedcdb5229f150e765fd441ba632ff0b411",
] as const;

const perlTrue = (value: string | null | undefined): boolean =>
    value !== undefined && value !== null && value !== "" && value !== "0";

export function approveSnapshot(snapshot: RawJournalSnapshot): ApprovedJournal {
    const u = snapshot.owner;
    const p = u.publicSettings;
    if (u.user !== USERNAME || u.bio !== MARKER || u.hasBio !== "Y" || u.status !== "A" ||
        u.statusvis !== "V" || u.journaltype !== "P" || u.clusterid !== 1 ||
        u.dversion !== 10 || u.caps !== "2" || u.defaultpicid !== 0 ||
        !["Y", "N"].includes(u.optShowTalkLinks) ||
        u.optWhocanReply !== "all" ||
        u.optForceMoodtheme !== "N" || ![0, 1].includes(u.moodthemeid) ||
        !Number.isSafeInteger(u.userid) || u.userid <= 0) throw new Unsupported();
    const empty = ["url", "urlname", "adult_content_reason", "sticky_entry", "icbm",
        "google_analytics", "ga4_analytics", "renamedto", "customtext_content",
        "customtext_url"] as const;
    if (empty.some(key => p[key] !== null && p[key] !== "") ||
        ![null, "", "none"].includes(p.adult_content) ||
        ![null, "", "Custom Text"].includes(p.customtext_title) ||
        p.stylesys !== "2" || ![null, "", "N", "Y"].includes(p.opt_blockrobots) ||
        ![null, "", "dark", "light"].includes(p.control_strip_color) ||
        ![null, "", "off", "off:dark", "dark"].includes(p.show_control_strip) ||
        ![null, "", "off", "off:dark", "dark"].includes(p.view_control_strip)) throw new Unsupported();
    // Public free-cohort capabilities are fixed; property values cannot turn on
    // captcha, custom picture/comment behavior or search features behind it.
    if (![null, "", "N"].includes(p.opt_usesharedpic) ||
        ![null, "", "N"].includes(p.opt_no_quickreply)) throw new Unsupported();
    // LJ/S2.pm calls use_journalstyle_entry_page even for recent requests and
    // persists Y from the stock core2 default. Its switch affects entry/reply
    // only; admit that normal derived value without writing absent defaults.
    if (![null, "", "Y"].includes(p.use_journalstyle_entry_page)) throw new Unsupported();
    for (const key of ["opt_allowsearchby", "opt_blockglobalsearch", "opt_ctxpopup",
        "opt_show_captcha_to", "opt_whoscreened", "opt_usermsg", "opt_tagpermissions",
        "opt_embedplaceholders", "opt_imagelinks", "opt_imageundef", "opt_maxpicheight",
        "opt_maxpicwidth", "timezone", "exclude_from_own_stats",
        "use_journalstyle_icons_page"] as const) {
        if (p[key] !== null && p[key] !== "") throw new Unsupported();
    }
    const style = snapshot.style;
    if (!style || style.ownerid !== u.userid || style.name !== MARKER ||
        String(style.styleid) !== p.s2_style || style.layers.length !== 2) throw new Unsupported();
    for (const [index, type] of ["core", "layout"].entries()) {
        const layer = style.layers.find(layer => layer.type === type);
        if (!layer || layer.ownerUsername !== "system" || layer.sourceHash !== SOURCE_HASHES[index] ||
            !Number.isSafeInteger(layer.ownerid) || layer.ownerid <= 0 ||
            !Number.isSafeInteger(layer.s2lid) || layer.s2lid <= 0 ||
            !Number.isSafeInteger(layer.compiledTime)) throw new Unsupported();
    }
    if (["usertags", "userkeywords", "logtags", "logtagsrecent", "logkwsum", "links",
        "userpics", "comments"].some(key => snapshot.features[key as keyof typeof snapshot.features] !== 0) ||
        snapshot.entries.length > 200 || snapshot.posters.some(poster =>
            poster.userid !== u.userid || poster.user !== u.user ||
            poster.statusvis !== "V" || poster.status !== "A")) throw new Unsupported();
    const entries: ApprovedEntry[] = [];
    const ids = new Set<number>();
    let bytes = 0;
    for (const entry of snapshot.entries) {
        bytes += Buffer.byteLength(entry.subjectText) + Buffer.byteLength(entry.eventText);
        if (bytes > 2097152 || entry.journalid !== u.userid || entry.posterid !== u.userid ||
            !["public", "private", "usemask"].includes(entry.security) ||
            !/^(0|[1-9][0-9]*)$/.test(entry.allowmask) || BigInt(entry.allowmask) > 18446744073709551615n ||
            !Number.isSafeInteger(entry.jitemid) || entry.jitemid <= 0 || ids.has(entry.jitemid) ||
            !Number.isInteger(entry.anum) || entry.anum < 0 || entry.anum > 255 ||
            entry.replycount !== 0) throw new Unsupported();
        ids.add(entry.jitemid);
        // Nonpublic data is never inspected for rendering or copied downstream.
        if (entry.security !== "public") continue;
        if (!snapshot.posters.some(poster => poster.userid === entry.posterid)) throw new Unsupported();
        const props = entry.props;
        const allowed = new Set(["editor", "opt_preformatted", "opt_backdated", "opt_nocomments",
            "opt_nocomments_maintainer", "revnum", "revtime", "interface", "useragent",
            "opt_noemail", "opt_screening", "statusvis"]);
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
            id: entry.jitemid * 256 + entry.anum,
            subject: plainSubject(entry.subjectText), rawBody: rawBody(entry.eventText),
            eventtime: entry.eventtime, logtime: entry.logtime, reverseTime: entry.revttime,
            year: entry.year, month: entry.month, day: entry.day,
            commentsEnabled: u.optShowTalkLinks === "Y" && !perlTrue(props.opt_nocomments),
        });
    }
    // InnoDB revttime secondary-index ties use the primary jitemid. Reorder
    // minute groups only AFTER taking the requested SQL LIMIT window (prepare).
    entries.sort((a, b) => a.reverseTime - b.reverseTime ||
        Math.floor(a.id / 256) - Math.floor(b.id / 256));
    const display = p.control_strip_display;
    if (display !== null && display !== "" && display !== "none" && !/^[0-7]$/.test(display)) {
        throw new Unsupported();
    }
    const text = (value: string): string => {
        if (value.length > 1024 || /[<>\x00-\x1f]/.test(value)) throw new Unsupported();
        return value;
    };
    return {
        userid: u.userid, username: USERNAME, name: text(u.name),
        title: text(p.journaltitle || u.name), subtitle: text(p.journalsubtitle || ""),
        styleid: style.styleid,
        styleTime: Math.max(style.modtime, ...style.layers.map(layer => layer.compiledTime)),
        showControlStrip: display === null || display === "" ||
            (display !== "none" && (Number(display) & 1) !== 0),
        controlStripColor: p.control_strip_color === "light" ? "light" : "dark",
        blockRobots: p.opt_blockrobots === "Y", entries,
    };
}
