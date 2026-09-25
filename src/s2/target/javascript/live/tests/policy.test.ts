// policy.test.ts
//
// Focused adversarial checks for local live journal admission.
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

import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {bodyHtml, plainSubject} from "../policy/content";
import {approveSnapshot} from "../policy/cohort";
import {createRedirectAdmission} from "../policy/redirects";
import {formToken, parseUniqCookie} from "../policy/token";
import type {RedirectAdmissionRequest, RawJournalSnapshot} from "../contracts";
import {config, snapshot, now} from "./fixtures";

test("identity grammar retains Unicode, simple balanced markup and four entities", () => {
    for (const value of ["plain café 😀", "<p>Hello <strong>there</strong><br />yes &amp; no</p>",
        "<p>&lt;script&gt; &quot;safe&quot;</p>", "<b><i>fine</i></b>"]) assert.equal(bodyHtml(value), value);
    assert.equal(plainSubject("Unicode café 😀"), "Unicode café 😀");
});
test("content refuses active, repaired, attributed and unknown-encoding domains", () => {
    for (const value of ["<script>x</script>", '<p onclick="x">x</p>', "<a href='/'>x</a>",
        "<p><p>x</p></p>", "<p>unclosed", "<b><i>x</b></i>", "&copy;", "&#60;script&#62;",
        "<iframe></iframe>", "<br/>", "<P>x</P>", "<img src=x>", "\u0000",
        "<strong>".repeat(17) + "x" + "</strong>".repeat(17), "x".repeat(65537)]) {
        assert.throws(() => bodyHtml(value), value.slice(0, 50));
    }
    for (const value of ["", '"quoted"', "<b>x</b>", "&amp;", "x\n", "\ud800", "😀".repeat(257)]) {
        assert.throws(() => plainSubject(value));
    }
});
test("private candidates never reach renderer; suspended public refuses whole page", () => {
    const data = snapshot();
    const privateEntry = {...data.entries[0]!, security: "private", eventText: "PRIVATE_SENTINEL"};
    const approved = approveSnapshot({...data, entries: [privateEntry, data.entries[1]!]});
    assert.equal(approved.entries.length, 1);
    assert.ok(!JSON.stringify(approved).includes("PRIVATE_SENTINEL"));
    assert.throws(() => approveSnapshot({...data, entries: [
        {...data.entries[0]!, props: {...data.entries[0]!.props, statusvis: "S"}},
    ]}));
});
test("unmarked, nonvisible, external authors, unsupported style and feature states fail closed", () => {
    const data = snapshot();
    for (const change of [{bio: "wrong"}, {statusvis: "S"}, {status: "D"}, {journaltype: "C"},
        {clusterid: 2}, {caps: "9007199254740993"}, {defaultpicid: 1}, {optWhocanReply: "friends"}]) {
        assert.throws(() => approveSnapshot({...data, owner: {...data.owner, ...change}}));
    }
    for (const key of Object.keys(data.features).filter(key => key !== "spamreportBans")) assert.throws(() => approveSnapshot({
        ...data, features: {...data.features, [key]: 1},
    }));
    // This new primary fact gates EntryPage only; preserve Recent admission.
    assert.deepEqual(approveSnapshot({...data, features: {...data.features, spamreportBans: 1}}),
        approveSnapshot(data));
    assert.throws(() => approveSnapshot({...data, features: {} as RawJournalSnapshot["features"]}));
    assert.throws(() => approveSnapshot({...data, style: {...data.style!,
        layers: [...data.style!.layers, {...data.style!.layers[0]!, type: "user"}]}}));
    assert.throws(() => approveSnapshot({...data, style: {...data.style!,
        layers: data.style!.layers.map(layer => ({...layer, ownerid: 1, ownerUsername: "other"}))}}));
    assert.equal(approveSnapshot(data).styleid, 6); // system userid91 is deliberately not1
    assert.throws(() => approveSnapshot({...data, entries: [{...data.entries[0]!, posterid: 7}]}));
    assert.throws(() => approveSnapshot({...data, entries: Array(201).fill(data.entries[0])}));
});
test("recent admission accepts only the stock-derived entry-page preference", () => {
    const data = snapshot();
    const withPreference = (value: string | null): RawJournalSnapshot => ({...data,
        owner: {...data.owner, publicSettings: {...data.owner.publicSettings,
            use_journalstyle_entry_page: value}}});
    for (const value of [null, "", "Y"]) {
        assert.deepEqual(approveSnapshot(withPreference(value)), approveSnapshot(data));
    }
    for (const value of ["N", "1", "true", "y", " Y", "Y "]) {
        assert.throws(() => approveSnapshot(withPreference(value)));
    }
});
test("admission owns recent parsing and finite app redirects", () => {
    const decide = createRedirectAdmission(config);
    const base: RedirectAdmissionRequest = {method: "GET", rawTarget: "/users/s2js_slice3/",
        host: "localhost:8081", origin: null, hasForwardedHeaders: false,
        hasAuthorization: false, cookieHeader: "ljuniq=AAAAAAAAAAAAAAA:1790294400:x"};
    assert.deepEqual(decide(base), {kind: "recent", request: {method: "GET", username: "s2js_slice3",
        skip: 0, skipPresent: false, uniqCookie: "AAAAAAAAAAAAAAA:1790294400:x"}});
    assert.equal(decide({...base, rawTarget: base.rawTarget + "?skip=200"}).kind, "recent");
    const explicitZero = decide({...base, rawTarget: base.rawTarget + "?skip=0"});
    assert.equal(explicitZero.kind, "recent");
    if (explicitZero.kind === "recent") {
        assert.equal(explicitZero.request.skipPresent, true);
        assert.equal(explicitZero.request.skip, 0);
    }
    for (const rawTarget of ["/support/faq", "/tools/memadd?journal=s2js_slice3&itemid=384",
        "/openid/?returnto=http://localhost:8080/users/s2js_slice3/", "/2026/09/24/",
        "/stc/??lj_base.css,css/components/quick-reply.css?v=1790294400",
        "/js/??jquery/jquery-1.8.3.js?v=1790294400", "/img/silk/identity/user.png"]) {
        assert.deepEqual(decide({...base, rawTarget}), {kind: "redirect", status: 307,
            location: config.canonicalAppOrigin + rawTarget});
    }
    for (const rawTarget of ["/login", "/multisearch"]) assert.equal(decide({...base,
        method: "POST", rawTarget, origin: config.listenOrigin}).kind, "redirect");
});
test("tainted host/cookie/origin, ambiguity and arbitrary destinations are rejected", () => {
    const decide = createRedirectAdmission(config);
    const base: RedirectAdmissionRequest = {method: "GET", rawTarget: "/users/s2js_slice3/",
        host: "localhost:8081", origin: null, hasForwardedHeaders: false, hasAuthorization: false,
        cookieHeader: null};
    for (const change of [{host: "evil.invalid"}, {hasAuthorization: true}, {hasForwardedHeaders: true},
        {cookieHeader: "ljsession=secret"}, {cookieHeader: "ljuniq=AAAAAAAAAAAAAAA:1; ljsession=secret"},
        {cookieHeader: "ljuniq=AAAAAAAAAAAAAAA:1; ljuniq=BBBBBBBBBBBBBBB:1"}, {method: "OPTIONS"},
        {origin: "http://evil.invalid"}]) assert.equal(decide({...base, ...change}).kind, "reject");
    for (const rawTarget of ["//evil.invalid/", "/%75sers/s2js_slice3/", "/users/other/",
        "/users/s2js_slice3/?skip=01", "/users/s2js_slice3/?skip=1&skip=2",
        "/users/s2js_slice3/?skip=201", "/users/s2js_slice3/?skip=+1",
        "/users/s2js_slice3/?style=light", "/stc/../etc/config.pl", "/stc/%2e%2e/config.pl",
        "/stc/??../config.css?v=1", "/stc/??safe.js?v=1", "/img/a.png?url=http://evil.invalid",
        "/palimg/a.png", "/userpic/1/2", "/2026/02/30/",
        "/openid/?returnto=http://evil.invalid", "/login?next=http://evil.invalid"]) {
        assert.equal(decide({...base, rawTarget}).kind, "reject", rawTarget);
    }
    assert.equal(decide({...base, method: "POST", rawTarget: "/login"}).kind, "reject");
});
test("real protocol signature uses current age and renews stale anonymous cookie", async () => {
    const secret = Buffer.from("0123456789abcdefghijklmnopqrstuv");
    const source = {loadLatestSecret: async () => ({stime: now - 3600, secret})};
    const token = await formToken(source, {randomBytes: n => new Uint8Array(n)}, now + 7,
        "AAAAAAAAAAAAAAA:1790294400:x");
    const bare = "c0:1790290800:3607:86400:aaaaaaaaaa-0-AAAAAAAAAAAAAAA";
    assert.equal(token.challenge, bare + ":" + createHash("md5").update(bare).update(secret).digest("hex"));
    assert.equal(token.setCookie, null);
    const renewed = await formToken(source, {randomBytes: n => new Uint8Array(n)}, now,
        "AAAAAAAAAAAAAAA:1790000000");
    assert.ok(renewed.setCookie?.startsWith("ljuniq=AAAAAAAAAAAAAAA%3A1790294400;"));
    assert.equal(renewed.setCookie,
        "ljuniq=AAAAAAAAAAAAAAA%3A1790294400; path=/; expires=Tue, 24 Nov 2026 00:00:00 GMT; SameSite=Lax");
    assert.equal(parseUniqCookie(null), null);
    assert.equal(parseUniqCookie("ljuniq=AAAAAAAAAAAAAAA%3A1790294400"), "AAAAAAAAAAAAAAA:1790294400");
    for (const cookie of ["ljuniq=short:1", "ljuniq=AAAAAAAAAAAAAAA%253A1", "session=1"]) {
        assert.throws(() => parseUniqCookie(cookie));
    }
    for (const stime of [now + 3600, now - 90000, now - 1]) {
        await assert.rejects(formToken({loadLatestSecret: async () => ({stime, secret})},
            {randomBytes: n => new Uint8Array(n)}, now, null));
    }
    await assert.rejects(formToken({loadLatestSecret: async () => ({stime: now,
        secret: Buffer.alloc(32, 0xc1)})}, {randomBytes: n => new Uint8Array(n)}, now, null));
});
