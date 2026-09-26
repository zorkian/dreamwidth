// regression-config.ts
//
// Private startup config projection for retained offline regression tools.
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

import path from "node:path";
import type {PublicAppConfig, RawPageRequest} from "../live/contracts";
import {MysqlLiveStore, type MysqlStoreConfig} from "../live/data/mysql";
import {readStartupConfig} from "../live/server/startup-config";

export function regressionConfigPath(project: string): string {
    return process.env.S2_SITE_CONFIG ?? path.join(project, "artifacts/live/site-config.json");
}

export async function regressionConfig(project: string): Promise<{
    public: PublicAppConfig; credential: MysqlStoreConfig;
}> {
    const startup = readStartupConfig(regressionConfigPath(project));
    const credential: MysqlStoreConfig = {database: startup.database,
        capabilities: startup.capabilities, styles: startup.styles,
        maxScrollback: startup.app.maxScrollback};
    const store = await MysqlLiveStore.open(credential);
    try {
        const labels = await store.resolvePlaceholder(startup.placeholder);
        const descriptor = startup.placeholder.descriptor;
        return {credential, public: {...startup.app, entryContent: {
            urls: startup.app.entryContent.urls,
            imagePlaceholder: {src: descriptor.src, width: descriptor.width,
                height: descriptor.height, alt: labels.alt, title: labels.title},
        }}};
    } finally { await store.close(); }
}

export function recentRequest(username: string, skip = 0): RawPageRequest {
    const now = new Date();
    return {username, calendarNow: {year: now.getUTCFullYear(), month: now.getUTCMonth() + 1},
        page: {kind: "recent", skip, itemshow: 20}};
}
