// worker.ts
//
// Bounded credential-free local stock renderer execution.
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

import { renderStock } from "./engine";
import { validateArtifact } from "./artifact";
import type { RenderInput } from "./types";

// Only stdin/stdout are inherited. No IPC socket, database handles or ambient
// app credentials are supplied. Parent kills on deadline, overflow or close.
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (part: string) => {
    input += part;
    if (Buffer.byteLength(input) > 12582912) process.exit(1);
});
process.stdin.on("end", () => {
    try {
        const message = JSON.parse(input) as {artifact: unknown; input: RenderInput; maxBytes: number};
        const artifact = validateArtifact(message.artifact);
        if (!Number.isSafeInteger(message.maxBytes) || message.maxBytes <= 0 ||
            message.maxBytes > 2097152) throw new Error("Invalid limit");
        const html = renderStock(artifact, message.input, message.maxBytes);
        process.stdout.write(html);
    } catch {
        // No potentially data-bearing exception crosses this boundary.
        process.exitCode = 1;
    }
});
