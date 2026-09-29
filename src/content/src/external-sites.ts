// external-sites.ts
//
// A port of DW::External::Site, its per-site subclasses and
// DW::External::User: user tags for accounts on other sites.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { canonicalUsername as ljCanonicalUsername } from "./text";

export type Journaltype = "P" | "C" | "Y";

interface Badge {
    readonly url: string;
    readonly width: number;
    readonly height: number;
}

// The methods a DW::External::Site::* module overrides.
interface SiteClass {
    journalUrl?: UrlFn;
    profileUrl?: UrlFn;
    badge(type: Journaltype, imgPrefix: string): Badge;
    canonicalUsername?(input: string): string;
}

export interface ExternalSite {
    readonly siteid?: number;
    readonly hostname: string;
    readonly domain?: string;
    readonly sitename?: string;
    readonly servicetype?: string;
    readonly cls: SiteClass;
}

export interface ExternalUser {
    readonly user: string;
    readonly site: ExternalSite;
}

const fixed = (url: string): SiteClass["badge"] => () => ({ url, width: 16, height: 16 });
const local = (path: string): SiteClass["badge"] => (_, imgPrefix) => ({ url: imgPrefix + path, width: 16, height: 16 });
const USER_OTHER = local("/silk/identity/user_other.png");
const byType = (images: Record<Journaltype, [string, number, number]>): SiteClass["badge"] => (type, imgPrefix) => {
    const [path, width, height] = images[type];
    return { url: imgPrefix + path, width, height };
};
type UrlFn = (site: ExternalSite, user: string) => string;
const hostPath = (scheme: string, prefix: string, suffix = ""): UrlFn =>
    (site, user) => `${scheme}://${site.hostname}${prefix}${user}${suffix}`;
const subdomain = (suffix = ""): UrlFn => (site, user) => `http://${user}.${site.hostname}${suffix}`;
// LiveJournal::journal_url and its copies: hyphenated subdomains.
const ljSubdomain: UrlFn = (site, user) => `http://${user.replaceAll("_", "-")}.${site.domain}/`;
const matchUser = (pattern: RegExp) => (input: string) => pattern.exec(input)?.[1] ?? "";

