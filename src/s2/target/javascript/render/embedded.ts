// embedded.ts
//
// Expand what entries embed by reference: polls, as LJ::Poll::render shows
// them to a logged-out viewer, and media, as LJ::EmbedModule's iframes.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { createHash, randomInt } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { type CleanSite, clean, cleanEmbed, eurl } from "@dreamwidth/content";
import { type Databases, type Row, int, text } from "../data/db";
import { User } from "../data/user";
import type { SiteConfig } from "../server/config";

// LJ::expand_embedded: polls, then embedded media.
export async function expandEmbedded(db: Databases, site: CleanSite, config: SiteConfig, journal: User,
    html: string): Promise<string> {
    html = await replaceAsync(html, /<(?:lj-)?poll-(\d+)>/g, match => renderPoll(db, site, config, Number(match[1])));
    return replaceAsync(html, /(<(?:lj|site)-embed[^>]+\/>)/g, match => embedTag(db, site, config, journal, match[1]!));
}

async function replaceAsync(html: string, pattern: RegExp, replace: (match: RegExpMatchArray) => Promise<string>):
    Promise<string> {
    const matches = [...html.matchAll(pattern)];
    if (!matches.length) return html;
    const replacements = await Promise.all(matches.map(replace));
    let out = "", at = 0;
    matches.forEach((match, i) => {
        out += html.slice(at, match.index) + replacements[i];
        at = match.index! + match[0].length;
    });
    return out + html.slice(at);
}

// LJ::Lang::ml with [[name]] substitutions.
function ml(config: SiteConfig, key: string, vars: Record<string, string | number> = {}): string {
    return (config.strings[key] ?? "").replace(/\[\[(\w+)\]\]/g, (_, name) => String(vars[name] ?? ""));
}

// Perl's default number formatting, which keeps 15 significant digits.
function perlNumber(value: number): string {
    return String(Number(value.toPrecision(15)));
}

