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
import type {EntryContentInput} from "@dreamwidth/content/contracts";
import {renderStock} from "./engine";
import {validateArtifact} from "./artifact";
import {Unsupported} from "../policy/content";
import type {ApprovedEntry, ApprovedComment, RenderContentPreparation, RenderInput, RendererHeader} from "./types";

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
        if (!request.page || !["recent", "entry"].includes(request.page.kind) ||
            !Number.isSafeInteger(request.skip) || request.skip < 0 ||
            typeof request.skipPresent !== "boolean" || (!request.skipPresent && request.skip !== 0)) {
            throw new Unsupported();
        }
        const entryPage = request.page.kind === "entry";
        if (request.page.kind === "entry" && (request.skip !== 0 || request.skipPresent ||
            !Number.isSafeInteger(request.page.ditemid) || request.page.ditemid < 1 ||
            request.page.ditemid > 4294967295 ||
            request.journal.entries.length !== 1 ||
            request.journal.entries[0]!.id !== request.page.ditemid)) {
            throw new Unsupported();
        }
        if (request.page.kind === "recent" && (request.page.itemshow !== 20 ||
            !Number.isSafeInteger(request.page.maxScrollback) || request.page.maxScrollback < 21 ||
            request.page.maxScrollback !== request.config.maxScrollback ||
            request.page.pageSkip !== Math.min(request.skip, request.page.maxScrollback - request.page.itemshow) ||
            typeof request.page.hasPrevious !== "boolean" || request.journal.entries.length > request.page.itemshow)) {
            throw new Unsupported();
        }
        const base = request.journal.baseUrl;
        const parsedBase = new URL(base);
        if (!["http:", "https:"].includes(parsedBase.protocol) || parsedBase.username || parsedBase.password ||
            parsedBase.search || parsedBase.hash || /[\x00-\x20"'<>\\]/.test(base) || base.endsWith("/")) {
            throw new Unsupported();
        }
        const documentUrl = request.page.kind === "entry" ?
            // Match entry->url / the stock permalink, rather than the local
            // /users transport alias. Body URL adaptation uses this base;
            // independently derived metadata retains literal helper URLs.
            `${base}/${request.page.ditemid}.html` :
            `${base}/` +
                (request.skipPresent ? `?skip=${request.skip}` : "");
        const contentInput = (entry: ApprovedEntry, entryUrl: string): EntryContentInput => {
            if (!request.journal.entries.includes(entry) || entryUrl !== `${base}/${entry.id}.html` ||
                (request.page.kind === "entry" && entry.id !== request.page.ditemid)) throw new Unsupported();
            return {body: entry.rawBody, format: entry.bodyFormat, context: {
                policy: "dreamwidth-entry-html-raw0-v1", insertionContext: "html-div-flow", documentUrl,
                entryUrl, journalUsername: request.journal.username, journalId: request.journal.userid,
                entryId: entry.id, cuts: entryPage ? "source-compatible-entry" : "source-compatible-recent",
                ...request.config.entryContent,
                reader: {removeColors: false, removeSizes: false, removeFonts: false,
                    maxImageWidth: null, maxImageHeight: null,
                    placeholderUndefinedImageSize: false, extractImages: false},
            }};
        };
        const allowedComments=new Set<ApprovedComment>();
        const addComments=(nodes:readonly ApprovedComment[]):void=>{for(const node of nodes){
            allowedComments.add(node);addComments(node.replies);}};
        addComments(request.journal.comments?.roots??[]);
        const content: RenderContentPreparation = {
            comment(comment,entryUrl) {
                if(!entryPage||!allowedComments.has(comment)||!comment.full||comment.rawBody===null||
                    entryUrl!==documentUrl)throw new Unsupported();
                const props=comment.props;
                const truthy=(value:string|null|undefined):boolean=>!!value&&value!=='0';
                const formatting=truthy(props.editor)?props.editor!:
                    truthy(props.opt_preformatted)?'html_raw0':
                    Object.hasOwn(props,'import_source')||comment.datepost<'2019-05'?'html_casual0':'html_casual1';
                if(!['html_raw0','html_casual0','html_casual1'].includes(formatting))throw new Unsupported();
                const result=cleaner.comment({body:comment.rawBody,formatting:formatting as 'html_raw0'|'html_casual0'|'html_casual1',
                    anonymous:!comment.author,context:contentInput(request.journal.entries[0]!,entryUrl).context});
                if(result.kind!=='ok')throw new Unsupported();
                return result.html;
            },
            customtext(source) {
                const result=cleaner.customtext({source,context:{
                    policy:'dreamwidth-entry-html-raw0-v1',insertionContext:'html-div-flow',documentUrl,
                    entryUrl:documentUrl,journalUsername:request.journal.username,journalId:request.journal.userid,
                    entryId:1,cuts:'source-compatible-entry',...request.config.entryContent,
                    reader:{removeColors:false,removeSizes:false,removeFonts:false,maxImageWidth:null,maxImageHeight:null,
                        placeholderUndefinedImageSize:false,extractImages:false}}});
                if(result.kind!=='ok')throw new Unsupported();
                return result.html;
            },
            subject(entry, entryUrl, source = entry.subject) {
                const entryInput = contentInput(entry, entryUrl);
                if (source !== entry.subject && !Object.values(entry.currents ?? {}).includes(source)) {
                    throw new Unsupported();
                }
                const result = cleaner.subject({source, context: entryInput.context});
                if (result.kind !== "ok") {
                    if (result.reason === "unsupported") throw new Unsupported();
                    throw new Error("Subject unavailable");
                }
                return result.subject;
            },
            body(entry, entryUrl) {
                const result = cleaner.clean(contentInput(entry, entryUrl));
                if (result.kind === "failure") {
                    if (result.reason === "unsupported") throw new Unsupported();
                    throw new Error("Cleaner unavailable");
                }
                // This private viewer defers proxying even on a configured
                // site. Unsafe URLs and declared known-HTTPS rules remain;
                // no signing service or key reaches this worker.
                if (result.kind !== "ok") throw new Unsupported();
                return result.fragment.html;
            },
            metadata(entry, entryUrl) {
                if (!entryPage) throw new Unsupported();
                // The source helper is independently derived from raw text,
                // never from body HTML. Only the child engine consumes this
                // inert value at its escaped OG attribute boundary.
                const result = cleaner.metadata({subject: entry.subject, entry: contentInput(entry, entryUrl)});
                if (result.kind === "failure") {
                    if (result.reason === "unsupported") throw new Unsupported();
                    throw new Error("Metadata unavailable");
                }
                return result.metadata;
            },
        };
        const html = renderStock(artifact, request, message.maxBytes, content);
        output({version: 2, kind: "complete"}, html);
    } catch (error) {
        output({version: 2, kind: "failure",
            reason: error instanceof Unsupported ? "unsupported" : "unavailable"});
    } finally { cleaner.close(); }
});
