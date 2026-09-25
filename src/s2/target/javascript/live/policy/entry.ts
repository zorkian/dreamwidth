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

import type {RawJournalSnapshot} from "../contracts";
import type {ApprovedJournal} from "../render/types";
import {approveSnapshot} from "./cohort";
import {Unsupported} from "./content";

export function validEntryId(value: unknown): value is number {
    // log2: MEDIUMINT UNSIGNED jitemid and TINYINT anum. Bitwise operations
    // would truncate the highest IDs into signed32-bit values.
    return typeof value === "number" && Number.isSafeInteger(value) &&
        value >= 1 && value <= 4294967295;
}

export function approveEntrySnapshot(snapshot: RawJournalSnapshot, ditemid: number): ApprovedJournal | null {
    if (!validEntryId(ditemid)) throw new Unsupported();
    const selected = snapshot.entries.find(entry => entry.jitemid === Math.floor(ditemid / 256));
    // Perform identity and anonymous visibility before inspecting any target
    // rendering data or applying unsupported-cohort rules. Private/usemask and
    // wrong-anum requests remain indistinguishable from missing rows.
    if (!selected || selected.anum !== ditemid % 256 ||
        selected.security === "private" || selected.security === "usemask") return null;
    if (selected.security !== "public") throw new Unsupported();
    if (snapshot.features.spamreportBans !== 0) throw new Unsupported();
    // Preserve all journal-wide gates, including other suspended public rows,
    // actual talk2 count and replycount. Only public approved bytes reach child.
    const approved = approveSnapshot(snapshot);
    if (!approved.entries.some(entry => entry.id === ditemid)) throw new Unsupported();
    return approved;
}