// LJ::EmbedModule::_expand_tag and module_iframe_tag
async function embedTag(db: Databases, site: CleanSite, config: SiteConfig, journal: User, tag: string): Promise<string> {
    const attrs: Record<string, string> = {};
    for (const match of tag.matchAll(/(\w+)="?(-?\d+)"?/g)) attrs[match[1]!] = match[2]!;
    if (!attrs.id) return "[invalid site-embed, id is missing]";
    if (!config.enabled.embed_module) return "";
    const moduleid = Number(attrs.id);

    const rows = await journal.cluster(db,
        "SELECT content, linktext, url FROM embedcontent WHERE moduleid = ? AND userid = ?", [moduleid, journal.userid]);
    const row: Row | undefined = rows[0];
    let content = "";
    if (row?.content) {
        // Stored compressed behind a "C-" marker.
        const raw = row.content as Buffer;
        content = raw.subarray(0, 2).toString("latin1") === "C-" ? gunzipSync(raw.subarray(2)).toString("utf8") : text(raw);
    }
    content = cleanEmbed(content, site);
    const linktext = row ? text(row.linktext) : undefined;
    const url = row && row.url !== null ? text(row.url) : undefined;

    let [width, height, widthUnit, heightUnit] = [0, 0, "", ""];
    if (!(attrs.width && attrs.height)) {
        const numUnit = (value: string): [number, string] =>
            [parseFloat(value.replace("%", "")) || 0, value.includes("%") ? "%" : ""];
        for (const match of content.matchAll(/<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g)) {
            const attr: Record<string, string> = {};
            for (const a of match[2]!.matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
                attr[a[1]!.toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? a[1]!;
            }
            if (attr.width) {
                const [w, unit] = numUnit(attr.width);
                if (w > width) [width, widthUnit] = [w, unit];
            }
            if (attr.height) {
                const [h, unit] = numUnit(attr.height);
                if (h > height) [height, heightUnit] = [h, unit];
            }
            const style = Object.fromEntries((attr.style ?? "").split(";").map(s => s.trim()).filter(Boolean)
                .map(s => s.split(/\s*:\s*/) as [string, string]));
            for (const [key, current] of [["width", width], ["height", height]] as const) {
                const match = /^(\d+)(.*)/.exec(style[key] ?? "");
                if (!style[key] || current || !match || !Number(match[1])) continue;
                const unit = /^%/.test(match[2]!) ? "%" : "";
                if (key === "width") [width, widthUnit] = [Number(match[1]), unit];
                else [height, heightUnit] = [Number(match[1]), unit];
            }
        }
    }
    if (attrs.width) width = Number(attrs.width);
    if (attrs.height) height = Number(attrs.height);
    width = Math.max(50, width || 480);
    height = Math.max(50, height || 400);
    width = Math.min(width, widthUnit === "%" ? 100 : 800);
    height = Math.min(height, heightUnit === "%" ? 100 : 800);

    const wrapperStyle = `max-width: ${width}${widthUnit || "px"}; max-height: 800px;`;
    const padding = heightUnit === widthUnit ? `${perlNumber(height / width * 100)}%`
        : `${perlNumber(heightUnit === "%" ? height / 100 * width : width / 100 * height)}px`;
    const id = `embed_${journal.userid}_${moduleid}`;
    const name = `${id}_${authCode(5)}`;
    const directLink = url !== undefined ? `<div><a href="${url}">${linktext}</a></div>` : "";
    const token = eurl(await sessionlessAuthToken(db, "embedcontent", { journalid: journal.userid, moduleid, preview: "" }));
    const src = `//${config.embedModuleDomain}/?journalid=${journal.userid}&moduleid=${moduleid}&preview=&auth_token=${token}`;
    return `<div class="lj_embedcontent-wrapper" style="${wrapperStyle}"><div class="lj_embedcontent-ratio" style="padding-top: ${padding}"><iframe src="${src}"` +
        ` width="${width}${widthUnit}" height="${height}${heightUnit}" allowtransparency="true" frameborder="0" allowfullscreen="true"` +
        ` class="lj_embedcontent" id="${id}" name="${name}"></iframe></div></div>${directLink}`;
}

// LJ::make_auth_code
function authCode(length: number): string {
    const digits = "abcdefghjkmnpqrstvwxyz23456789";
    return Array.from({ length }, () => digits[randomInt(30)]).join("");
}

// LJ::Auth::sessionless_auth_token, signed with the newest existing secret
// since this server cannot make one.
async function sessionlessAuthToken(db: Databases, uri: string, vars: Record<string, string | number>): Promise<string> {
    const [row] = await db.global("SELECT stime, secret FROM secrets WHERE stime <= UNIX_TIMESTAMP() ORDER BY stime DESC LIMIT 1");
    const reqvars = Object.keys(vars).sort().map(key => vars[key]).join("&");
    const bare = `sessionless:${int(row?.stime)}:${uri}:${reqvars}`;
    return `${bare}:${createHash("sha1").update(bare + text(row?.secret)).digest("hex")}`;
}

// LJ::Poll::render in results mode, which is what a logged-out viewer gets.
async function renderPoll(db: Databases, site: CleanSite, config: SiteConfig, pollid: number): Promise<string> {
    const [owner] = await db.global("SELECT journalid FROM pollowner WHERE pollid = ?", [pollid]);
    const journal = owner ? (await User.byIds(db, [int(owner.journalid)])).get(int(owner.journalid)) : undefined;
    const [poll] = journal ? await journal.cluster(db,
        "SELECT ditemid, posterid, isanon, whovote, whoview, name, status FROM poll2 WHERE pollid = ? AND journalid = ?",
        [pollid, journal.userid]) : [];
    if (!journal || !poll) return `[Error: Invalid poll ID ${pollid}]`;
    if (!journal.clusterid) return `<b>[${ml(config, "poll.error.deletedowner")}]</b>`;
    if (!int(poll.ditemid)) return `<b>[${ml(config, "poll.error.noentry")}]</b>`;

    const query = (sql: string, params: unknown[] = []) => journal.cluster(db, sql, [...params, pollid, journal.userid]);
    const [questions, items, results, [participants]] = await Promise.all([
        query("SELECT pollqid, sortorder, type, opts, qtext FROM pollquestion2 WHERE pollid = ? AND journalid = ?"),
        query("SELECT pollqid, pollitid, sortorder, item FROM pollitem2 WHERE pollid = ? AND journalid = ?"),
        query("SELECT pollqid, value FROM pollresult2 WHERE pollid = ? AND journalid = ?"),
        query("SELECT COUNT(DISTINCT userid) AS n FROM pollresult2 WHERE pollid = ? AND journalid = ?"),
    ]);
    const cleanPoll = (value: string) => /[<>]/.test(value) ? clean(value, {
        addbreaks: false, mode: "deny", eat: ["head", "title", "style", "layer", "iframe", "applet", "object"],
        allow: ["a", "b", "i", "u", "strong", "em", "img"], remove: ["bgsound", "embed", "object", "caption", "link", "font"],
    }, site) : value;
    const whovote = text(poll.whovote), isanon = text(poll.isanon);
    const whoview = text(poll.whoview) === "none" ? "none_others2" : text(poll.whoview);
    const canView = text(poll.whoview) === "all";
    const closed = text(poll.status) === "X";
    const root = config.siteRoot;
    const pagesize = 2000;

    let html = `<div id='poll-${pollid}-container' class='poll-container'>`;
    html += `<div class='poll-title'><b><a href='${root}/poll/?id=${pollid}'>${ml(config, "poll.pollnum", { num: pollid })}</a></b>`;
    if (text(poll.name)) html += ` <i>${cleanPoll(text(poll.name))}</i>\n`;
    html += "</div><div class='poll-status'>";
    if (closed) {
        html += `<span style='font-family: monospace; font-weight: bold; font-size: 1.2em;'>${ml(config, "poll.isclosed")}</span><br />\n`;
    }
    if (isanon === "yes") html += `${ml(config, "poll.isanonymous2")}<br />\n`;
    html += ml(config, "poll.security2", {
        whovote: ml(config, `poll.security.whovote.${whovote}`), whoview: ml(config, `poll.security.whoview.${whoview}`),
    });
    html += ml(config, "poll.participants", { total: int(participants?.n) }) + "</div>";
    if (canView && isanon !== "yes") {
        html += `<br /><div class='respondents'><a href='${root}/poll/?id=${pollid}&amp;mode=ans_extended' class='LJ_PollRespondentsLink' ` +
            `id='LJ_PollRespondentsLink_${pollid}' lj_pollid='${pollid}' >${ml(config, "poll.viewrespondents")}</a></div><br />`;
    }

    const bar = (fraction: number) => `<div style="width: ${(100 * fraction).toFixed(1)}%; min-width: 10px; height: 10px; ` +
        "box-sizing: border-box; background-color: #e00; background: linear-gradient(to bottom, #300, #900 20%, #e00 80%, #f00); " +
        'border: 1px solid #333; border-radius: 5px; "> </div>';
    for (const q of questions.sort((a, b) => int(a.sortorder) - int(b.sortorder))) {
        const qid = int(q.pollqid), type = text(q.type);
        html += `<div class='poll-inquiry'><p>${cleanPoll(text(q.qtext))}</p>`;
        html += "<div style='margin: 10px 0 10px 5%;' class='poll-response'>";
        if (canView) {
            html += `
                <a href='${root}/poll/?id=${pollid}&amp;qid=${qid}&amp;mode=ans'
                     class='LJ_PollAnswerLink' lj_pollid='${pollid}' lj_qid='${qid}' lj_posterid='${int(poll.posterid)}' lj_page='0' lj_pagesize="${pagesize}"
                     id="LJ_PollAnswerLink_${pollid}_${qid}">
                ${ml(config, "poll.viewanswers")}</a><br />`;
        }
        if (type === "text") {
            html += "</div></div>";
            continue;
        }
        const votes = new Map<string, number>();
        let voted = 0;
        for (const result of results.filter(row => int(row.pollqid) === qid)) {
            voted++;
            for (const value of type === "check" ? text(result.value).split(",") : [text(result.value)]) {
                votes.set(value, (votes.get(value) ?? 0) + 1);
            }
        }
        const maxVotes = Math.max(1, ...votes.values());

        let entries = items.filter(row => int(row.pollqid) === qid).sort((a, b) => int(a.sortorder) - int(b.sortorder))
            .map(row => [String(int(row.pollitid)), text(row.item)] as [string, string]);
        const table = type === "scale";
        if (table) {
            const values = results.filter(row => int(row.pollqid) === qid).map(row => Number(text(row.value)))
                .sort((a, b) => a - b);
            const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
            const stddev = values.length ? Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) : 0;
            const mid = Math.trunc((values.length + 1) / 2);
            const median = values.length === 1 ? values[0]!
                : values.length > 1 ? (values.length % 2 ? values[mid - 1]! : (values[mid - 1]! + values[mid]!) / 2) : 0;
            html += ml(config, "poll.scaleanswers", {
                mean: mean.toFixed(2), median: perlNumber(median), stddev: stddev.toFixed(2),
            }) + "<br />\n<table style='width: 100%; box-sizing: border-box;'>";
            const [from, to, byText, low, high] = text(q.opts).split("/");
            const by = Number(byText) > 0 && Number.isInteger(Number(byText)) ? Number(byText) : 1;
            entries = [[String(from), `${low ?? ""} ${from}`]];
            for (let at = Number(from) + by; at <= Number(to) - by; at += by) entries.push([String(at), String(at)]);
            entries.push([String(to), `${high ?? ""} ${to}`]);
        }
        for (const [itid, itemText] of entries) {
            const item = cleanPoll(itemText);
            const count = votes.get(itid) ?? 0;
            const label = `<b>${count}</b> (${(100 * count / (voted || 1)).toFixed(1)}%) `;
            html += table
                ? `<tr style='vertical-align: middle;'><th scope='row' style='text-align: right; white-space: nowrap;'>${item}</th>` +
                    `<td style='width: 100%;'>${bar(count / maxVotes)}</td><td style='text-align: left; white-space: nowrap;'>${label}</td></tr>`
                : `<p style='margin-bottom: 5px;'>${item}<br>${label}</p>${bar(count / maxVotes)}`;
        }
        if (table) html += "</table>";
        html += "</div></div>";
    }
    return html + "</div>";
}
