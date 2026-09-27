// general-journal-admission.ts
//
// Anonymous journal privacy gate before any active program initialization.
//
// Portions adapted from LJ::User::Styles and LJ::User::Account, forked from the
// LiveJournal project owned and operated by Live Journal, Inc., and modified
// and expanded by Dreamwidth Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, this code and its modifications are provided
// under the GNU General Public License. See LICENSE in this distribution.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//

// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.
// The inherited notice above applies to adapted LiveJournal portions.
//

import type {NativeJournalAuthority} from "../contracts";

export type GeneralJournalPrivacyFailure = "deleted" | "suspended" | "purged" | "identity-view" | "adult-content";
/** Email validation and ordinary style/settings are not journal read authority. */
export function generalJournalPrivacy(snapshot: NativeJournalAuthority): GeneralJournalPrivacyFailure | undefined {
    // User/Styles.pm842-860; anonymous Recent/Entry has no privileged bypass.
    if (snapshot.statusvis === "D") return "deleted";
    if (snapshot.statusvis === "S") return "suspended";
    if (snapshot.statusvis === "X" || snapshot.clusterid === 0) return "purged";
    if (snapshot.journaltype === "I") return "identity-view";
    // Retained private-viewer policy: no adult interstitial implementation.
    // This is independent of the source journal/style execution capability.
    const adult = snapshot.publicSettings?.adult_content;
    if (adult && adult !== "0" && adult !== "none") return "adult-content";
    return undefined;
}
