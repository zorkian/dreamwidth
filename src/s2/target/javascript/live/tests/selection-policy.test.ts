// selection-policy.test.ts
//
// Selected public data and source capability/URL policy adversaries.
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

import assert from "node:assert/strict";
import test from "node:test";
import type {RawJournalSnapshot, RawEntry, PublicAppConfig} from "../contracts";
import {approveSnapshot, canonicalUsername, journalBase} from "../policy/cohort";
import {approveEntrySnapshot} from "../policy/entry";
import {Unsupported} from "../policy/content";
import {snapshot, selectFixture, config, capabilities} from "./fixtures";

const approve = (data: RawJournalSnapshot, app = config) => approveSnapshot(data, app, capabilities);
const entry = (data: RawJournalSnapshot, id: number) => approveEntrySnapshot(data, id, config, capabilities);
function owner(data: RawJournalSnapshot, changes: Partial<RawJournalSnapshot["owner"]>): RawJournalSnapshot {
    const next = {...data.owner, ...changes};
    return {...data, owner: next, posters: [next], request: {...data.request, username: next.user}};
}
function history(): RawEntry[] {
    const template = snapshot().entries[0]!;
    return Array.from({length: 300}, (_, index) => {
        const stamp = new Date(Date.UTC(2026, 8, 24, 12) - index * 60000).toISOString().slice(0,19).replace("T"," ");
        return {...template, jitemid: index + 1, eventtime: stamp, logtime: stamp,
            revttime: 2147483647 - Date.parse(stamp.replace(" ","T") + "Z") / 1000,
            security: index % 3 === 0 ? "private" : "public",
            eventText: index % 3 === 0 ? `PRIVATE_${index}` : `<p>public ${index}</p>`};
    });
}

test("nonmarker journals/cluster/caps/storage version and default style keep real feature checks", () => {
    const data = snapshot();
    for (const user of ["ordinary", "7journal", "_journal"]) {
        const changed = owner(data, {user, clusterid: 19, caps: "16", dversion: 8});
        const approved = approve(changed);
        assert.equal(approved.username, user);
        assert.equal(approved.baseUrl, `http://localhost:8080/~${user}`);
        assert.equal(approved.entries.length, 2);
        assert.deepEqual(approve({...changed, style: {...changed.style!, name: "Unmarked personal style"}}).entries,
            approved.entries);
    }
    const defaultStyle = owner(data, {publicSettings: {...data.owner.publicSettings, stylesys: null, s2_style: null}});
    assert.equal(approve({...defaultStyle, style: {...data.style!, origin: "default", styleid: 0,
        ownerid: null, name: "informational only"}}).styleid, 0);
    for (const change of [{status: "D"}, {statusvis: "S"}, {statusvis: "D"}, {statusvis: "X"},
        {clusterid: 0}, {journaltype: "C"}, {caps: "32768"}, {caps: "65536"}]) {
        assert.throws(() => approve(owner(data, change)), Unsupported);
    }
    assert.equal(approve(owner(data, {defaultpicid: 1})).defaultUserpic?.picid, 1);
    for (const field of ["usertags", "logkwsum", "links"]) {
        assert.throws(() => approve({...data, features: {...data.features, [field]: 1}}), Unsupported);
    }
    for (const field of ["logtags", "logtagsrecent", "comments"]) {
        // Associations outside the selected public body set remain count-only.
        assert.doesNotThrow(() => approve({...data,features:{...data.features,[field]:1}}));
    }
    assert.throws(() => approve({...data, style: {...data.style!, layers: data.style!.layers.map(layer =>
        ({...layer, sourceHash: "0".repeat(64)}))}}), Unsupported);
    assert.throws(() => approve({...data, request: {...data.request, username: "renamed"}}), Unsupported);
});

test("public-before-LIMIT windows at79/80/81/200 and >200 history never double-skip", () => {
    const data = {...snapshot(), entries: history()};
    const expected = Array.from({length: 30}, (_, i) => 120 + i).filter(id => id % 3 !== 1);
    assert.equal(expected.length, 20);
    for (const skip of [79, 80, 81, 200, Number.MAX_SAFE_INTEGER]) {
        const selected = selectFixture(data, {kind: "recent", skip, itemshow: 20});
        assert.equal(selected.selection.kind, "recent");
        if (selected.selection.kind !== "recent") throw new Error("fixture selection");
        const selection = selected.selection;
        assert.equal(selected.selection.pageSkip, Math.min(skip, 80));
        assert.equal(selected.selection.loadSkip, 79);
        assert.equal(selected.selection.window.length, 21);
        assert.equal(selected.entries.length, 20);
        assert.deepEqual(selected.selection.selectedJitemids, expected);
        const approved = approve(selected);
        assert.deepEqual(approved.entries.map(row => Math.floor(row.id / 256)), expected);
        assert.ok(!JSON.stringify(approved).includes("PRIVATE_"));
        assert.throws(() => approve({...selected, selection: {...selection, loadSkip: 80}}), Unsupported);
    }
    const oldId = 300 * 256 + 128;
    const oldEntry = selectFixture(data, {kind: "entry", ditemid: oldId});
    assert.equal(oldEntry.entries.length, 1);
    assert.equal(entry(oldEntry, oldId)?.entries[0]!.id, oldId);
    assert.ok(!approve(selectFixture(data)).entries.some(row => row.id === oldId));
});

