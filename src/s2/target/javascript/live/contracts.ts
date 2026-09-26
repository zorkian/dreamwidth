// contracts.ts
//
// Typed boundaries for the bounded local anonymous S2 journal service.
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

import type { EntryContentContext, ImagePlaceholder } from "@dreamwidth/content/contracts";
import type { SourceCapabilities } from "./startup-types";

export type PublicSettingName =
    | "stylesys" | "s2_style" | "journaltitle" | "journalsubtitle"
    | "url" | "urlname" | "adult_content" | "adult_content_reason"
    | "control_strip_display" | "control_strip_color" | "sticky_entry"
    | "show_control_strip" | "view_control_strip"
    | "customtext_title" | "customtext_url" | "customtext_content"
    | "opt_blockrobots" | "opt_allowsearchby" | "opt_blockglobalsearch"
    | "opt_ctxpopup" | "opt_no_quickreply" | "opt_show_captcha_to"
    | "opt_whoscreened" | "opt_usermsg" | "opt_usesharedpic" | "opt_tagpermissions"
    | "opt_embedplaceholders" | "opt_imagelinks" | "opt_imageundef"
    | "opt_maxpicheight" | "opt_maxpicwidth" | "icbm" | "timezone"
    | "renamedto" | "google_analytics" | "ga4_analytics" | "exclude_from_own_stats"
    | "use_journalstyle_entry_page" | "use_journalstyle_icons_page";

// Every key exists. Absent persisted property is null, not an omitted query.
// Construct publicSettings and log props as null-prototype own-property records;
// data-driven names must never resolve inherited keys or invoke prototype setters.
export type PublicSettings = Readonly<Record<PublicSettingName, string | null>>;

export interface RawUser {
    readonly userid: number;
    readonly user: string;
    readonly clusterid: number;
    readonly status: string;
    readonly statusvis: string;
    readonly journaltype: string;
    readonly name: string;
    readonly optShowTalkLinks: string;
    readonly optWhocanReply: string;
    readonly optForceMoodtheme: string;
    readonly moodthemeid: number;
    readonly defaultpicid: number;
    readonly dversion: number;
    readonly caps: string; // decimal unsigned bitmask; never JS bitwise truncation
    readonly publicSettings: PublicSettings;
}

export interface RawStyleLayer {
    readonly type: string; // expose unsupported types; never silently drop them
    readonly s2lid: number;
    readonly ownerid: number;
    readonly ownerUsername: string; // joined global owner; missing row unsupported; fingerprint both
    readonly compiledTime: number; // s2compiled.comptime; s2layers has no modtime
    readonly sourceHash: string;
}

export interface RawStyle {
    readonly origin: "persisted" | "default";
    readonly styleid: number; // 0 for a resolved DEFAULT_STYLE without a stored style
    readonly ownerid: number | null;
    readonly name: string | null; // informational, never an enrollment gate
    readonly modtime: number;
    readonly layers: readonly RawStyleLayer[];
}

export interface RawEntry {
    readonly journalid: number;
    readonly jitemid: number;
    readonly anum: number;
    readonly posterid: number;
    readonly eventtime: string; // exact validated MySQL civil YYYY-MM-DD HH:mm:ss
    readonly logtime: string;
    readonly rlogtime: number;
    readonly revttime: number;
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly security: string;
    readonly allowmask: string;
    readonly replycount: number;
    readonly compressed: string;
    // All text logprops, including unsupported ones; the two binary crosspost
    // props are represented separately. Values such as useragent never render.
    readonly props: Readonly<Record<string, string | null>>;
    readonly xpostOpaque?: {readonly encoding: "opaque-bytes"; readonly base64: string};
    readonly xpostDetail?: {readonly encoding: "storable-network-2.11"; readonly base64: string};
    // Source bytes decoded strictly once, with bounded gzip event decompression.
    // Unknown8bit is refused before decoding, never guessed as UTF8.
    readonly subjectText: string;
    readonly eventText: string;
}

export interface RawLink {
    readonly ordernum: number;
    readonly parentnum: number;
    readonly title: string;
    readonly url: string | null;
    readonly hover: string | null;
}

export interface RawUserpic {
    readonly userid: number;
    readonly picid: number;
    readonly width: number;
    readonly height: number;
    readonly state: string;
    readonly description: string;
}

export interface RawUserpicMap {
    readonly mapid: number | null;
    readonly keyword: string | null;
    readonly picid: number | null;
    readonly redirectMapid: number | null;
}

export interface RawUserpics {
    readonly pictures: readonly RawUserpic[];
    readonly mappings: readonly RawUserpicMap[];
}

