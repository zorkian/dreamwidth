// journal-url.ts
//
// Configured native personal journal URL construction.
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

import type {PublicAppConfig} from "../contracts";
import {Unsupported} from "../policy/content";

export function journalBase(username: string, config: PublicAppConfig): string {
    // LJ::journal_base (User/Account.pm): configured P rule for admitted personal
    // journals. Dynamic hook URLs cannot be invented from a presence flag.
    const rules = config.journalUrls;
    if (rules.hookConfigured) throw new Unsupported();
    const rule = rules.subdomainRules.P;
    if (!rule) throw new Unsupported();
    let base: string;
    if (rule[0] && !username.startsWith("_") && !username.endsWith("_")) {
        if (!rules.domain) throw new Unsupported();
        base = `${rules.protocol}://${username.replace(/_/g, "-")}.${rules.domain}`;
    } else if (!rule[1] && rules.isDevServer) {
        base = `${rules.protocol}://${new URL(config.canonicalAppOrigin).host}/~${username}`;
    } else base = `${rules.protocol}://${rule[1]}/${username}`;
    const parsed = new URL(base);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password ||
        parsed.search || parsed.hash || /[\x00-\x20"'<>\\]/.test(base)) throw new Unsupported();
    return base;
}
