// state.ts
//
// What builtins need while a page renders: the page itself, the site chrome
// Perl adds around S2, and data loaded before rendering for builtins that
// would otherwise query the database.
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
import type { Site, User } from "../data/user";
import type { S2Object } from "./objects";
import type { PageOutput } from "./output-cleaner";

export interface Chrome {
    controlStrip(): string;
    controlStripUserpicCss(full: boolean): string;
    scriptTags(): string;
    quickreplyDiv(page: S2Object): string;
    replyForm(): string;
    ljuser(userid: number, linkColor: string): string;
    userLink(props: Record<string, unknown>, user: S2Object, key: string): S2Object;
    tagsText(props: Record<string, unknown>, tags: S2Object[]): string;
}

export interface RenderState {
    readonly site: Site;
    readonly config: SiteConfig;
    readonly journal: User;
    readonly output: PageOutput;
    readonly chrome: Chrome;
    readonly showControlStrip: boolean;
    readonly showThreadExpander: boolean;
    page(): S2Object;
    siteRoot(): string;
    userBase(user: string): string | undefined;
    userLite(user: string): S2Object | undefined;
    visibleTags(limit: number): S2Object[];
    latestMonth(): S2Object;
    journalCurrentDateTime(): S2Object;
}
