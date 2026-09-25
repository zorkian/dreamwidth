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
    // Fingerprint includes mapping, count, all source rows and original raw bytes.
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
    loadLatestSecret(nowSeconds: number, maxAgeSeconds: number): Promise<LocalSecret | null>;
}

export interface AnonymousRecentRequest {
    readonly method: "GET" | "HEAD";
    readonly username: string; // s2js_slice3, bio marker "s2-js-slice3 live dev v1"
    readonly skip: number; // strict decimal input; 0..200 admission bound
    readonly uniqCookie: string | null; // only parsed ljuniq value; no other cookies
}

export type LiveFailure = "not-found" | "unsupported" | "changed" | "unavailable";
export type LiveResult =
    | { readonly ok: false; readonly reason: LiveFailure }
    | { readonly ok: true; readonly html: string; readonly setCookie: string | null };

export interface AnonymousRecentService {
    serve(request: AnonymousRecentRequest): Promise<LiveResult>;
}

// Renderer types live in render/, not this data/domain contract. Inputs must be
// new approved objects: no RawUser/RawEntry spread, raw props, bio, fingerprint,
// query capability, environment or secrets. Signed token is a public form value.
