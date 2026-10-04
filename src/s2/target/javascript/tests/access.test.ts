// access.test.ts
//
// Who the viewer is and what they may see, for the fixture journals from
// tools/seed-fixtures.pl.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import { interstitialType } from "../data/adult-content";
import { int, text } from "../data/db";
import { Entry } from "../data/entry";
import { Session } from "../data/session";
import { User } from "../data/user";
import { currentSecret } from "../render/reply-page";
import { prepare } from "../server/app";
import type { SiteConfig } from "../server/config";
import { HOST, TestJournals } from "./journal";

let journals: TestJournals;
before(() => { journals = new TestJournals(); });
after(() => journals.close());

const user = async (name: string) => (await User.byName(journals.db, `s2fix_acc_${name}`))!;
const entry = async (journal: User, subject: string) =>
    (await Entry.byDitemid(journals.db, journal, await journals.ditemid(journal.user, subject)))!;
const dtalkid = async (journal: User, body: string, on: Entry) => {
    const [row] = await journal.cluster(journals.db, `SELECT t.jtalkid FROM talk2 t
        JOIN talktext2 x USING (journalid, jtalkid) WHERE t.journalid = ? AND x.body = ?`, [journal.userid, body]);
    return (int(row!.jtalkid) << 8) + on.anum;
};

test("who may see each entry and comment", async () => {
    const db = journals.db;
    const viewers: Record<string, User | null> = { anonymous: null };
    // The trusted user also administers the community; the poster is a member
    // who wrote its entries.
    for (const name of ["stranger", "trusted", "filter", "poster", "owner", "minor"]) viewers[name] = await user(name);
    const owner = viewers.owner!, comm = await user("comm");
    const sees = async (item: Entry, ...names: string[]) => {
        for (const [name, viewer] of Object.entries(viewers)) {
            assert.equal(await item.visibleTo(db, viewer), names.includes(name),
                `${item.journal.user} ${item.ditemid}: ${name}`);
        }
    };
    const everyone = Object.keys(viewers);
    await sees(await entry(owner, "Access public"), ...everyone);
    await sees(await entry(owner, "Access private"), "owner");
    await sees(await entry(owner, "Access locked"), "owner", "trusted", "filter");
    await sees(await entry(owner, "Access filtered"), "owner", "filter");
    await sees(await entry(comm, "Community public"), ...everyone);
    await sees(await entry(comm, "Community members"), "trusted", "poster");
    await sees(await entry(comm, "Community private"), "trusted");

    // Everyone may see the explicit entry, but a minor is stopped before it.
    const explicit = await entry(owner, "Access explicit");
    await sees(explicit, ...everyone);
    const gate = (viewer: User | null) =>
        interstitialType(db, journals.config, { user: viewer, journal: owner, entry: explicit });
    assert.equal(await gate(viewers.minor!), "explicit_blocked");
    assert.equal(await gate(null), "explicit");
    assert.equal(await gate(owner), undefined);

    const comments = async (journal: User, item: Entry, body: string, ...names: string[]) => {
        const id = await dtalkid(journal, body, item);
        for (const [name, viewer] of Object.entries(viewers)) {
            assert.equal(!!await item.visibleComment(db, id, viewer), names.includes(name), `${body}: ${name}`);
        }
    };
    const publicEntry = await entry(owner, "Access public");
    await comments(owner, publicEntry, "Access screened comment", "owner", "stranger");
    await comments(owner, publicEntry, "Access deleted comment");
    await comments(owner, publicEntry, "Access suspended comment");
    await comments(comm, await entry(comm, "Community public"), "Community screened comment",
        "trusted", "poster", "stranger");
});

// A session row for the user, from the fixtures: live or expired.
async function sessionRow(u: User, live: boolean) {
    const [row] = await u.cluster(journals.db, `SELECT sessid, auth FROM sessions WHERE userid = ?
        AND (timeexpire > UNIX_TIMESTAMP()) = ? ORDER BY sessid DESC LIMIT 1`, [u.userid, live ? 1 : 0]);
    return { sessid: int(row!.sessid), auth: text(row!.auth) };
}
const masterCookie = (u: User, row: { sessid: number; auth: string }) =>
    `ljmastersession=v1:u${u.userid}:s${row.sessid}:a${row.auth}//; ljloggedin=u${u.userid}:s${row.sessid}`;

