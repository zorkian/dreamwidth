// main.ts
//
// Local loopback entrypoint for the anonymous live S2 journal service.
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

import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import type { PublicAppConfig } from "../contracts";
import { MysqlLiveStore, type MysqlStoreConfig } from "../data/mysql";
import { createAnonymousRecentService } from "../policy/service";
import { createLiveApp } from "./app";

function readSmallJson(file: string, privateFile: boolean): unknown {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > 4096 || (privateFile && (stat.mode & 0o077))) {
        throw new Error("Invalid local setup artifact");
    }
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

async function main(): Promise<void> {
    const project = path.resolve(__dirname, "../../..");
    const artifacts = path.join(project, "artifacts/live");
    const config = readSmallJson(path.join(artifacts, "public-config.json"), false) as PublicAppConfig;
    const credential = readSmallJson(
        path.join(artifacts, "mysql-readonly.json"), true,
    ) as MysqlStoreConfig;
    if (config.listenOrigin !== "http://localhost:8081" ||
        config.canonicalAppOrigin !== "http://localhost:8080") {
        throw new Error("Unexpected local origins");
    }
    const repository = await MysqlLiveStore.open(credential);
    let service;
    try {
        service = await createAnonymousRecentService({
            repository,
            secretSource: repository,
            artifact: { path: path.join(artifacts, "stock.json") },
            config,
            limits: { timeoutMs: 10000, maxOutputBytes: 2097152, maxHeapMiB: 128 },
        });
    } catch {
        await repository.close();
        throw new Error("Cannot prepare local render service");
    }
    const app = createLiveApp(config, service);
    app.addHook("onClose", async () => {
        await service.close();
        await repository.close();
    });
    let closing = false;
    const stop = () => {
        if (closing) return;
        closing = true;
        void app.close().catch(() => { process.exitCode = 1; });
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
        await app.listen({ host: "127.0.0.1", port: 8081 });
        process.stdout.write("Live S2 loopback listener ready on 127.0.0.1:8081\n");
    } catch {
        await app.close();
        throw new Error("Cannot start local listener");
    }
}

void main().catch(() => {
    process.stderr.write("Live S2 local service startup failed\n");
    process.exitCode = 1;
});
