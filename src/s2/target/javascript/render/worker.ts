// worker.ts
//
// Worker thread that renders pages sent by the pool, one at a time.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { parentPort, workerData } from "node:worker_threads";
import { Databases } from "../data/db";
import type { SiteConfig } from "../server/config";
import { type RenderRequest, renderJournal } from "./render";

const config = workerData as SiteConfig;
const db = new Databases(config);

parentPort!.on("message", async (request: RenderRequest) => {
    try {
        const result = await renderJournal(db, { config, host: request.host }, request);
        parentPort!.postMessage({ result });
    } catch (error) {
        parentPort!.postMessage({ error: error instanceof Error ? error.stack ?? error.message : String(error) });
    }
});
