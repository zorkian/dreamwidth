// public-config.test.ts
//
// Configured origins and source URL facts for the private journal renderer.
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
import type { PublicAppConfig } from "../live/contracts";
import { validateConfig, validateLimits } from "../live/policy/config";
import { Unsupported } from "../live/policy/content";

function config(): PublicAppConfig {
    return {
        canonicalAppOrigin: "https://app.example.test", listenOrigin: "http://viewer.example.test:9191",
        siteRoot: "https://app.example.test", statPrefix: "https://cdn.example.test/stc",
        jsPrefix: "//cdn.example.test/js", imgPrefix: "/img", palImgRoot: "/palimg",
        userpicRoot: "/userpic", userDomain: "users.example.test", usernameMaxLength: 25,
        maxScrollback: 100, siteName: "Configured site", siteNameShort: "Site", siteNameAbbrev: "S",
        appleTouchIcon: "", facebookPreviewIcon: "",
        journalUrls: {protocol: "https", domain: "journals.example.test", isDevServer: false,
            subdomainRules: {P: [true, "users.journals.example.test"]}, hookConfigured: false},
        entryContent: {imagePlaceholder: {src: "/img/imageplaceholder2.png", width: 35, height: 35,
            alt: "A & B \" café", title: "A & B \" café"},
        urls: {siteDomain: "", knownHttpsSites: ["UPPER.example", "lower.example"],
            formDomainBanned: ["Banned.example", "blocked.example"], imageProxy: "not-configured"}},
    };
}

test("independent origins, CDN prefixes and exact source key case are accepted unchanged", () => {
    const value = config(); const before = JSON.stringify(value);
    validateConfig(value);
    assert.equal(JSON.stringify(value), before);
    validateConfig({...value, listenOrigin: "https://viewer.example.test"});
    validateConfig({...value, canonicalAppOrigin: "http://localhost:8080", userDomain: "",
        journalUrls: {protocol: "http", domain: "", isDevServer: true,
            subdomainRules: {P: [false, ""]}, hookConfigured: false}});
    validateConfig({...value, journalUrls: {...value.journalUrls,
        subdomainRules: {P: [false, "app.example.test:8080/users"]}}});
});

test("credentials, active URL schemes, unexpected config and unported hooks refuse", () => {
    const value = config();
    const mutations: unknown[] = [
        {...value, canonicalAppOrigin: "https://fixture:private@app.example.test"},
        {...value, listenOrigin: "https://viewer.example.test/path"},
        {...value, jsPrefix: "javascript:alert(1)"},
        {...value, statPrefix: "https://fixture:private@cdn.example.test/stc"},
        {...value, imgPrefix: "//cdn.example.test/img\" onerror=alert(1)"},
        {...value, anonymousCaptchaDisabled: true},
        {...value, journalUrls: {...value.journalUrls, hookConfigured: true}},
        {...value, journalUrls: {...value.journalUrls, domain: "", subdomainRules: {P: [true, ""]}}},
        {...value, usernameMaxLength: 0}, {...value, maxScrollback: 0},
        {...value, entryContent: {...value.entryContent, urls: {...value.entryContent.urls,
            imageProxy: "host-resolved"}}},
        {...value, entryContent: {...value.entryContent, urls: {...value.entryContent.urls,
            knownHttpsSites: ["same.example", "same.example"]}}},
    ];
    for (const item of mutations) assert.throws(() => validateConfig(item as PublicAppConfig), Unsupported);
    assert.throws(() => validateLimits({timeoutMs: 10001, maxHeapMiB: 128, maxOutputBytes: 2097152}), Unsupported);
    validateLimits({timeoutMs: 10000, maxHeapMiB: 128, maxOutputBytes: 2097152});
});
