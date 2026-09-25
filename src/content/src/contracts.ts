// contracts.ts
//
// Context-specific entry cleaning and isolated render-worker boundaries.
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

export type EntryPolicyId = "dreamwidth-entry-html-raw0-v1";
export interface EntryReaderOptions {
    readonly removeColors: boolean;
    readonly removeSizes: boolean;
    readonly removeFonts: boolean;
    readonly maxImageWidth: number | null;
    readonly maxImageHeight: number | null;
    readonly placeholderUndefinedImageSize: boolean;
    readonly extractImages: boolean;
}
// Public fields derived from LJ::img("placeholder"), never prepared HTML.
export interface ImagePlaceholder {
    readonly src: string;
    readonly width: number;
    readonly height: number;
    readonly alt: string;
    readonly title: string;
}
export type EntryCutContext = "source-compatible-recent" | "source-compatible-entry";

export interface EntryContentContext {
    readonly policy: EntryPolicyId;
    readonly insertionContext: "html-div-flow";
    readonly documentUrl: string; // canonical retained document URL, including admitted query
    readonly entryUrl: string; // retained entry permalink for cut links; distinct from documentUrl
    readonly journalUsername: string;
    readonly journalId: number;
    readonly entryId: number;
    readonly reader: EntryReaderOptions;
    readonly imagePlaceholder: ImagePlaceholder;
    readonly cuts: EntryCutContext; // recent omits cut bodies; entry cleans and displays them fully
    readonly urls: {
        readonly siteDomain: string;
        readonly knownHttpsSites: readonly string[];
        // Exact lowercased host keys from FORM_DOMAIN_BANNED. Validate form
        // action/formaction before relative URL adaptation; absent/relative
        // action is not made admissible by first resolving it to an absolute URL.
        readonly formDomainBanned: readonly string[];
        readonly imageProxy: "not-configured" | "host-resolved";
    };
}
// URL policy covers a/area href, img src/srcset/longdesc, image-input src,
// form action, button/input formaction, blockquote/q/del/ins cite and
// table/td/th background. Fragment-only href and local usemap remain local;
// other relative URLs resolve against documentUrl. Image https/proxy handling
// is separate from inline CSS URLs. CSS custom values also require parsed URL/
// escaped-token inspection; unchecked Raw syntax is not a safe-value boundary.
// Audio/video/source/track are unsupported. Other active URL capabilities need
// explicit refusal or a documented security removal, never implicit admission.
export interface EntryContentInput {
    readonly body: string; // RAW, untrusted UTF8 text; explicitly not safe HTML
    readonly format: "html_raw0";
    readonly context: EntryContentContext;
}
export interface CleanerLimits {
    readonly maxInputBytes: number;
    readonly maxOutputBytes: number;
    readonly maxNodes: number;
    readonly maxDepth: number;
    readonly maxCssBytes: number;
    readonly maxCssNodes: number;
    readonly maxImageCandidates: number;
    readonly maxCuts: number; // first milestone <=16 flat balanced cuts per entry
}
export interface ImageRequest {
    readonly ordinal: number;
    readonly attribute: "src" | "srcset";
    readonly url: string; // parsed, entity-decoded, canonicalized HTTP image URL
    // Tainted source provenance, independently verified against approved input.
    // Offsets are UTF16 code-unit offsets, start inclusive/end exclusive, into
    // body; sourceText must equal that slice. The span covers the raw attribute
    // value, excluding quotes; srcset candidates can share that full-value span.
    // Host verifies HTML entity decoding and src/srcset candidate membership,
    // count, scheme, context hash and ordinal bijection before image signing.
    // It never trusts a child-supplied URL or hash as authorization by itself.
    readonly sourceStart: number;
    readonly sourceEnd: number;
    readonly sourceText: string;
}
export interface ImageRequestSet {
    readonly inputSha256: string; // body + canonical fixed-policy context
    readonly requests: readonly ImageRequest[];
}
export interface ImageResolutionSet {
    readonly inputSha256: string;
    readonly images: readonly { readonly ordinal: number; readonly url: string }[];
}
declare const bodyFragmentBrand: unique symbol;
export interface BodyFragment {
    readonly [bodyFragmentBrand]: true;
    readonly context: "html-div-flow";
    readonly html: string;
}
export interface ContentProvenance {
    readonly policy: EntryPolicyId;
    readonly inputSha256: string;
    readonly outputSha256: string;
    readonly cutsOmitted: number;
}
export type EntryContentResult =
    | { readonly kind: "ok"; readonly fragment: BodyFragment; readonly provenance: ContentProvenance }
    | { readonly kind: "image-resolution-required"; readonly images: ImageRequestSet }
    | { readonly kind: "failure"; readonly reason: "unsupported" | "unavailable" };
// These source-helper strings are inert data, even when they contain serialized
// markup or entities. They are never BodyFragment or safe HTML. Only the child
// OG helper consumes them, applying source collapse/trim and attribute escaping.
export interface InertEntryMetadata {
    readonly kind: "inert-entry-metadata";
    readonly subjectText: string;
    readonly eventText: string;
}
export interface EntryMetadataInput {
    readonly subject: string; // raw subject under the existing plain-subject gate
    readonly entry: EntryContentInput; // raw body; requires source-compatible-entry cuts
}
export type EntryMetadataResult =
    | { readonly kind: "ok"; readonly metadata: InertEntryMetadata }
    | { readonly kind: "failure"; readonly reason: "unsupported" | "unavailable" };
