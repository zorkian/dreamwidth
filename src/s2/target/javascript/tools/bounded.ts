// bounded.ts
//
// Bounded subprocess runner for the trusted S2 fixture comparison harness.
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

import { spawnSync } from "node:child_process";

export interface Result {
    status: number;
    stdout: Buffer;
    stderr: Buffer;
}

export function boundedRun(
    command: string,
    args: string[],
    cwd: string,
    timeout = 10_000,
    maxBuffer = 524_288,
): Result {
    const result = spawnSync(command, args, {
        cwd,
        env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", HOME: "/tmp" },
        timeout,
        maxBuffer,
        killSignal: "SIGKILL",
        encoding: "buffer",
    });
    if (result.error) {
        throw new Error(`${command} failed its subprocess bound: ${result.error.message}`);
    }
    if (result.status === null) {
        throw new Error(`${command} ended without an exit status (${result.signal ?? "unknown signal"})`);
    }
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