test("sessions, from the master and journal domain cookies", async () => {
    const db = journals.db, config = journals.config;
    const find = (cookie: string, remoteIp?: string, site: SiteConfig = config, host = HOST) =>
        Session.fromCookies(db, site, { host, path: "/", cookie, remoteIp });

    const trusted = await user("trusted");
    const live = await sessionRow(trusted, true);
    assert.equal((await find(masterCookie(trusted, live), "127.0.0.1"))?.remote()?.userid, trusted.userid);
    assert.equal(await find(masterCookie(trusted, { ...live, auth: "x".repeat(10) }), "127.0.0.1"), null);

    const stranger = await user("stranger");
    assert.equal(await find(masterCookie(stranger, await sessionRow(stranger, false)), "127.0.0.1"), null);

    // A session bound to 10.9.8.7.
    const filter = await user("filter");
    const fixed = masterCookie(filter, await sessionRow(filter, true));
    assert.equal(await find(fixed, "10.1.1.1"), null);
    assert.equal((await find(fixed, "10.9.8.7"))?.remote()?.userid, filter.userid);
    const unchecked = await find(fixed, undefined);
    assert.ok(unchecked);
    assert.equal(unchecked.remote(), null);

    // Perl does not log a suspended account out.
    const susp = await user("susp");
    assert.equal((await find(masterCookie(susp, await sessionRow(susp, true)), "127.0.0.1"))?.remote()?.userid, susp.userid);

    // On a journal's own subdomain the session comes from a cookie signed for
    // that journal; one signed for another journal is refused.
    const site: SiteConfig = {
        ...config, domain: "example.test", domainWeb: "www.example.test", userDomain: "example.test",
    };
    const { stime, secret } = await currentSecret(db);
    const domain = (name: string) => {
        const sig = createHmac("sha1", secret)
            .update([live.auth, name, trusted.userid, live.sessid, stime].join("-")).digest("hex");
        return `ljdomsess.s2fix-acc-owner=v1:u${trusted.userid}:s${live.sessid}:t${stime}:g${sig}//; ` +
            `ljloggedin=u${trusted.userid}:s${live.sessid}`;
    };
    const host = "s2fix-acc-owner.example.test";
    assert.equal((await find(domain("ljdomsess.s2fix-acc-owner"), "127.0.0.1", site, host))?.remote()?.userid,
        trusted.userid);
    assert.equal(await find(domain("ljdomsess.s2fix-acc-filter"), "127.0.0.1", site, host), null);
    // The master cookie does not log a journal subdomain in.
    assert.equal(await find(masterCookie(trusted, live), "127.0.0.1", site, host), null);
});

test("a logged-in viewer's page is left to Perl", async () => {
    const trusted = await user("trusted");
    const url = "/~s2fix_acc_owner/";
    const visit = (cookie: string) =>
        prepare(journals.config, journals.db, journals.compiler, url, HOST, { uniq: "", cookie, remoteIp: "127.0.0.1" });
    const loggedIn = await visit(masterCookie(trusted, await sessionRow(trusted, true)));
    assert.ok("status" in loggedIn && loggedIn.status === 501);
    const stranger = await user("stranger");
    assert.ok("layers" in await visit(masterCookie(stranger, await sessionRow(stranger, false))));
});

test("an account with a second factor is logged in only by a session that has proven it", async () => {
    const totp = (await User.byName(journals.db, "s2fix_acc_totp"))!;
    const rows = await totp.cluster(journals.db, `SELECT s.sessid, s.auth, m.expires > UNIX_TIMESTAMP() AS proven
        FROM sessions s LEFT JOIN mfa_sessions m USING (userid, sessid)
        WHERE s.userid = ? AND s.timeexpire > UNIX_TIMESTAMP() ORDER BY s.sessid`, [totp.userid]);
    const visit = async (row: typeof rows[number]) => prepare(journals.config, journals.db, journals.compiler,
        "/~s2fix_acc_owner/", HOST, { uniq: "", remoteIp: "127.0.0.1",
            cookie: masterCookie(totp, { sessid: int(row.sessid), auth: text(row.auth) }) });
    const proven = rows.filter(row => row.proven !== null && int(row.proven) === 1);
    const unproven = rows.filter(row => row.proven === null || int(row.proven) === 0);
    // One proof still current; one that has expired and one never made.
    assert.equal(proven.length, 1);
    assert.equal(unproven.length, 2);
    const loggedIn = await visit(proven[0]!);
    assert.ok("status" in loggedIn && loggedIn.status === 501);
    for (const row of unproven) assert.ok("layers" in await visit(row), `session ${int(row.sessid)}`);
});
