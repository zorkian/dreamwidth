// page-output-types.ts
//
// Neutral scalar and application interfaces for page-local native output.
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

export interface PageChunk {readonly bytes: Uint8Array; readonly utf8: boolean;}
export interface PageOutputLimits {
    readonly maxInputBytes: number;
    readonly maxOutputBytes: number;
    readonly timeoutMs: number;
}
export interface StylesheetPolicy {
    readonly domain: string;
    readonly webDomain: string;
    readonly statPrefix: string;
    readonly trustedHosts: Readonly<Record<string, boolean>>;
    readonly cssCleanerEnabled: boolean;
    readonly cssProxy: string | null;
}
export interface PageOutputOptions {
    readonly contentType: string;
    readonly initialization?: boolean;
    readonly limits: PageOutputLimits;
    readonly stylesheet: StylesheetPolicy;
    readonly output: (chunk: PageChunk) => void;
    // These are named, trusted application operations. No stored program or
    // module name selects a callback. The coordinator supplies actual hooks.
    readonly transformCss: (chunk: PageChunk) => PageChunk;
    readonly checkDepth: () => void;
    readonly expandEmbed: (chunk: PageChunk) => PageChunk;
}
export interface PageOutput {
    beginRendering(): void;
    printRaw(chunk: PageChunk): void;
    printSafe(chunk: PageChunk): void;
    startCss(): void;
    endCss(): void;
    finish(): void;
}
