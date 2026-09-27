// general-subject-types.ts
//
// Neutral native subject values and named public-helper dependencies.
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
import type { PageChunk, PageOutputLimits } from './page-output-types';
export type SubjectExceptionEffect = {
    readonly kind: 'none';
} | {
    readonly kind: 'cleared';
} | {
    readonly kind: 'set';
    readonly message: PageChunk;
};
export interface SubjectHelperResult<T> {
    readonly value: T;
    readonly exceptionEffect: SubjectExceptionEffect;
}
// CLEAN_link accepts a digits-only scalar equal to 1 unchanged; other Perl-true
// scalars are replacement URLs (all non-boolean numerics use their native PV). Empty and literal byte-string '0' are Perl-false.
export type SubjectStylesheetDecision = undefined | 0 | 1 | PageChunk;
export interface SubjectUserOptions {
    readonly site?: PageChunk;
    readonly textonly: boolean;
    readonly preserve_lj_tags_for: 0;
    readonly no_ljuser_class: 0;
    readonly no_link: boolean;
}
// Neutral equivalents of HTML::TokeParser tokens passed to transform_embed.
export type SubjectEmbedToken = readonly [
    'S',
    string,
    Readonly<Record<string, PageChunk>>,
    readonly string[],
    PageChunk
] | readonly [
    'E',
    string,
    PageChunk
] | readonly [
    'T',
    PageChunk,
    boolean
];
export interface GeneralSubjectOptions {
    // Bound by the installed interpreter profile, never the JavaScript Unicode version.
    readonly characterClass: (kind: 'word' | 'space', codepoint: number, utf8: boolean) => boolean;
    readonly mode: 'subject' | 'all';
    readonly limits: PageOutputLimits;
    readonly normalizeImageUrl: (url: PageChunk) => SubjectHelperResult<PageChunk>;
    readonly rewriteBlockedHref: (href: PageChunk) => SubjectHelperResult<PageChunk>;
    readonly embedTransform?: (tokens: readonly SubjectEmbedToken[], options: {
        readonly nocheck: 0;
        readonly wmode: undefined;
    }) => SubjectHelperResult<PageChunk | undefined>;
    readonly expandSiteUrl: (path: PageChunk) => SubjectHelperResult<PageChunk>;
    readonly expandUser: (originalName: PageChunk | undefined, options: SubjectUserOptions) => SubjectHelperResult<PageChunk>;
    readonly templateError: (name: PageChunk) => SubjectHelperResult<PageChunk>;
    readonly videoError: () => SubjectHelperResult<PageChunk>;
    readonly markupError: (tag: PageChunk) => SubjectHelperResult<PageChunk>;
    readonly validStylesheet: (href: PageChunk, host: PageChunk, path: PageChunk) => SubjectHelperResult<SubjectStylesheetDecision>;
}
export interface GeneralSubjectResult {
    readonly value: PageChunk;
    readonly clearsException: boolean;
    readonly exceptionEffect: SubjectExceptionEffect;
}
