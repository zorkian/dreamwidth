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
    // Calendar contributors are independent of the selected body window.
    // Policy has qualified the bounded public aggregates and witnesses.
    const summary = input.journal.calendar;
    const {year, month} = summary;
    const counts = new Map(summary.days.map(item => [item.day, item.count]));
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
        const count = counts.get(day) ?? 0;
        const item = object("YearDay", {day, date: d, num_entries: count,
            url: count ? `${base}/${year}/${pad(month)}/${pad(day)}/` : ""});
        week.days.push(item);
        if (week.pre_empty + week.days.length === 7) week = undefined;
    }
    if (week) week.post_empty = 7 - week.pre_empty - week.days.length;
    const result = object("YearMonth", {year, month, weeks,
        url: `${base}/${year}/${pad(month)}/`,
        has_entries: summary.days.some(item => item.count > 0) ? 1 : 0});
    const before = summary.previous;
    const after = summary.next;
    for (const [key, entry] of [["prev", before], ["next", after]] as const) {
        if (entry) {
            result[`_${key}_url`] = `${base}/${entry.year}/${pad(entry.month)}/`;
            result[`_${key}_date`] = object("Date", {year: entry.year, month: entry.month, day: 0});
        }
    }
    return result;
}
