// adult-content.ts
//
// Which adult content warning a viewer must pass before a journal or entry,
// as DW::Logic::AdultContent decides it.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import type { SiteConfig } from "../server/config";
import type { Databases } from "./db";
import type { Entry } from "./entry";
import type { User } from "./user";

export type InterstitialType = "explicit_blocked" | "explicit" | "concepts";

// DW::Logic::AdultContent::interstitial_type. The pages a viewer has already
// confirmed are kept by Perl in memcache, so a warning given here may be one
// the viewer has passed.
export async function interstitialType(db: Databases, config: SiteConfig,
    { user, journal, entry }: { user: User | null; journal: User; entry?: Entry }): Promise<InterstitialType | undefined> {
    if (!config.enabled.adult_content || !journal.isVisible()) return undefined;
    if (entry && !await entry.visibleTo(db, user)) return undefined;
    if (user && (await user.canManage(db, journal) || entry && user.userid === entry.posterid)) return undefined;

    await journal.loadProps(db, ["adult_content"]);
    const level = entry?.adultContentCalculated() || journal.adultContentCalculated();
    if (level === "none") return undefined;

    // A confirmation is a viewing preference, never proof that a minor is eligible.
    if (level === "explicit" && user && await user.isMinor(db)) return "explicit_blocked";
    const hide = user ? await user.hideAdultContent(db) : "concepts";
    if (level === "explicit" && hide !== "none") return "explicit";
    if (level === "concepts" && hide === "concepts") return "concepts";
    return undefined;
}