// DW::External::Site::Atproto::canonical_username
const atprotoUsername = (input: string) => matchUser(
    /^\s*((?:(?:[a-z0-9][a-z0-9-]*)?[a-z0-9]\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?)\s*$/i)(input).toLowerCase();
const bluesky: SiteClass = {
    journalUrl: hostPath("https", "/profile/"), profileUrl: hostPath("https", "/profile/"),
    badge: fixed("https://web-cdn.bsky.app/static/favicon-16x16.png"), canonicalUsername: atprotoUsername,
};

const CLASSES: Record<string, SiteClass> = {
    LiveJournal: {
        journalUrl: ljSubdomain, canonicalUsername: ljCanonicalUsername,
        badge: byType({
            P: ["/external/lj-userinfo.gif", 17, 17], C: ["/external/lj-community.gif", 16, 16],
            Y: ["/external/lj-syndicated.gif", 16, 16],
        }),
    },
    InsaneJournal: {
        canonicalUsername: ljCanonicalUsername,
        badge: byType({
            P: ["/external/ij-userinfo.gif", 21, 20], C: ["/external/ij-community.gif", 18, 13],
            Y: ["/external/lj-syndicated.gif", 16, 16],
        }),
    },
    DeadJournal: {
        canonicalUsername: ljCanonicalUsername,
        badge: byType({
            P: ["/external/dj-userinfo.gif", 17, 25], C: ["/external/dj-community.gif", 17, 17],
            Y: ["/external/dj-syndicated.gif", 17, 17],
        }),
    },
    Inksome: { journalUrl: ljSubdomain, badge: USER_OTHER },
    JournalFen: { canonicalUsername: ljCanonicalUsername, badge: USER_OTHER },
    Dreamwidth: {
        journalUrl: ljSubdomain, canonicalUsername: ljCanonicalUsername,
        badge: byType({
            P: ["/silk/identity/user.png", 16, 16], C: ["/silk/identity/community.png", 16, 16],
            Y: ["/silk/identity/feed.png", 16, 16],
        }),
    },
    ArchiveofOurOwn: { badge: fixed("https://archiveofourown.org/favicon.ico") },
    X: { journalUrl: hostPath("http", "/"), profileUrl: hostPath("http", "/"), badge: fixed("http://x.com/favicon.ico") },
    Tumblr: { journalUrl: subdomain(), profileUrl: subdomain(), badge: fixed("http://www.tumblr.com/favicon.ico") },
    Etsy: {
        journalUrl: hostPath("http", "/shop/"), profileUrl: hostPath("http", "/people/"),
        badge: fixed("http://www.etsy.com/favicon.ico"),
    },
    Diigo: { journalUrl: hostPath("http", "/user/"), profileUrl: hostPath("http", "/profile/"), badge: USER_OTHER },
    Blogspot: { journalUrl: subdomain(), profileUrl: subdomain(), badge: fixed("http://blogger.com/favicon.ico") },
    Delicious: { journalUrl: hostPath("http", "/"), profileUrl: hostPath("http", "/stacks/"), badge: USER_OTHER },
    DeviantArt: {
        journalUrl: subdomain("/gallery"), profileUrl: subdomain(), badge: fixed("http://i.deviantart.net/icons/favicon.png"),
    },
    LastFM: {
        journalUrl: hostPath("http", "/user/"), profileUrl: hostPath("http", "/user/", "/charts"),
        badge: fixed("http://cdn.last.fm/flatness/favicon.2.ico"),
    },
    Ravelry: {
        journalUrl: hostPath("http", "/people/"), profileUrl: hostPath("http", "/projects/"),
        badge: fixed("http://ravelry.com/favicon.ico"),
    },
    Wordpress: {
        journalUrl: subdomain(), profileUrl: subdomain(), badge: fixed("http://s.wordpress.org/about/images/wpmini-blue.png"),
    },
    Plurk: { journalUrl: hostPath("http", "/"), profileUrl: hostPath("http", "/"), badge: fixed("http://www.plurk.com/favicon.ico") },
    Pinboard: {
        journalUrl: hostPath("http", "/u:"), profileUrl: hostPath("http", "/u:", "/profile/public"),
        badge: fixed("http://pinboard.in/favicon.ico"),
    },
    FanFiction: { journalUrl: hostPath("http", "/~"), profileUrl: hostPath("http", "/~"), badge: fixed("/img/userheads/ff-icon-192.png") },
    Pinterest: {
        journalUrl: hostPath("http", "/"), profileUrl: hostPath("http", "/"), badge: fixed("http://www.pinterest.com/favicon.ico"),
    },
    YouTube: {
        journalUrl: hostPath("https", "/@"), profileUrl: hostPath("https", "/@", "/about"),
        badge: fixed("https://youtube.com/favicon.ico"),
    },
    GitHub: { journalUrl: hostPath("http", "/"), profileUrl: hostPath("http", "/", "/"), badge: local("/profile_icons/github.png") },
    LJRossia: {
        journalUrl: (_, user) => `http://lj.rossia.org/users/${user}/`,
        profileUrl: (_, user) => `http://lj.rossia.org/userinfo.bml?user=${user}`,
        badge: byType({
            P: ["/external/ljr-userinfo.gif", 17, 17], C: ["/external/ljr-community.gif", 16, 16],
            Y: ["/external/ljr-syndicated.gif", 16, 16],
        }),
    },
    Medium: {
        journalUrl: hostPath("https", "/@", "/latest"), profileUrl: hostPath("https", "/@"),
        badge: fixed("https://medium.com/favicon.ico"),
    },
    Imzy: { journalUrl: hostPath("https", "/@"), profileUrl: hostPath("https", "/@"), badge: USER_OTHER },
    Facebook: {
        journalUrl: hostPath("https", "/"), profileUrl: hostPath("https", "/"), badge: fixed("https://www.facebook.com/favicon.ico"),
        canonicalUsername: matchUser(/^\s*([a-zA-Z0-9.]+)\s*$/),
    },
    Instagram: {
        journalUrl: hostPath("https", "/"), profileUrl: hostPath("https", "/"), badge: local("/profile_icons/instagram.png"),
        canonicalUsername: matchUser(/^\s*([a-zA-Z0-9_.]+)\s*$/),
    },
    Substack: {
        journalUrl: subdomain("/"), profileUrl: subdomain("/about"),
        badge: fixed("https://substackcdn.com/icons/substack/favicon.ico"),
    },
    Itch: {
        journalUrl: hostPath("http", "/profile/"), profileUrl: hostPath("http", "/profile/"),
        badge: fixed("https://itch.io/favicon.ico"),
    },
    FurAffinity: {
        journalUrl: hostPath("http", "/gallery/"), profileUrl: hostPath("http", "/user/"),
        badge: fixed("https://www.furaffinity.net/themes/beta/img/favicon.ico"),
    },
    ArtStation: {
        journalUrl: hostPath("http", "/"), profileUrl: hostPath("http", "/", "/profile"),
        badge: fixed("https://www.artstation.com/assets/favicon.ico"),
    },
    Kofi: { journalUrl: hostPath("http", "/"), profileUrl: hostPath("http", "/"), badge: fixed("https://ko-fi.com/favicon.png") },
    Bluesky: bluesky,
    // DW::External::Site::BlueskySocial::canonical_username
    BlueskySocial: {
        ...bluesky,
        canonicalUsername: input => {
            const user = matchUser(/^\s*((?:[a-z0-9][a-z0-9-]*)?[a-z0-9])\s*$/i)(input);
            return user ? `${user.toLowerCase()}.bsky.social` : "";
        },
    },
};

const UNKNOWN: SiteClass = { journalUrl: (site, user) => `http://www.${site.hostname}/users/${user}/`, badge: USER_OTHER };

// DW::External::Site's static initializers: [siteid, hostname, domain, sitename, servicetype, aliases].
const SITE_TABLE: [number, string, string, string, string, string[]][] = [
    [2, "www.livejournal.com", "livejournal.com", "LiveJournal", "lj", ["livejournal", "lj"]],
    [3, "www.insanejournal.com", "insanejournal.com", "InsaneJournal", "lj", ["insanejournal", "ij"]],
    [4, "www.deadjournal.com", "deadjournal.com", "DeadJournal", "lj", ["deadjournal", "dj"]],
    [5, "www.inksome.com", "inksome.com", "Inksome", "lj", ["inksome"]],
    [6, "www.journalfen.net", "journalfen.net", "JournalFen", "lj", ["journalfen", "jf"]],
    [7, "www.dreamwidth.org", "dreamwidth.org", "Dreamwidth", "lj", ["dreamwidth", "dw"]],
    [8, "www.archiveofourown.org", "archiveofourown.org", "ArchiveofOurOwn", "AO3", ["archiveofourown", "ao3.org", "ao3"]],
    [9, "x.com", "x.com", "X", "X", ["x", "twitter.com", "twitter"]],
    [10, "tumblr.com", "tumblr.com", "Tumblr", "Tumblr", ["tumblr"]],
    [11, "www.etsy.com", "etsy.com", "Etsy", "Etsy", ["etsy"]],
    [12, "www.diigo.com", "diigo.com", "Diigo", "Diigo", ["diigo"]],
    [13, "blogspot.com", "blogspot.com", "Blogspot", "blogspot", ["blogspot", "blogger.com", "blogger"]],
    [15, "deviantart.com", "deviantart.com", "DeviantArt", "da", ["deviantart", "da"]],
    [16, "last.fm", "last.fm", "LastFM", "lastfm", []],
    [17, "www.ravelry.com", "ravelry.com", "Ravelry", "ravelry", ["ravelry"]],
    [18, "wordpress.com", "wordpress.com", "Wordpress", "WP", ["wordpress"]],
    [19, "www.plurk.com", "plurk.com", "Plurk", "Plurk", ["plurk"]],
    [20, "www.pinboard.in", "pinboard.in", "Pinboard", "Pinboard", ["pinboard"]],
    [21, "www.fanfiction.net", "fanfiction.net", "FanFiction", "FanFiction", ["ffn"]],
    [22, "www.pinterest.com", "pinterest.com", "Pinterest", "pinterest", ["pinterest"]],
    [23, "www.youtube.com", "youtube.com", "YouTube", "yt", ["youtube"]],
    [24, "www.github.com", "github.com", "GitHub", "gh", ["github"]],
    [25, "lj.rossia.org", "lj.rossia.org", "LJRossia", "lj", ["lj.rossia", "ljr"]],
    [26, "medium.com", "medium.com", "Medium", "medium", ["medium"]],
    [27, "www.imzy.com", "imzy.com", "Imzy", "imzy", ["imzy"]],
    [28, "www.facebook.com", "facebook.com", "Facebook", "FB", ["facebook", "fb"]],
    [29, "www.instagram.com", "instagram.com", "Instagram", "instagram", ["instagram", "ig"]],
    // delicious.com's own entry (siteid 14) is shadowed by this alias in Perl.
    [30, "del.icio.us", "del.icio.us", "Delicious", "delicious", ["delicious", "delicious.com"]],
    [31, "substack.com", "substack.com", "Substack", "substack", ["substack"]],
    [32, "www.itch.io", "itch.io", "Itch", "itch", ["itch"]],
    [33, "www.furaffinity.com", "furaffinity.com", "FurAffinity", "fa", ["fa"]],
    [33, "www.artstation.com", "artstation.com", "ArtStation", "artstation", ["artstation"]],
    [34, "www.ko-fi.com", "ko-fi.com", "Kofi", "kofi", ["kofi"]],
    [35, "bsky.app", "bsky.app", "Bluesky", "atproto", ["bsky"]],
    [36, "bsky.app", "bsky.social", "BlueskySocial", "atproto", []],
];

const SITES = new Map<string, ExternalSite>();
for (const [siteid, hostname, domain, sitename, servicetype, aliases] of SITE_TABLE) {
    const site = { siteid, hostname, domain, sitename, servicetype, cls: CLASSES[sitename]! };
    for (const name of [domain, ...aliases]) SITES.set(name, site);
}

// DW::External::Site::get_deadsites
const DEAD_SITES = new Set(["del.icio.us", "diigo.com", "imzy.com", "inksome.com", "journalfen.net"]);

// DW::External::Site::get_site: by alias, or by the last two or three parts
// of a domain name, falling back to an unknown site for any other domain.
export function getSite(input: string): ExternalSite | undefined {
    let site = input.replace(/\r?\n/, "").replace(/^.+:\/\/(.*)/, "$1").replace(/^([^/]+)\/.*(?=\n?$)/, "$1");
    if (!site.includes(".")) return SITES.get(site.toLowerCase());
    const parts = site.split(".").map(part => part.toLowerCase()).filter(part => /^[a-z][a-z0-9-]*?[a-z0-9]*$/.test(part));
    const part = (i: number) => parts[parts.length + i] ?? "";
    return SITES.get(`${part(-2)}.${part(-1)}`) ?? SITES.get(`${part(-3)}.${part(-2)}.${part(-1)}`) ??
        (parts.length >= 2 ? { hostname: `${part(-2)}.${part(-1)}`, cls: UNKNOWN } : undefined);
}

// DW::External::User->new: undefined for an unknown site or invalid username.
export function externalUser(user: string, siteName: string): ExternalUser | undefined {
    if (!user || user === "0" || !siteName || siteName === "0") return undefined;
    const site = getSite(siteName);
    if (!site) return undefined;
    const name = site.cls.canonicalUsername
        ? site.cls.canonicalUsername(user)
        : /^\s*([a-zA-Z0-9_-]+)\s*$/.exec(user)?.[1] ?? "";
    return name && name !== "0" ? { user: name, site } : undefined;
}

export function journalUrl(u: ExternalUser): string {
    return u.site.cls.journalUrl?.(u.site, u.user) ?? `https://${u.site.hostname}/users/${u.user}/`;
}

export function profileUrl(u: ExternalUser): string {
    return u.site.cls.profileUrl?.(u.site, u.user) ?? journalUrl(u) + "profile";
}

// DW::External::Site::journaltype: only LJ-based sites have account types,
// looked up from what DW::External::Userinfo has cached.
export function journaltype(u: ExternalUser, lookup?: (user: string, siteid: number) => Journaltype | undefined): Journaltype {
    return u.site.servicetype === "lj" ? lookup?.(u.user, u.site.siteid!) ?? "P" : "P";
}

export interface DisplayOptions {
    readonly noLink: boolean;
    readonly noLjuserClass: boolean;
    readonly imgPrefix: string;
    readonly type: Journaltype;
    // LJ::CleanHTML::https_url
    readonly httpsUrl: (url: string) => string;
}

// DW::External::User::ljuser_display
export function ljuserDisplay(u: ExternalUser, options: DisplayOptions): string {
    const { site, user } = u;
    const badge = site.cls.badge(options.type, options.imgPrefix);
    const domain = site.domain || site.hostname;
    const nolink = DEAD_SITES.has(domain) || options.noLink;
    const img = `<img src='${options.httpsUrl(badge.url)}' alt='[${domain} profile] ' ` +
        `style='vertical-align: text-bottom; border: 0; padding-right: 1px;' width='${badge.width}' height='${badge.height}'/>`;
    const cls = options.noLjuserClass ? "" : " class='ljuser'";
    return nolink
        ? `<span style='white-space: nowrap;'${cls}>${img}<b>${user} [${site.sitename ?? ""}]</b></span>`
        : `<span style='white-space: nowrap;'${cls}><a href='${profileUrl(u)}'>${img}</a>` +
            `<a href='${journalUrl(u)}'><b>${user}</b></a></span>`;
}
