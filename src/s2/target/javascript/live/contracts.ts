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
    readonly hasBio: string;
    readonly bio: string | null; // exact dev enrollment marker; never rendered
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
    readonly styleid: number;
    readonly ownerid: number;
    readonly name: string;
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
    // All logprop names, including unsupported ones; policy rejects unsupported
    // semantic props. Values such as useragent remain policy-only, never render.
    readonly props: Readonly<Record<string, string | null>>;
    // Source bytes decoded strictly once, with bounded gzip event decompression.
    // Unknown8bit is refused before decoding, never guessed as UTF8.
    readonly subjectText: string;
    readonly eventText: string;
}

export interface RawFeatureCounts {
    // All primary sysban rows with byte-exact what="spamreport" and value equal
    // to the marked username, without status/date filtering. Count only: no ban
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

export interface RawJournalSnapshot {
    readonly owner: RawUser;
    readonly posters: readonly RawUser[];
    readonly style: RawStyle | null;
    readonly entries: readonly RawEntry[];
    readonly features: RawFeatureCounts;
    readonly fingerprint: string;
}

export interface RawRecentRepository {
    // null only for missing exact username. <=200 COMPLETE candidates, no policy
    // filtering, one primary cross-schema read-only consistent snapshot. Reject
    // >200, missing rows/fields (including NULL log2 eventtime/logtime/replycount),
    // invalid bytes, duplicate ids, unsupported engines or nonlocal topology.
    // Fingerprint includes owner, identity mapping, settings, bio, style, complete
    // layers and timestamps, posters, candidate count/rows, original text bytes,
    // decoded text, props/status/security, and each separate feature count.
    // RepositoryError distinguishes unsupported input/state from unavailable I/O.
    loadRawSnapshot(username: string): Promise<RawJournalSnapshot | null>;
    // Fresh independent primary snapshot AFTER render; false includes removal,
    // any relevant change or now unsupported state. Query failures reject.
    // Authorization decision point: policy buffers full HTML, invokes this last,
    // then returns/enqueues without any intervening asynchronous work. Later DB
    // commits and network receipt are outside this decision's atomicity claim.
    revalidateFingerprint(snapshot: RawJournalSnapshot): Promise<boolean>;
    close(): Promise<void>;
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
    readonly method: "GET" | "HEAD";
    readonly username: string; // s2js_slice3, bio marker "s2-js-slice3 live dev v1"
    readonly skip: number; // strict decimal input; 0..200 admission bound
    readonly skipPresent: boolean; // absent query=false; canonical explicit skip (including 0)=true
    readonly uniqCookie: string | null; // only parsed ljuniq value; no other cookies
}

// Exact /users/s2js_slice3/<canonical decimal>.html, GET/HEAD, no query or alias.
export interface AnonymousEntryRequest {
    readonly method: "GET" | "HEAD";
    readonly username: string;
    // log2 jitemid is MEDIUMINT UNSIGNED and anum TINYINT: 1..4294967295.
    // Select using floor(ditemid / 256) and ditemid % 256, never JS bitwise math.
    // Positive IDs below 256 select no row and return the fixed not-found result.
    readonly ditemid: number;
    readonly uniqCookie: string | null; // only parsed ljuniq; no other cookies
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
    // wrong-anum and private/usemask targets return not-found before cohort
    // preparation; an exact public target still requires the entire cohort.
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

// Public values only, validated at startup. Origins are explicit loopback URLs
// with distinct ports and no path/query/credentials; both use the same hostname
// so ljuniq reaches retained app controls. siteRoot/prefixes retain local config
// values (empty, root-relative, or canonical-origin URL), never derived from
// untrusted Host. Page markup retains natural prefixes; allowed HTTP redirects
// target canonicalAppOrigin, never proxying or processing retained-app controls.
export interface PublicAppConfig {
    // Public source-derived facts from offline local configuration, never HTML
    // or proxy credentials. Ordinary live serving asserts proxy not-configured;
    // synthetic configured-proxy qualification uses a separate host-only key.
    readonly entryContent: {
        readonly imagePlaceholder: ImagePlaceholder;
        readonly urls: EntryContentContext["urls"];
    };
    readonly canonicalAppOrigin: string;
    readonly listenOrigin: string;
    readonly siteRoot: string;
    readonly statPrefix: string;
    readonly imgPrefix: string;
    readonly palImgRoot: string;
    readonly userpicRoot: string;
    readonly siteName: string;
    readonly siteNameShort: string;
    readonly siteNameAbbrev: string;
    readonly appleTouchIcon: string;
    readonly facebookPreviewIcon: string;
    // Must be verified from the owning local app configuration before serving,
    // including absence of CAPTCHA_HCAPTCHA_SITEKEY; never an unchecked default.
    readonly anonymousCaptchaDisabled: true;
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
// new approved objects: no RawUser/RawEntry spread, raw props, bio, fingerprint,
// query capability, environment or secrets. Signed token is a public form value.