export interface RawTags {
    readonly definitions: readonly {readonly kwid: number; readonly parentkwid: number | null;
        readonly display: boolean; readonly name: string}[];
    readonly summaries: readonly {readonly kwid: number; readonly security: string; readonly count: number}[];
    readonly associations: readonly {readonly jitemid: number; readonly kwid: number}[];
}

export interface RawFeatureCounts {
    // All primary sysban rows with byte-exact what="spamreport" and value equal
    // to the canonical journal username, without status/date filtering. Count only: no ban
    // rows/notes enter the snapshot or child. Include in the full fingerprint.
    // EntryPage requires zero; RecentPage admission does not gate on this count.
    readonly spamreportBans: number;
    readonly usertags: number;
    readonly userkeywords: number;
    readonly logtags: number;
    readonly logtagsrecent: number;
    readonly logkwsum: number;
    readonly links: number;
    readonly userpics: number;
    readonly comments: number; // talk rows, not cache-authoritative replycount
}

export interface RawCalendarMonth {
    readonly year: number;
    readonly month: number; // 0 preserves the latest-year/future-only-month case
}

export interface RawCalendarSummary {
    readonly current: RawCalendarMonth;
    readonly days: readonly {readonly day: number; readonly count: number}[]; // <=31
    readonly previous: RawCalendarMonth | null;
    readonly next: RawCalendarMonth | null;
    // Only contributors to these visible calendar facts/selection witnesses,
    // never a new unsupported-state scan over unrelated journal history.
    // Raw statuses remain policy-visible; no contributor body text is loaded.
    readonly entryStatusCounts: readonly {
        readonly statusvis: string | null;
        readonly count: number;
    }[];
    readonly otherPosterCount: number;
}

export type RawEntryHeader = Pick<RawEntry,
    "journalid" | "jitemid" | "anum" | "posterid" | "eventtime" | "logtime" |
    "rlogtime" | "revttime" | "year" | "month" | "day" | "security" |
    "allowmask" | "replycount" | "compressed">;

export interface RawPageRequest {
    readonly username: string;
    readonly calendarNow: RawCalendarMonth; // same captured UTC clock as rendering
    readonly page:
        | {readonly kind: "recent"; readonly skip: number; readonly itemshow: number}
        | {readonly kind: "entry"; readonly ditemid: number};
}

export type RawPageSelection =
    | {
        readonly kind: "recent";
        readonly pageSkip: number;
        readonly loadSkip: number;
        readonly itemshow: number;
        readonly maxScrollback: number;
        // Source anonymous public predicate BEFORE LIMIT(loadSkip,itemshow+1).
        readonly window: readonly RawEntryHeader[];
        // Source same-minute reorder AFTER SQL LIMIT, then drop lookahead.
        // Policy independently proves exact membership/order against window.
        readonly selectedJitemids: readonly number[];
    }
    | {
        readonly kind: "entry";
        readonly ditemid: number;
        readonly target: RawEntryHeader;
    };

export interface RawMoods {
    readonly moods: readonly {readonly id:number; readonly name:string|null; readonly parent:number}[];
    readonly theme: {readonly id:number; readonly name:string|null} | null;
    readonly pictures: readonly {readonly moodid:number; readonly url:string|null; readonly width:number; readonly height:number}[];
}

export interface RawJournalSnapshot {
    readonly request: RawPageRequest;
    readonly selection: RawPageSelection;
    readonly owner: RawUser;
    readonly posters: readonly RawUser[];
    readonly style: RawStyle | null;
    // Complete displayed public entries only. No text for private/wrong-anum
    // targets, lookahead-only rows, or unrelated older entries.
    readonly entries: readonly RawEntry[];
    readonly calendar: RawCalendarSummary;
    readonly features: RawFeatureCounts;
    readonly userpics: RawUserpics;
    readonly links: readonly RawLink[];
    readonly tags: RawTags;
    readonly moods: RawMoods;
    readonly fingerprint: string;
}

export interface RawRecentRepository {
    // Primary SELECTs only; zero cache operations. null for missing exact owner
    // or missing/wrong-anum/private/usemask Entry target. Unknown states refuse.
    // No total-history limit: bounded request window, selected body/props and
    // calendar aggregates. Missing required selected rows/invalid bytes refuse.
    // Configured global primary brackets a cluster read-only consistent snapshot.
    // All relevant identities/mappings/move facts/settings/style/selected window,
    // source bytes, props/status/posters/features/calendar contribute
    // to validation. No distributed transaction or arbitrary ABA guarantee.
    loadRawSnapshot(request: RawPageRequest): Promise<RawJournalSnapshot | null>;
    // Independently reread complete request dependencies AFTER buffering HTML.
    // Changed/removed relevant data returns false. I/O rejects. This is the
    // LAST await before send, after complete HTML has been buffered.
    // Commits after each final read/network delivery are outside the guarantee.
    revalidateFingerprint(snapshot: RawJournalSnapshot): Promise<boolean>;
    close(): Promise<void>;
}

