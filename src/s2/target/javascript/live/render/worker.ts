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

import {createEntryCleaner} from "@dreamwidth/content";
import {renderStock} from "./engine";
import {validateArtifact} from "./artifact";
import {Unsupported} from "../policy/content";
import type {RenderInput, RendererHeader} from "./types";

// Only stdin/stdout are inherited. One process performs content preparation,
// stock prop_init/modules_init and Page.print under one parent deadline.
let input = "";
function output(header: RendererHeader, html = ""): void {
    process.stdout.write(JSON.stringify(header) + "\n" + html);
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", (part: string) => {
    input += part;
    if (Buffer.byteLength(input) > 12582912) process.exit(1);
});
process.stdin.on("end", () => {
    const cleaner = createEntryCleaner({maxInputBytes: 65536, maxOutputBytes: 2097152,
        maxNodes: 4096, maxDepth: 16, maxCssBytes: 65536, maxCssNodes: 4096,
        maxImageCandidates: 256, maxCuts: 16});
    try {
        const message = JSON.parse(input) as {version: number; artifact: unknown; input: RenderInput; maxBytes: number};
        if (message.version !== 2) throw new Unsupported();
        const artifact = validateArtifact(message.artifact);
        if (!Number.isSafeInteger(message.maxBytes) || message.maxBytes <= 0 ||
            message.maxBytes > 2097152) throw new Unsupported();
        const request = message.input;
        const documentUrl = `${request.config.canonicalAppOrigin}/~${request.journal.username}/` +
            (request.skipPresent ? `?skip=${request.skip}` : "");
        const html = renderStock(artifact, request, message.maxBytes, (rawBody, entryId, entryUrl) => {
            const result = cleaner.clean({body: rawBody, format: "html_raw0", context: {
                policy: "dreamwidth-entry-html-raw0-v1", insertionContext: "html-div-flow", documentUrl,
                entryUrl, journalUsername: request.journal.username, journalId: request.journal.userid,
                entryId, cuts: "source-compatible-recent", ...request.config.entryContent,
                reader: {removeColors: false, removeSizes: false, removeFonts: false,
                    maxImageWidth: null, maxImageHeight: null,
                    placeholderUndefinedImageSize: false, extractImages: false},
            }});
            if (result.kind === "failure") {
                if (result.reason === "unsupported") throw new Unsupported();
                throw new Error("Cleaner unavailable");
            }
            // Ordinary live configuration is proxy-absent. Configured synthetic
            // qualification exercises the separate public image exchange API;
            // no implicit parent signing service or key reaches this worker.
            if (result.kind !== "ok") throw new Unsupported();
            return result.fragment.html;
        });
        output({version: 2, kind: "complete"}, html);
    } catch (error) {
        output({version: 2, kind: "failure",
            reason: error instanceof Unsupported ? "unsupported" : "unavailable"});
    } finally { cleaner.close(); }
});
