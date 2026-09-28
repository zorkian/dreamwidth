// archive-pages.ts
//
// Build the S2 pages for the journal archive, following LJ::S2::YearPage,
// LJ::S2::MonthPage and LJ::S2::DayPage.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { Entry, truthy } from "../data/entry";
import { type S2Object, S2Date, nullObject, s2 } from "./objects";
import { journalScripts } from "./resources";
import {
    type DayCounts, type PageContext, Page, YearMonth, cutTagScript, entryObjects, journalDefaultPic, robotMetaTags,
} from "./pages";

// A page, or the errors LJ::S2::make_journal lists instead.
export type ArchivePage = S2Object | { errors: string[] };

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

// LJ::S2::YearPage
export async function YearPage(pc: PageContext, counts: DayCounts, pathextra: string | undefined): Promise<S2Object> {
    const { journal, site, args } = pc;
    const page = await Page(pc, "archive", await journalDefaultPic(pc));
    page[".type"] = "YearPage";
    let head = page._head_content;
    if (journal.shouldBlockRobots(site.config)) head += robotMetaTags();
    head += '<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />\n';

    const years = [...counts.keys()].sort((a, b) => a - b);
    // A ?year= argument sends Perl to the default year all the same.
    let year = 0;
    const fromPath = /^\/(\d\d\d\d)\/?\b/.exec(pathextra ?? "");
    if (!truthy(args.year) && fromPath) {
        year = Number(fromPath[1]);
    } else {
        const current = new globalThis.Date(pc.nowSeconds * 1000).getUTCFullYear();
        for (const y of years) if (y <= current) year = y;
        year ||= years[0] ?? current;
    }

    page._year = year;
    page._years = years.map(y => s2("YearYear", { year: y, url: `${page._base_url}/${y}/`, displayed: y === year ? 1 : 0 }));
    const shown = Math.max(0, years.indexOf(year));
    if (shown > 0) head += `<link rel="prev" href="${page._years[shown - 1]._url}" />\n`;
    if (shown < years.length - 1) head += `<link rel="next" href="${page._years[shown + 1]._url}" />\n`;
    page._months = Array.from({ length: 12 }, (_, i) => YearMonth(pc, counts, year, i + 1));
    page._head_content = head;
    return page;
}

// LJ::S2::MonthPage
export async function MonthPage(pc: PageContext, counts: DayCounts, pathextra: string | undefined): Promise<ArchivePage> {
    const { journal, site, db } = pc;
    const page = await Page(pc, "month", await journalDefaultPic(pc));
    page[".type"] = "MonthPage";
    page._days = [];
    page._timeformat24 = 0;
    let head = page._head_content;
    if (journal.shouldBlockRobots(site.config)) head += robotMetaTags();

    const match = /^\/(\d\d\d\d)\/(\d\d)\b/.exec(pathextra ?? "");
    const [year, month] = match ? [Number(match[1]), Number(match[2])] : [0, 0];
    const errors: string[] = [];
    if (month < 1 || month > 12) errors.push(`Invalid month: ${match?.[2] ?? ""}`);
    if (year < 1970 || year > 2038) errors.push(`Invalid year: ${match?.[1] ?? ""}`);
    if (errors.length) return { errors };
    page._date = S2Date(year, month, 0);

    const entries = await Entry.inMonth(db, journal, year, month);
    await Entry.fill(db, journal, entries);
    const objects = await entryObjects(pc, entries, "month");
    const byDay = new Map<number, S2Object[]>();
    for (const [index, entry] of entries.entries()) {
        const poster = pc.users.get(entry.posterid);
        if (!poster || poster.statusvis === "S" || entry.isSuspended()) continue;
        const day = Number(entry.alldatepart.slice(8, 10));
        byDay.set(day, [...byDay.get(day) ?? [], objects[index]!]);
    }
    const length = new globalThis.Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 1; day <= length; day++) {
        const list = byDay.get(day) ?? [];
        page._days.push(s2("MonthDay", {
            date: S2Date(year, month, day), day, has_entries: list.length > 0 ? 1 : "", num_entries: list.length,
            url: `${page._base_url}/${pad(year, 4)}/${pad(month)}/${pad(day)}/`, entries: list,
        }));
    }
    page._redir = s2("Redirector", { user: journal.user, vhost: "users", type: "monthview", url: `${site.config.siteRoot}/go` });

    const now = year * 12 + month;
    page._months = [];
    for (const [y, months] of counts) {
        for (const m of months.keys()) {
            const date = S2Date(y, m, 0);
            const url = `${page._base_url}/${pad(y, 4)}/${pad(m)}/`;
            page._months.push(s2("MonthEntryInfo", { date, url, redir_key: `${pad(y, 4)}${pad(m)}` }));
            const value = y * 12 + m;
            if (value < now) Object.assign(page, { _prev_url: url, _prev_date: date });
            if (value > now && !page._next_date) Object.assign(page, { _next_url: url, _next_date: date });
        }
    }
    if (page._prev_url) head += `<link rel="prev" href="${page._prev_url}" />\n`;
    if (page._next_url) head += `<link rel="next" href="${page._next_url}" />\n`;
    page._head_content = head;
    return page;
}

