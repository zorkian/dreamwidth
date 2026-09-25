// token.ts
//
// Bounded local S2 journal policy and rendering support.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// Inherited ports: cgi-bin/LJ/UniqCookie.pm anonymous cookie parts/renewal protocol.
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


// Challenge protocol port: cgi-bin/DW/Auth/Challenge.pm
// Authors:
//     Mark Smith <mark@dreamwidth.org>
// Copyright (c) 2020 by Dreamwidth Studios, LLC.
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.
// The inherited LJ cookie portions above retain their GPL terms.
//

import { createHash } from "node:crypto";
import type { ComparisonRandom, LocalSecretSource } from "../contracts";
import { Unsupported } from "./content";

export function parseUniqCookie(header: string | null): string | null {
    if (header === null || header === "") return null;
    // CGI::Cookie emits percent-encoded colons. Admit only that one unambiguous
    // escape (once), or literal colons used by the controlled comparison.
    // Never decode arbitrary escapes, resolve duplicates or ignore auth cookies.
    const match = /^ljuniq=([a-zA-Z0-9]{15}(?::|%3[aA])[0-9]{1,10}(?:(?::|%3[aA])x)?)$/.exec(header);
    if (!match) throw new Unsupported();
    return match[1]!.replace(/%3[aA]/g, ":");
}
function randomCharacters(random: ComparisonRandom, count: number): string {
    const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let value = "";
    let rounds = 0;
    while (value.length < count) {
        if (++rounds > 128) throw new Error("Entropy unavailable");
        const bytes = random.randomBytes(count - value.length);
        if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error("Entropy unavailable");
        for (const byte of bytes) {
            if (byte < 248 && value.length < count) value += alphabet[byte % 62];
        }
    }
    return value;
}
export async function formToken(
    source: LocalSecretSource, random: ComparisonRandom, now: number, cookie: string | null,
): Promise<{ challenge: string; uniq: string; setCookie: string | null }> {
    if (!Number.isSafeInteger(now) || now < 0) throw new Error("Clock unavailable");
    if (cookie !== null && !/^[a-zA-Z0-9]{15}:[0-9]{1,10}(?::x)?$/.test(cookie)) throw new Unsupported();
    const secret = await source.loadLatestSecret(now, 86400);
    if (!secret || secret.stime % 3600 !== 0 || secret.stime > now - now % 3600 ||
        !Number.isSafeInteger(secret.stime) || secret.stime < 0 || now - secret.stime > 86400 ||
        secret.secret.length !== 32 || !/^[A-Za-z0-9]{32}$/.test(Buffer.from(secret.secret).toString("latin1"))) {
        throw new Error("Local challenge unavailable");
    }
    const uniq = cookie?.split(":")[0] ?? randomCharacters(random, 15);
    const timestamp = Number(cookie?.split(":")[1] ?? 0);
    const setCookie = !cookie || timestamp > now || now - timestamp >= 86400
        ? `ljuniq=${uniq}%3A${now}; Path=/; Max-Age=5184000; SameSite=Lax` : null;
    const attr = `${randomCharacters(random, 10)}-0-${uniq}`;
    const bare = `c0:${secret.stime}:${now - secret.stime}:86400:${attr}`;
    const signature = createHash("md5").update(bare).update(secret.secret).digest("hex");
    return { challenge: `${bare}:${signature}`, uniq, setCookie };
}