test("equal-full-time reorder occurs after the21-row SQL window and then lookahead removal", () => {
    const data = snapshot();
    const rows = Array.from({length: 30}, (_, index) => ({...data.entries[0]!, jitemid: index + 1}));
    const selected = selectFixture({...data, entries: rows});
    assert.equal(selected.selection.kind, "recent");
    if (selected.selection.kind !== "recent") throw new Error("fixture selection");
    const selection = selected.selection;
    assert.deepEqual(selected.selection.window.map(row => row.jitemid), Array.from({length:21}, (_, i) => i+1));
    const expected = Array.from({length:20}, (_, i) => 21-i);
    assert.deepEqual(approve(selected).entries.map(row => Math.floor(row.id/256)), expected);
    const extra = {...selected, entries: [...selected.entries, rows[0]!]};
    assert.throws(() => approve(extra), Unsupported);
    assert.throws(() => approve({...selected, selection: {...selection,
        selectedJitemids: [...expected].reverse()}}), Unsupported);
    assert.throws(() => approve({...selected, selection: {...selection,
        window: [...selection.window].reverse()}}), Unsupported);
});

test("private/missing-anum selection returns404 before body inspection and cohort failure", () => {
    const data = snapshot({kind: "entry", ditemid: 384});
    assert.equal(data.selection.kind, "entry");
    if (data.selection.kind !== "entry") throw new Error("fixture selection");
    const selection = data.selection;
    let touched = 0;
    const poison = {...data.entries[0]!};
    Object.defineProperty(poison, "eventText", {get() {touched++; throw new Error("PRIVATE");}});
    for (const security of ["private", "usemask"]) {
        const privateData: RawJournalSnapshot = {...data, owner: {...data.owner, statusvis: "S"}, entries: [poison],
            selection: {...selection, target: {...selection.target, security}}};
        assert.equal(entry(privateData, 384), null);
    }
    assert.equal(entry({...data, selection: {...selection, target: {...selection.target, anum: 129}}}, 384), null);
    assert.equal(touched, 0);
    assert.throws(() => entry({...data, selection: {...selection,
        target: {...selection.target, journalid: 90}}}, 384), Unsupported);
    assert.throws(() => entry({...data, entries: [{...data.entries[0]!, journalid: 90}]}, 384), Unsupported);
    assert.throws(() => entry({...data, entries: []}, 384), Unsupported);
    const recent = snapshot();
    const privateBody = {...recent.entries[0]!, security: "private"};
    Object.defineProperty(privateBody, "eventText", {get() {touched++; throw new Error("PRIVATE");}});
    assert.throws(() => approve({...recent, entries: [privateBody, recent.entries[1]!]}), Unsupported);
    assert.equal(touched, 0);
});

test("only selected bodies and shown calendar facts enforce entry visibility", () => {
    const data = snapshot();
    assert.throws(() => approve({...data, entries: [{...data.entries[0]!,
        props: {...data.entries[0]!.props, statusvis: "S"}}, data.entries[1]!]}), Unsupported);
    for (const statusvis of ["S", "D", "X", "unknown"]) {
        assert.throws(() => approve({...data, calendar: {...data.calendar,
            entryStatusCounts: [{statusvis, count: 1}]}}), Unsupported);
    }
    assert.throws(() => approve({...data, calendar: {...data.calendar, otherPosterCount: 1}}), Unsupported);
    // No body/history count is carried to policy. An unselected old suspended
    // entry outside shown calendar witnesses is not a new whole-history gate.
    const many = history();
    many[299] = {...many[299]!, props: {...many[299]!.props, statusvis: "S"}};
    assert.equal(approve(selectFixture({...data, entries: many})).entries.length, 20);
    const moreDays = {...data, calendar: {...data.calendar, days: [{day:24,count:100001}],
        entryStatusCounts: [{statusvis:null,count:100001}]}};
    assert.equal(approve(moreDays).calendar.days[0]!.count, 100001);
});

