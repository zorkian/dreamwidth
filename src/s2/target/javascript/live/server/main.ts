// main.ts
//
// Private standalone entrypoint for the anonymous live S2 journal service.
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

import type {PublicAppConfig} from "../contracts";
import {MysqlLiveStore} from "../data/mysql";
import {createAnonymousRecentService} from "../policy/service";
import {createLiveApp} from "./app";
import {parseStartupArgs, readStartupConfig, StartupConfigError} from "./startup-config";

async function main(): Promise<void> {
    const startup = readStartupConfig(parseStartupArgs(process.argv.slice(2)));
    const repository = await MysqlLiveStore.open({database: startup.database,
        capabilities: startup.capabilities, styles: startup.styles,
        maxScrollback: startup.app.maxScrollback});
    let service;
    try {
        // Public language text is a startup snapshot. This SELECT-only resolver
        // does not invoke retained write-capable translation/cache helpers.
        const labels = await repository.resolvePlaceholder(startup.placeholder);
        const config: PublicAppConfig = {...startup.app, entryContent: {
            urls: startup.app.entryContent.urls,
            imagePlaceholder: {src: startup.placeholder.descriptor.src,
                width: startup.placeholder.descriptor.width, height: startup.placeholder.descriptor.height,
                alt: labels.alt, title: labels.title},
        }};
        service = await createAnonymousRecentService({repository,
            secretSource: repository, capabilities: startup.capabilities,
            artifact: {path: startup.artifactPath}, config,
            limits: {timeoutMs: 10000, maxOutputBytes: 2097152, maxHeapMiB: 128}});
        const app = createLiveApp(config, service);
        app.addHook("onClose", async () => {
            try { await service!.close(); } finally { await repository.close(); }
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
            await app.listen(startup.listener);
            process.stdout.write("Private S2 listener ready\n");
        } catch {
            await app.close();
            throw new Error("Cannot start private listener");
        }
    } catch {
        if (service) await service.close().catch(() => undefined);
        await repository.close().catch(() => undefined);
        throw new Error("Cannot prepare private render service");
    }
}

void main().catch(error => {
    process.stderr.write(error instanceof StartupConfigError ? error.message + "\n" :
        "Private S2 service startup failed\n");
    process.exitCode = 1;
});
