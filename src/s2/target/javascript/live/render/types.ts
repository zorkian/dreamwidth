// types.ts
//
// Bounded local S2 journal policy and rendering support.
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

import type { InertEntryMetadata } from "@dreamwidth/content/contracts";
import type { PublicAppConfig } from "../contracts";

export interface ApprovedUserpic {
    readonly picid: number;
    readonly width: number;
    readonly height: number;
    readonly description: string;
    readonly keyword: string | null;
}

export interface ApprovedEntry {
    readonly id: number;
    readonly subject: string;
    readonly rawBody: string; // tainted; only child cleaner may prepare entry text
    readonly eventtime: string;
    readonly logtime: string;
    readonly reverseTime: number;
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly commentsEnabled: boolean;
    readonly userpic: ApprovedUserpic | null;
}
export interface ApprovedJournal {
    readonly userid: number;
    readonly username: string;
    readonly name: string;
    readonly title: string;
    readonly subtitle: string;
    readonly baseUrl: string; // source-derived canonical journal base
    readonly styleid: number;
    readonly styleTime: number;
    readonly showControlStrip: boolean;
    readonly controlStripColor: "dark" | "light";
    readonly blockRobots: boolean;
    readonly entries: readonly ApprovedEntry[];
    readonly calendar: ApprovedCalendar;
    readonly defaultUserpic: ApprovedUserpic | null;
}
export interface ApprovedCalendar {
    readonly year: number;
    readonly month: number;
    readonly days: readonly {readonly day: number; readonly count: number}[];
    readonly previous: {readonly year: number; readonly month: number} | null;
    readonly next: {readonly year: number; readonly month: number} | null;
}

export type RenderPage =
    | { readonly kind: "recent";
        readonly pageSkip: number;
        readonly itemshow: number;
        readonly maxScrollback: number;
        readonly hasPrevious: boolean }
    | { readonly kind: "entry"; readonly ditemid: number };

// These callbacks/results exist only inside the credential-free render child.
// The worker derives both independently from the approved raw entry. The engine
// consumes body HTML in body context and inert metadata at the escaped OG
// attribute boundary. Neither fragment nor helper string returns to the parent.
export interface RenderContentPreparation {
    body(entry: ApprovedEntry, entryUrl: string): string;
    metadata(entry: ApprovedEntry, entryUrl: string): InertEntryMetadata;
}

export interface RenderInput {
    readonly page: RenderPage;
    readonly journal: ApprovedJournal;
    readonly config: PublicAppConfig;
    // Entry requests require exactly skip=0 and skipPresent=false. Admission,
    // service and worker enforce this; the page discriminator is not inferred.
    readonly skip: number;
    readonly skipPresent: boolean;
    readonly nowSeconds: number;
    readonly formChallenge: string;
    readonly uniq: string;
    readonly resourceTimes: Readonly<Record<string, number>>;
}
export interface Artifact {
    readonly schema: 1;
    readonly abi: 1;
    readonly layers: readonly {
        readonly source: string;
        readonly sourceHash: string;
        readonly variable: string;
        readonly code: string;
    }[];
}

// One child per request. A <=128-byte JSON status line precedes complete raw
// UTF8 HTML (success only); no JSON expansion of the bounded 2MiB HTML payload.
export type RendererHeader =
    | {readonly version: 2; readonly kind: "complete"}
    | {readonly version: 2; readonly kind: "failure"; readonly reason: "unsupported" | "unavailable"};