export interface PlaceholderResolutionSpec {
    readonly descriptor: {
        readonly src: string;
        readonly width: number;
        readonly height: number;
        readonly altKey: string;
    };
    readonly defaultLang: string;
    readonly isDevServer: boolean;
    readonly languageFiles: readonly string[]; // source-resolved ordered .dat files
}

export interface PlaceholderResolver {
    // Parent startup: one key, normal DB/file precedence, no helper allocation,
    // visible UPDATE, source persistence or cache calls. Public attribute text
    // follows the qualified native helper projection; never prepared HTML.
    resolvePlaceholder(spec: PlaceholderResolutionSpec): Promise<{
        readonly alt: string;
        readonly title: string;
    }>;
}

export interface LocalSecret {
    readonly stime: number;
    readonly secret: Uint8Array;
}

export interface LocalSecretSource {
    // Never included in RawJournalSnapshot, renderer inputs, logs or errors.
    // Latest existing whole-hour secret <= current hour, within maxAgeSeconds. No writes.
    // null means no usable key; policy returns unavailable. Throw RepositoryError
    // for malformed local source data (unsupported) or I/O failures (unavailable).
    loadLatestSecret(nowSeconds: number, maxAgeSeconds: number): Promise<LocalSecret | null>;
}

export interface AnonymousRecentRequest {
    readonly uniqCookie: string | null; // parsed anonymous form-cookie value only
    readonly method: "GET" | "HEAD";
    readonly username: string; // source-canonical username, no fixture enrollment
    readonly skip: number; // canonical nonnegative safe integer; source clamping later
    readonly skipPresent: boolean; // absent query=false; canonical explicit skip (including 0)=true
}

// Exact /users/<canonical-username>/<decimal>.html, GET/HEAD, no query or alias.
export interface AnonymousEntryRequest {
    readonly uniqCookie: string | null; // parsed anonymous form-cookie value only
    readonly method: "GET" | "HEAD";
    readonly username: string;
    // log2 jitemid is MEDIUMINT UNSIGNED and anum TINYINT: 1..4294967295.
    // Select using floor(ditemid / 256) and ditemid % 256, never JS bitwise math.
    // Positive IDs below 256 select no row and return the fixed not-found result.
    readonly ditemid: number;
}

export type LiveFailure = "not-found" | "unsupported" | "changed" | "unavailable";
export type LiveResult =
    | { readonly ok: false; readonly reason: LiveFailure }
    | { readonly ok: true; readonly html: string; readonly setCookie: string | null };

export interface AnonymousRecentService {
    // HEAD performs the same authorization/render/recheck as GET. Server strips
    // the body and preserves status/headers, including the private cache policy.
    serve(request: AnonymousRecentRequest): Promise<LiveResult>;
    // Same HEAD/recheck semantics. For a successfully loaded snapshot, missing,
    // wrong-anum and private/usemask targets return not-found before preparation;
    // an exact public target requires supported selected data and page features.
    serveEntry(request: AnonymousEntryRequest): Promise<LiveResult>;
    // Stop new renders and close active renderer children. Repository lifetime
    // remains server-owned; this does not close the repository or secret source.
    close(): Promise<void>;
}

// Data-boundary errors have safe fixed messages without SQL, rows or secrets.
// Decode/null/overflow/topology failures are unsupported; I/O/timeouts unavailable.
// Both repository and secret source throw this shape. Policy maps unknown errors
// to unavailable and never discloses error.message to HTTP clients.
export interface RepositoryError extends Error {
    readonly name: "RepositoryError";
    readonly kind: "unsupported" | "unavailable";
}

// Public values only. Explicit origins/prefixes and source journal URL rules;
// never derive navigation from an untrusted Host. Private keys/paths/credentials
// and request identity never enter this object. No same-host/loopback assumption.
export interface JournalUrlConfiguration {
    readonly protocol: "http" | "https";
    readonly domain: string;
    readonly isDevServer: boolean;
    readonly subdomainRules: Readonly<Record<string, readonly [boolean, string]>>;
    readonly hookConfigured: boolean;
}

