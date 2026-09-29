// config.ts
//
// Site configuration exported by tools/export-config.pl.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { readFileSync } from "node:fs";

export interface DatabaseInfo {
    readonly host: string | null;
    readonly port: number | null;
    readonly socket: string | null;
    readonly user: string;
    readonly password: string;
    readonly database: string;
    readonly roles: readonly string[];
}

export interface SiteConfig {
    readonly databases: Readonly<Record<string, DatabaseInfo>>;
    readonly clusterPairActive: Readonly<Record<string, string>>;
    readonly defaultStyle: Readonly<Record<string, string>>;
    readonly home: string;
    readonly siteRoot: string;
    readonly protocol: string;
    readonly domain: string;
    readonly domainWeb: string;
    readonly userDomain: string;
    readonly embedModuleDomain: string;
    readonly trustedCssHosts: readonly string[];
    readonly cssProxy: string | null;
    readonly cssCleaner: boolean;
    readonly subdomainRules: Readonly<Record<string, readonly [number, string]>>;
    readonly isDevServer: boolean;
    readonly siteName: string;
    readonly siteNameShort: string;
    readonly siteNameAbbrev: string;
    readonly imgPrefix: string;
    readonly statPrefix: string;
    readonly jsPrefix: string;
    readonly userpicRoot: string;
    readonly palImgRoot: string;
    readonly maxScrollback: number;
    readonly tagIntersection: number;
    // 0 for no limit.
    readonly maxIconsPerPage: number;
    readonly maxFriendsViewAge: number;
    readonly maxScrollbackFriends: number;
    readonly talkPageSize: number;
    readonly talkMaxSubjects: number;
    readonly talkThreadPoint: number;
    readonly images: Readonly<Record<string, StandardImage>>;
    readonly strings: Readonly<Record<string, string>>;
    readonly capBits: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    readonly capDefaults: Readonly<Record<string, unknown>>;
    readonly talkform: {
        // As LJ::Talk::print_subjecticon_by_id prints them, with %s where extra attributes go.
        readonly subjecticons: readonly { readonly id: string; readonly html: string }[];
        readonly editors: { readonly selected: string; readonly items: readonly { value: string; text: string }[] };
        // DW::Captcha::site_enabled: reply pages then need Perl's request checks.
        readonly captcha: boolean;
        readonly maxlengthUser: number;
        readonly maxlengthPass: number;
    };
    // Page::print_trusted's snippets by key, or by "username-key" for the listed usernames.
    readonly trustedS2: Readonly<Record<string, string>>;
    readonly trustedS2Usernames: readonly string[];
    // The LJ::is_enabled features journal views check.
    readonly enabled: Readonly<Record<
        "tags" | "security_filter" | "esn_ajax" | "embed_module" | "inbox_update_poll", boolean>>;
    // Adult content levels whose journals and entries ask robots to stay away.
    readonly robotBlockingContent: readonly string[];
}

export interface StandardImage {
    readonly src: string;
    readonly width: number;
    readonly height: number;
    readonly alt: string;
}

export function readConfig(file: string): SiteConfig {
    return JSON.parse(readFileSync(file, "utf8")) as SiteConfig;
}