// LJ::S2::DayPage
export async function DayPage(pc: PageContext, counts: DayCounts, pathextra: string | undefined): Promise<ArchivePage> {
    const { journal, site, db, args } = pc;
    const page = await Page(pc, "day", await journalDefaultPic(pc));
    page[".type"] = "DayPage";
    page._entries = [];
    let head = page._head_content;
    if (journal.shouldBlockRobots(site.config)) head += robotMetaTags();
    journalScripts(pc.resources, { lastn: true });
    head += cutTagScript(pc);

    const match = /^\/(\d\d\d\d)\/(\d\d)\/(\d\d)\b/.exec(pathextra ?? "");
    const [yearText, monthText, dayText] = match ? [match[1]!, match[2]!, match[3]!]
        : [args.year ?? "", args.month ?? "", args.day ?? ""];
    const [year, month, day] = [Number(yearText), Number(monthText), Number(dayText)];
    const errors: string[] = [];
    if (!/^\d+$/.test(yearText)) errors.push("Corrupt or non-existant year.");
    if (!/^\d+$/.test(monthText)) errors.push("Corrupt or non-existant month.");
    if (!/^\d+$/.test(dayText)) errors.push("Corrupt or non-existant day.");
    if (!(month >= 1 && month <= 12)) errors.push("Invalid month.");
    if (!(year >= 1970 && year <= 2038)) errors.push(`Invalid year: ${yearText}`);
    if (!(day >= 1 && day <= 31)) errors.push("Invalid day.");
    if (!errors.length && day > new globalThis.Date(Date.UTC(year, month, 0)).getUTCDate()) {
        errors.push("That month doesn't have that many days.");
    }
    if (errors.length) return { errors };
    page._date = S2Date(year, month, day);

    const entries = await Entry.onDay(db, journal, year, month, day);
    await Entry.fill(db, journal, entries);
    const objects = await entryObjects(pc, entries, "recent");
    page._entries = objects.filter((_, index) => {
        const poster = pc.users.get(entries[index]!.posterid);
        return poster?.statusvis !== "S" && !entries[index]!.isSuspended();
    });
    if (page._entries.length) {
        page._has_entries = 1;
        page._entries[0]._new_day = 1;
        page._entries.at(-1)._end_day = 1;
    }

    const here = year * 10000 + month * 100 + day;
    let prev: number | undefined, next: number | undefined;
    for (const [y, months] of counts) {
        for (const [m, days] of months) {
            for (const d of days.keys()) {
                const value = y * 10000 + m * 100 + d;
                if (value < here && (!prev || value > prev)) prev = value;
                else if (value > here && (!next || value < next)) next = value;
            }
        }
    }
    const nearby = (value: number | undefined) => value === undefined
        ? { url: "", date: nullObject("Date") }
        : {
            url: `${page._base_url}/${pad(Math.floor(value / 10000), 4)}/${pad(Math.floor(value / 100) % 100)}/${pad(value % 100)}`,
            date: S2Date(Math.floor(value / 10000), Math.floor(value / 100) % 100, value % 100),
        };
    const [before, after] = [nearby(prev), nearby(next)];
    Object.assign(page, { _prev_url: before.url, _prev_date: before.date, _next_url: after.url, _next_date: after.date });
    if (before.url) head += `<link rel="prev" href="${before.url}" />\n`;
    if (after.url) head += `<link rel="next" href="${after.url}" />\n`;
    page._head_content = head;
    return page;
}
