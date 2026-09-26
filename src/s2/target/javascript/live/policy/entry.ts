// entry.ts
//
// Exact anonymous entry selection before journal-wide cohort preparation.
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

import type {RawJournalSnapshot, PublicAppConfig} from "../contracts";
import type {SourceCapabilities} from "../startup-types";
import type {ApprovedJournal} from "../render/types";
import {approveSnapshot} from "./cohort";
import {Unsupported} from "./content";

export function validEntryId(value: unknown): value is number {
    // log2: MEDIUMINT UNSIGNED jitemid and TINYINT anum. Bitwise operations
    // would truncate the highest IDs into signed32-bit values.
    return typeof value === "number" && Number.isSafeInteger(value) &&
        value >= 1 && value <= 4294967295;
}

export function approveEntrySnapshot(snapshot: RawJournalSnapshot, ditemid: number,
    config: PublicAppConfig, capabilities: SourceCapabilities): ApprovedJournal | null {
    if (!validEntryId(ditemid) || snapshot.selection.kind !== "entry" ||
        snapshot.request.page.kind !== "entry" || snapshot.selection.ditemid !== ditemid ||
        snapshot.request.page.ditemid !== ditemid) throw new Unsupported();
    const selected = snapshot.selection.target;
    // Exact identity/privacy before settings, body inspection or helper gates.
    // A real store returns null before fetching body bytes for these targets.
    if (selected.jitemid !== Math.floor(ditemid / 256) || selected.anum !== ditemid % 256 ||
        selected.security === "private" || selected.security === "usemask") return null;
    if (selected.security !== "public" || selected.journalid !== snapshot.owner.userid) throw new Unsupported();
    if (snapshot.features.spamreportBans !== 0) throw new Unsupported();
    const approved = approveSnapshot(snapshot, config, capabilities);
    if (approved.entries.length !== 1 || approved.entries[0]!.id !== ditemid) throw new Unsupported();
    return approved;
}
