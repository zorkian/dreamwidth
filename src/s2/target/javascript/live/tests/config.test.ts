// config.test.ts
//
// Validate public cleaner facts before starting an ordinary live service.
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
import type {PublicAppConfig} from "../contracts";
import {validateConfig} from "../policy/config";
import {config} from "./fixtures";

test("public cleaner config accepts derived placeholder and exact host:port keys", () => {
    validateConfig(config);
    validateConfig({...config, entryContent: {...config.entryContent,
        imagePlaceholder: {...config.entryContent.imagePlaceholder, alt: 'Image < & " café'},
        urls: {...config.entryContent.urls, knownHttpsSites: ["example.org"],
            formDomainBanned: ["blocked.example.test:8080"]}}});
});

test("public cleaner config rejects unchecked shapes, capabilities and descriptors", () => {
    const entry = config.entryContent;
    const images: unknown[] = [null, {}, {...entry.imagePlaceholder, width: 0},
        {...entry.imagePlaceholder, height: "35"}, {...entry.imagePlaceholder, width: 1.5},
        {...entry.imagePlaceholder, src: "javascript:alert(1)"},
        {...entry.imagePlaceholder, src: "/img/../../etc/config.pl"},
        {...entry.imagePlaceholder, src: "//example.test/image.png"},
        {...entry.imagePlaceholder, alt: "\ud800"},
        {...entry.imagePlaceholder, title: "\u0000"},
        {...entry.imagePlaceholder, onclick: "alert(1)"}];
    const urls: unknown[] = [null, {}, {...entry.urls, imageProxy: "host-resolved"},
        {...entry.urls, siteDomain: "https://example.test"},
        {...entry.urls, knownHttpsSites: ["Example.org"]},
        {...entry.urls, knownHttpsSites: ["example.org", "example.org"]},
        {...entry.urls, formDomainBanned: ["z.test", "a.test"]},
        {...entry.urls, formDomainBanned: ["user@host.test"]},
        {...entry.urls, formDomainBanned: ["host.test/path"]},
        {...entry.urls, formDomainBanned: {"host.test": true}},
        {...entry.urls, signingKey: "SENTINEL_SECRET"}];
    const candidates: unknown[] = [null, {}, {...entry, extra: true},
        ...images.map(imagePlaceholder => ({...entry, imagePlaceholder})),
        ...urls.map(value => ({...entry, urls: value}))];
    for (const entryContent of candidates) {
        assert.throws(() => validateConfig({...config, entryContent} as PublicAppConfig));
    }
});
