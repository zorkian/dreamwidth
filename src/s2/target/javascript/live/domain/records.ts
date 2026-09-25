// records.ts
//
// Fully loaded journal records; property access never reaches the database.
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

import type { PublicSettings, RawEntry, RawUser } from "../contracts";

export class UserRecord implements RawUser {
    readonly userid!: number;
    readonly user!: string;
    readonly clusterid!: number;
    readonly status!: string;
    readonly statusvis!: string;
    readonly journaltype!: string;
    readonly name!: string;
    readonly optShowTalkLinks!: string;
    readonly optWhocanReply!: string;
    readonly optForceMoodtheme!: string;
    readonly moodthemeid!: number;
    readonly defaultpicid!: number;
    readonly dversion!: number;
    readonly caps!: string;
    readonly hasBio!: string;
    readonly bio!: string | null;
    readonly publicSettings!: PublicSettings;

    constructor(data: RawUser) {
        Object.assign(this, data);
        Object.freeze(this);
    }
}

export class EntryRecord implements RawEntry {
    readonly journalid!: number;
    readonly jitemid!: number;
    readonly anum!: number;
    readonly posterid!: number;
    readonly eventtime!: string;
    readonly logtime!: string;
    readonly rlogtime!: number;
    readonly revttime!: number;
    readonly year!: number;
    readonly month!: number;
    readonly day!: number;
    readonly security!: string;
    readonly allowmask!: string;
    readonly replycount!: number;
    readonly compressed!: string;
    readonly props!: Readonly<Record<string, string | null>>;
    readonly subjectText!: string;
    readonly eventText!: string;

    constructor(data: RawEntry) {
        Object.assign(this, data);
        Object.freeze(this);
    }
}
