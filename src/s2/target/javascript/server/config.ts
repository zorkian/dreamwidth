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
    readonly defaultFeedStyle: Readonly<Record<string, string>>;
    readonly home: string;
    readonly staticDocs: string;
    readonly siteRoot: string;
    readonly protocol: string;
    readonly domain: string;
    readonly domainWeb: string;
    readonly userDomain: string;
    readonly subdomainFunction: Readonly<Record<string, string>>;
    readonly embedModuleDomain: string;
    readonly trustedCssHosts: readonly string[];
    readonly cssProxy: string | null;
    readonly cssCleaner: boolean;
    readonly subdomainRules: Readonly<Record<string, readonly [number, string]>>;
    readonly isDevServer: boolean;
    readonly siteName: string;
    readonly siteNameShort: string;
    readonly siteNameAbbrev: string;
    // $LJ::USER_EMAIL: whether accounts may have a site email alias.
    readonly userEmail: boolean;
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
        // DW::Captcha::site_enabled.
        readonly captcha: boolean;
        // The captcha implementation's name, such as "hcaptcha"; "" when disabled.
        readonly captchaType: string;
        readonly hcaptchaSitekey: string;
        readonly supportEmail: string;
        readonly maxlengthUser: number;
        readonly maxlengthPass: number;
    };
    // Cookie generations LJ::Session accepts, for the ljtrust and session cookies.
    readonly trustCookie: { readonly generations: readonly string[]; readonly maxAge: number };
    // $LJ::TRUST_X_HEADERS, and whether $LJ::IS_TRUSTED_PROXY is code, which
    // only Perl can run.
    readonly remoteIp: { readonly trustXHeaders: boolean; readonly trustedProxyIsCode: boolean };
    // Page::print_trusted's snippets by key, or by "username-key" for the listed usernames.
    readonly trustedS2: Readonly<Record<string, string>>;
    readonly trustedS2Usernames: readonly string[];
    // The LJ::is_enabled features journal views check.
    readonly enabled: Readonly<Record<
        "tags" | "security_filter" | "esn_ajax" | "embed_module" | "inbox_update_poll" | "adult_content"
        | "infoshow_migrate" | "show-talkleft" | "esn" | "payments" | "directory" | "faq_summaries", boolean>>;
    // The pages under /legal, as DW::Controller::Legal lists them.
    readonly legalPages: readonly string[];
    // $LJ::DEFAULT_LANG
    readonly defaultLang: string;
    // $LJ::EXAMPLE_USER_ACCOUNT, whom the FAQs address anonymous visitors as.
    readonly exampleUser: string;
    // $LJ::MERCH_URL
    readonly merchUrl: string;
    // %LJ::FORCE_EMPTY_SUBSCRIPTIONS: accounts whose profiles leave out their
    // subscribers and members.
    readonly forceEmptySubscriptions: readonly number[];
    // $LJ::MAX_WT_EDGES_LOAD
    readonly maxWtEdgesLoad: number;
    // Country names by code, and the type of the codes table naming each
    // country's regions, as DW::Countries and %LJ::COUNTRIES_WITH_REGIONS give them.
    readonly countries: Readonly<Record<string, string>>;
    readonly countriesWithRegions: Readonly<Record<string, string>>;
    // Journal paths DW::Routing's user controllers serve, without any .format
    // suffix: whole paths, and regular expressions.
    readonly userRoutes: {
        readonly paths: readonly string[];
        readonly patterns: readonly { readonly source: string; readonly flags: string }[];
    };
    // Titles for the not-found page, one chosen each time; none for the stock page.
    readonly notFoundQuips: readonly string[];
    // Adult content levels whose journals and entries ask robots to stay away.
    readonly robotBlockingContent: readonly string[];
    readonly siteTemplates: SiteTemplates;
}

// What DW::Template's view and site scheme engines need.
export interface SiteTemplates {
    // Directories to find templates in, first match first.
    readonly views: readonly string[];
    readonly schemes: readonly string[];
    // Each site scheme's inheritance, starting with itself.
    readonly schemeList: Readonly<Record<string, readonly string[]>>;
    readonly defaultScheme: string;
    // DW::Logic::MenuNav's categories, with the items a logged-out visitor sees.
    readonly menu: readonly {
        readonly name: string;
        readonly items: readonly { readonly url: string; readonly text: string; readonly text_opts: Record<string, string> }[];
    }[];
    readonly shopRoot: string;
    readonly isCanary: boolean;
    // The site namespace's constants.
    readonly constants: Readonly<Record<string, unknown>>;
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