export interface PublicAppConfig {
    // Public source facts and startup-resolved placeholder text, never HTML.
    // This private viewer defers proxying, even if the retained app enables it.
    // Original URLs retain sanitation/unsafe-URL and declared known-HTTPS rules.
    readonly entryContent: {
        readonly imagePlaceholder: ImagePlaceholder;
        readonly urls: EntryContentContext["urls"] & {readonly imageProxy: "not-configured"};
    };
    readonly canonicalAppOrigin: string;
    readonly listenOrigin: string;
    readonly siteRoot: string;
    readonly statPrefix: string;
    readonly jsPrefix: string;
    readonly userDomain: string;
    readonly journalUrls: JournalUrlConfiguration;
    readonly usernameMaxLength: number;
    readonly maxScrollback: number;
    readonly imgPrefix: string;
    readonly palImgRoot: string;
    readonly userpicRoot: string;
    readonly userpicUrlHookConfigured: boolean;
    readonly tagsEnabled: boolean;
    readonly tagListHookConfigured: boolean;
    readonly siteName: string;
    readonly siteNameShort: string;
    readonly siteNameAbbrev: string;
    readonly appleTouchIcon: string;
    readonly facebookPreviewIcon: string;
}

export interface RedirectAdmissionRequest {
    readonly method: string;
    readonly rawTarget: string; // original path/query before decoding; never a body
    readonly host: string;
    readonly origin: string | null;
    readonly hasForwardedHeaders: boolean;
    readonly hasAuthorization: boolean;
    readonly cookieHeader: string | null; // admission only; never log or render
}

export type RedirectAdmissionDecision =
    | { readonly kind: "recent"; readonly request: AnonymousRecentRequest }
    | { readonly kind: "entry"; readonly request: AnonymousEntryRequest }
    | { readonly kind: "reject" } // fixed safe response; no Location
    | { readonly kind: "redirect"; readonly status: 302 | 307; readonly location: string };

// Pure synchronous admission of the finite method/path/query inventory emitted
// by the admitted stock pages. The admission policy validates Host/Origin/cookie/
// auth/forwarded headers and rejects ambiguous paths,
// arbitrary destinations and unknown requests. Location uses canonicalAppOrigin
// and admitted path/query only. Exact recent/entry routes continue ordinary policy
// and are never redirected as a rendering fallback.
// The server calls this before body parsing/logging and only applies the decision.
// The server passes request unchanged to service.serve or service.serveEntry;
// admission alone parses cookies, query, method and ID. The server never reparses.
// POST controls require 307; no request body, local signing/DB secrets, I/O or
// proxy enter this seam. Incoming cookies are untrusted admission input only.
// Recheck the observed inventory after seeding before implementing either side.
export type RedirectAdmission =
    (request: RedirectAdmissionRequest) => RedirectAdmissionDecision;

// policy/redirects.ts exports createRedirectAdmission. The server's earliest hook
// delegates all admission to this module; it does not duplicate the allowlist.
export type CreateRedirectAdmission = (config: PublicAppConfig) => RedirectAdmission;

export interface CompiledStockArtifact {
    // Local source-derived artifact, read/validated once at service creation;
    // contains only pinned code + declared metadata, never prepared render data.
    readonly path: string;
}

export interface RenderLimits {
    readonly timeoutMs: number; // positive, <=10000
    readonly maxOutputBytes: number; // positive, <=2097152
    readonly maxHeapMiB: number; // positive, <=128
}

export interface AnonymousRecentServiceDeps {
    readonly repository: RawRecentRepository;
    readonly secretSource: LocalSecretSource;
    readonly artifact: CompiledStockArtifact;
    readonly config: PublicAppConfig;
    readonly limits: RenderLimits;
    readonly capabilities: SourceCapabilities;
    // Disallow injected/frozen entropy in the ordinary factory, even via spread.
    readonly clock?: never;
    readonly random?: never;
    readonly comparison?: never;
}

export interface ComparisonClock {
    nowSeconds(): number;
}

export interface ComparisonRandom {
    randomBytes(length: number): Uint8Array;
}

export interface PerlComparisonInputs {
    readonly purpose: "offline-perl-comparison";
    readonly clock: ComparisonClock;
    readonly random: ComparisonRandom;
}

// policy/service.ts exports createAnonymousRecentService with this type.
// It always obtains clock and cryptographic entropy internally from live system
// sources. The ordinary server imports only this factory; no comparison flag,
// environment toggle, HTTP parameter or config value selects a frozen source.
export type CreateAnonymousRecentService =
    (deps: AnonymousRecentServiceDeps) => Promise<AnonymousRecentService>;

// policy/comparison.ts exports createComparisonRecentService with this
// type. Only offline check-live harness imports that separate entrypoint.
export type CreateComparisonRecentService =
    (deps: AnonymousRecentServiceDeps, inputs: PerlComparisonInputs) =>
        Promise<AnonymousRecentService>;

// Renderer types live in render/, not this data/domain contract. Inputs must be
// new approved objects: no RawUser/RawEntry spread, raw props, fingerprint,
// query capability, environment or secrets. Signed token is a public form value.
