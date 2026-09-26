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

import type { InertEntryMetadata, SubjectPreparation } from "@dreamwidth/content/contracts";
import type { PublicAppConfig } from "../contracts";

export interface ApprovedUserpic {
    readonly picid: number;
    readonly width: number;
    readonly height: number;
    readonly description: string;
    readonly keyword: string | null;
}

export interface ApprovedTag {
    readonly id: number;
    readonly name: string;
}
export interface ApprovedTagDetail extends ApprovedTag {
    readonly count: number;
}

export interface ApprovedEntry {
    readonly id: number;
    readonly subject: string;
    readonly moodName?: string; // numeric fallback after child custom-mood preparation
    readonly crosspostUrls?: readonly string[]; // approved URL data; never source HTML/binary
    readonly moodIcon?: {readonly url:string; readonly width:number; readonly height:number};
    readonly currents?: Readonly<Record<string,string>>; // RAW textual currents, child-only preparation
    readonly rawBody: string; // tainted; only child cleaner may prepare entry text
    readonly eventtime: string;
    readonly logtime: string;
    readonly reverseTime: number;
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly commentsEnabled: boolean;
    readonly commentsAtMax?: boolean;
    readonly replycount?:number;
    readonly commentsDisabledMaintainer?:boolean;
    readonly tags: readonly ApprovedTag[];
    readonly userpic: ApprovedUserpic | null;
}
export interface ApprovedLink {
    readonly title: string;
    readonly url: string;
    readonly hover: string;
    readonly isHeading: boolean;
}

export interface ApprovedComment {
    readonly id:number; readonly parentId:number; readonly state:"A"|"F"|"S"|"D";
    readonly suspended:boolean; readonly full:boolean; readonly subjectOnly:boolean;
    readonly subject:string; readonly rawBody:string|null; readonly datepost:string;
    readonly author:{readonly userid:number;readonly username:string;readonly name:string;
        readonly timezone:string|null;readonly journalType:string;readonly userpic:ApprovedUserpic|null}|null;
    readonly props:Readonly<Record<string,string|null>>;
    readonly replies:readonly ApprovedComment[];
    readonly showableChildren:number;
}
export interface ApprovedComments {
    readonly roots:readonly ApprovedComment[];
    readonly page:number;readonly pages:number;readonly first:number;readonly last:number;
    readonly items:number;readonly collapsed:boolean;readonly thread:number;
    readonly expandAllowed:boolean;readonly expanderAllowed:boolean;
}

export interface ApprovedJournal {
    readonly comments?:ApprovedComments;
    readonly customtextProperties?: import("../domain/property-layer").CustomtextProperties;
    readonly customtextStored?: {readonly title:string|null;readonly url:string|null;readonly content:string|null};
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
    readonly websiteUrl: string;
    readonly websiteName: string;
    readonly links: readonly ApprovedLink[];
    readonly sidebarTags: readonly ApprovedTagDetail[];
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
    | { readonly kind: "entry"; readonly ditemid: number; readonly comments?:import("../contracts").CommentQuery };

// These callbacks/results exist only inside the credential-free render child.
// The worker derives both independently from the approved raw entry. The engine
// consumes body HTML in body context and inert metadata at the escaped OG
// attribute boundary. Neither fragment nor helper string returns to the parent.
export interface RenderContentPreparation {
    customtext?(source:string):string;
    comment?(comment:ApprovedComment,entryUrl:string):string;
    subject(entry: ApprovedEntry, entryUrl: string, source?: string): SubjectPreparation;
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
