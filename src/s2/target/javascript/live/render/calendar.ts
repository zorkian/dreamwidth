// calendar.ts
//
// Source-derived preparation for the bounded stock S2 page.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// Inherited ports: cgi-bin/LJ/S2/YearPage.pm YearMonth and LJ/S2.pm get_latest_month.
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


import type { RenderInput } from "./types";
import { date, object, S2Object } from "./objects";

export function calendar(input: RenderInput, base: string, monday: boolean): S2Object {
    const counts = new Map<string, number>();
    for (const entry of input.journal.entries) {
        const key = `${entry.year}-${entry.month}-${entry.day}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const now = new Date(input.nowSeconds * 1000);
    const years = [...new Set(input.journal.entries.map(e => e.year))]
        .filter(y => y <= now.getUTCFullYear()).sort((a, b) => a - b);
    const year = years.at(-1) ?? now.getUTCFullYear();
    const months = [...new Set(input.journal.entries.filter(e => e.year === year).map(e => e.month))]
        .filter(m => year < now.getUTCFullYear() || m <= now.getUTCMonth() + 1).sort((a, b) => a - b);
    // Retained get_latest_month assigns undef (numeric0), not the current
    // month, when the newest eligible year contains only future months.
    const month = years.length ? months.at(-1) ?? 0 : now.getUTCMonth() + 1;
    const pad = (n: number) => String(n).padStart(2, "0");
    const weeks: S2Object[] = [];
    let week: S2Object | undefined;
    const days = month ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
    for (let day = 1; day <= days; day++) {
        const d = date(`${year}-${pad(month)}-${pad(day)} 00:00:00`);
        if (!week) {
            week = object("YearWeek", {pre_empty: monday ? (d._dayofweek + 5) % 7 : d._dayofweek - 1,
                post_empty: 0, days: []});
            weeks.push(week);
        }
        const count = counts.get(`${year}-${month}-${day}`) ?? 0;
        const item = object("YearDay", {day, date: d, num_entries: count,
            url: count ? `${base}/${year}/${pad(month)}/${pad(day)}/` : ""});
        week.days.push(item);
        if (week.pre_empty + week.days.length === 7) week = undefined;
    }
    if (week) week.post_empty = 7 - week.pre_empty - week.days.length;
    const result = object("YearMonth", {year, month, weeks,
        url: `${base}/${year}/${pad(month)}/`,
        has_entries: input.journal.entries.some(e => e.year === year && e.month === month) ? 1 : 0});
    const before = input.journal.entries.filter(e => e.year <= year && e.month < month)
        .sort((a, b) => b.year * 12 + b.month - a.year * 12 - a.month)[0];
    const after = input.journal.entries.filter(e => e.year >= year && e.month > month)
        .sort((a, b) => a.year * 12 + a.month - b.year * 12 - b.month)[0];
    for (const [key, entry] of [["prev", before], ["next", after]] as const) {
        if (entry) {
            result[`_${key}_url`] = `${base}/${entry.year}/${pad(entry.month)}/`;
            result[`_${key}_date`] = object("Date", {year: entry.year, month: entry.month, day: 0});
        }
    }
    return result;
}