export interface EntryCleaner {
    // Runs ONLY in a credential-free bounded worker. No caller DOM or hooks.
    // When needed, a second call uses the exact same input plus host resolutions.
    // DOM/CSS transforms precede final DOMPurify; no output string patching.
    clean(input: EntryContentInput, images?: ImageResolutionSet): EntryContentResult;
    // Derive directly from raw data inside the same bounded worker, independently
    // of displayed HTML. No DOM textContent substitute, body reuse or parent IPC.
    metadata(input: EntryMetadataInput): EntryMetadataResult;
    close(): void;
}
export type CreateEntryCleaner = (limits: CleanerLimits) => EntryCleaner;

// Operational ceilings: 64KiB raw body, 2MiB cohort, 1KiB plain subject;
// depth 16, nodes 4096, CSS 64KiB/4096 AST nodes, images 256, cuts 16.
// These are resource limits, not CSS property or formatting allowlists.
// Cuts admit explicitly closed flat lj-cut/cut/div[class=ljcut] in ordinary
// flow. Nested/crossing/unclosed/rawtext/table/foreign or ambiguously repaired
// boundaries are unsupported. Recent mode omits hidden bodies and keeps retained
// wrappers/labels/generated IDs and entryUrl links. Entry mode cleans the full
// body, emits name=cutidN anchors and retains div.ljcut wrappers. Source IDs are
// removed first; names never confer generated widget or ID authority. Native
// div.ljcut full output gains another anchor on raw re-entry; this is an explicit
// generated-cut transform exception, not a claim of byte idempotence.
// Ordinary classes and safe named anchors are preserved. No expansion endpoint
// is supplied by this package. Subjects use a separate existing plain gate.

// Export declarations through @dreamwidth/content/contracts. Host imports are
// type-only: DOM/CSS libraries load exclusively inside the bounded worker.
export interface ContentWireEntry {
    readonly key: string; // bounded host-generated per-entry job key
    readonly input: EntryContentInput;
}
export interface ContentWireInput {
    readonly version: 1;
    readonly kind: "clean-entries";
    readonly jobId: string;
    readonly entries: readonly ContentWireEntry[];
}
export interface ContentWireImages {
    readonly version: 1;
    readonly kind: "resolve-images";
    readonly jobId: string;
    readonly entries: readonly {
        readonly key: string;
        readonly resolutions: ImageResolutionSet;
    }[];
}
export type ContentWireRequest = ContentWireInput | ContentWireImages;
export type ContentWireResult =
    | { readonly version: 1; readonly kind: "image-resolution-required";
        readonly jobId: string; readonly entries: readonly {
            readonly key: string; readonly images: ImageRequestSet;
        }[] }
    | { readonly version: 1; readonly kind: "complete"; readonly jobId: string;
        readonly entries: readonly { readonly key: string; readonly html: string;
            readonly provenance: ContentProvenance }[] }
    | { readonly version: 1; readonly kind: "failure"; readonly jobId: string;
        readonly reason: "unsupported" | "unavailable" };
// Wire html deliberately has NO brand. Decoding JSON never confers safe-context
// authority. Standalone worker harness may inspect it; the S2 worker calls the
// same library internally and consumes the branded result without roundtripping
// through parent credentials. S2 render IPC embeds only the above ImageRequestSet/
// ImageResolutionSet exchange and returns one complete page/fixed failure.
// Wire decoder validates exact versions/shapes, finite counts/bytes/job/key sets;
// one optional image exchange, no partial completion or per-entry fallback.

// The stock artifact absolute path A determines the closed root A + ".runtime"
// and manifest A + ".runtime/manifest.json". No caller-supplied root authority.
// One render worker imports this package and then executes stock Page.print.
export interface RenderWorkerManifest {
    readonly schema: 1;
    readonly artifactSha256: string;
    readonly contentLockSha256: string;
    readonly nodeVersion: "24.21.0";
    readonly nodeExecutable: string; // absolute independently verified bootstrap binary
    readonly entryPath: "app/dist/live/render/worker.js";
    readonly files: readonly {
        readonly path: string; // unique normalized root-relative regular file
        readonly sha256: string;
        readonly bytes: number;
    }[];
}
// Manifest excludes itself and is atomically published. Startup verifies artifact/
// lock digests, executable, file hashes, ownership/modes and complete closed-root
// inventory. Reject symlinks, native addons, path escape, unlisted files, app
// credentials and browser dependencies. Only then grant this derived root read
// access. Stock artifact and existing sandbox launcher stay outside the closure.
// Layout preserves app/dist/live/render relative imports into app/dist/runtime
// and required pure app/dist/live/policy modules. Shared content lives under
// app/node_modules/@dreamwidth/content with only locked production dependencies.
// Existing seccomp, minimal environment, no-write/addon/child/worker/network
// denials remain. One total 10000ms deadline covers loading, DOM/CSS work, optional
// image resolution and stock Page.print, with 128MiB heap and 2MiB final output.
