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

import type { PublicAppConfig } from "../contracts";

export interface ApprovedEntry {
    readonly id: number;
    readonly subject: string;
    readonly text: string;
    readonly eventtime: string;
    readonly logtime: string;
    readonly reverseTime: number;
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly commentsEnabled: boolean;
}
export interface ApprovedJournal {
    readonly userid: number;
    readonly username: string;
    readonly name: string;
    readonly title: string;
    readonly subtitle: string;
    readonly styleid: number;
    readonly styleTime: number;
    readonly showControlStrip: boolean;
    readonly controlStripColor: "dark" | "light";
    readonly blockRobots: boolean;
    readonly entries: readonly ApprovedEntry[];
}
export interface RenderInput {
    readonly journal: ApprovedJournal;
    readonly config: PublicAppConfig;
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
