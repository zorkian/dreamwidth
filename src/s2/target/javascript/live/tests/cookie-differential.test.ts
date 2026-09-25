// cookie-differential.test.ts
//
// Retained cookie protocol differential with explicit offline fixture entropy.
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
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {parseUniqCookie, formToken} from "../policy/token";
import {now} from "./fixtures";

test("actual Perl cookie parse/renew/challenge/header agrees on first and return requests", async () => {
    const headers = [null,
        "ljuniq=AAAAAAAAAAAAAAA:1790294400", "ljuniq=AAAAAAAAAAAAAAA%3A1790294400",
        "ljuniq=AAAAAAAAAAAAAAA:1790294400:x", "ljuniq=AAAAAAAAAAAAAAA%3A1790294400%3Ax",
        "ljuniq=AAAAAAAAAAAAAAA:1790294400:safe_extra-42",
        "ljuniq=AAAAAAAAAAAAAAA:1790000000:x", "ljuniq=AAAAAAAAAAAAAAA:1790299999:x",
        "ljuniq=AAAAAAAAAAAAAAA:1"];
    const source = {loadLatestSecret: async () => ({stime: now,
        secret: Buffer.from("0123456789abcdefghijklmnopqrstuv")})};
    const random = {randomBytes: (n: number) => new Uint8Array(n)};
    // Include the exact header from our own first response as a second request.
    const first = await formToken(source, random, now, null);
    headers.push(first.setCookie!.split(";")[0]!);
    const result = spawnSync("perl", [resolve(__dirname, "../../../live/tests/cookie-oracle.pl")], {
        input: JSON.stringify(headers), encoding: "utf8", timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    const expected = JSON.parse(result.stdout) as {challenge: string; uniq: string; setCookie: string | null}[];
    for (const [i, header] of headers.entries()) {
        const actual = await formToken(source, random, now, parseUniqCookie(header));
        assert.equal(actual.challenge, expected[i]!.challenge, String(header));
        assert.equal(actual.uniq, expected[i]!.uniq, String(header));
        assert.equal(actual.setCookie, expected[i]!.setCookie, String(header));
    }
});