test("Entry capability and fallback preference are source-driven; Recent is unaffected", () => {
    const recent = snapshot(), selected = snapshot({kind:"entry",ditemid:384});
    const off = {...capabilities, s2ViewEntry:{defaultValue:0,byBit:[],hookConfigured:false}};
    assert.equal(approveSnapshot(recent,config,off).entries.length,2);
    assert.throws(()=>approveEntrySnapshot(selected,384,config,off),Unsupported);
    const bit = {...off,s2ViewEntry:{...off.s2ViewEntry,byBit:[{bit:1,value:1},{bit:3,value:0}]}};
    assert.equal(approveEntrySnapshot(selected,384,config,bit)?.entries.length,1);
    const hidden = owner(selected,{publicSettings:{...selected.owner.publicSettings,use_journalstyle_entry_page:"N"}});
    assert.throws(()=>entry(hidden,384),Unsupported);
    assert.equal(approve(owner(recent,{publicSettings:{...recent.owner.publicSettings,
        use_journalstyle_entry_page:"N", opt_show_captcha_to:"all"}})).entries.length,2);
    assert.throws(()=>entry({...selected,features:{...selected.features,spamreportBans:1}},384),Unsupported);
    assert.equal(approve({...recent,features:{...recent.features,spamreportBans:1}}).entries.length,2);
});

test("canonical source journal URLs use configured rules without request Host synthesis", () => {
    const app: PublicAppConfig = {...config,journalUrls:{protocol:"https",domain:"example.test",isDevServer:false,
        hookConfigured:false,subdomainRules:{P:[true,"users.example.test/users"]}}};
    assert.equal(journalBase("my_journal",app),"https://my-journal.example.test");
    assert.equal(journalBase("_journal",app),"https://users.example.test/users/_journal");
    assert.equal(journalBase("journal_",app),"https://users.example.test/users/journal_");
    assert.equal(canonicalUsername("7-Name",25),"7_name");
    assert.equal(canonicalUsername("ordinary",30),"ordinary");
    assert.equal(canonicalUsername("a".repeat(26),30),null);
    for (const value of ["", "a/b", "a?b", "é", "a".repeat(26)]) assert.equal(canonicalUsername(value,25),null);
    assert.throws(()=>journalBase("ordinary",{...app,journalUrls:{...app.journalUrls,hookConfigured:true}}),Unsupported);
});

// LogItems S2 DATE_FORMAT includes seconds. Its old per-minute comment must
// not merge adjacent distinct civil seconds before the itemid reorder.
test("distinct seconds within a minute retain their SQL order", () => {
    const data = snapshot();
    const rows = [2, 1, 0].map((seconds, index) => ({...data.entries[0]!, jitemid: index + 1,
        eventtime: `2026-09-24 11:00:0${seconds}`, logtime: `2026-09-24 11:00:0${seconds}`,
        revttime: data.entries[0]!.revttime - seconds}));
    const selected = selectFixture({...data, entries: rows});
    assert.deepEqual(approve(selected).entries.map(row => Math.floor(row.id / 256)), [1, 2, 3]);
    if (selected.selection.kind !== "recent") throw new Error("fixture selection");
    const selection = selected.selection;
    assert.throws(() => approve({...selected, selection: {...selection,
        selectedJitemids: [3, 2, 1]}}), Unsupported);
});

test("calendar neighbors preserve native independent year and month filters", () => {
    const data = snapshot();
    const withMonth = (year: number, month: number) => ({...data, calendar: {...data.calendar,
        current: {year, month}, days: month === 0 ? [] : data.calendar.days}});
    const january = withMonth(2026, 1);
    assert.equal(approve(january).calendar.previous, null);
    assert.throws(() => approve({...january, calendar: {...january.calendar,
        previous: {year: 2025, month: 12}}}), Unsupported);
    const december = withMonth(2025, 12);
    assert.equal(approve(december).calendar.next, null);
    assert.throws(() => approve({...december, calendar: {...december.calendar,
        next: {year: 2026, month: 1}}}), Unsupported);
    const september = withMonth(2026, 9);
    assert.deepEqual(approve({...september, calendar: {...september.calendar,
        previous: {year: 2025, month: 3}, next: {year: 2027, month: 10}}}).calendar.previous,
        {year: 2025, month: 3});
    for (const previous of [{year: 2025, month: 12}, {year: 2026, month: 9}, {year: 2027, month: 3}]) {
        assert.throws(() => approve({...september, calendar: {...september.calendar, previous}}), Unsupported);
    }
    for (const next of [{year: 2027, month: 2}, {year: 2026, month: 9}, {year: 2025, month: 10}]) {
        assert.throws(() => approve({...september, calendar: {...september.calendar, next}}), Unsupported);
    }
    const zero = withMonth(2026, 0);
    assert.equal(approve(zero).calendar.previous, null);
    assert.throws(() => approve({...zero, calendar: {...zero.calendar,
        previous: {year: 2025, month: 12}}}), Unsupported);
});
