// pool.ts
//
// Render pages on worker threads. A render that runs past the time limit,
// such as a style that loops forever, is stopped by terminating its worker.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import path from "node:path";
import { Worker } from "node:worker_threads";
import type { SiteConfig } from "../server/config";
import type { RenderRequest, RenderResult } from "./render";

interface Reply {
    readonly result?: RenderResult;
    readonly error?: string;
    readonly pong?: boolean;
}

interface Job {
    readonly request: RenderRequest | "ping";
    // Called with undefined when the worker ran past the time limit.
    readonly resolve: (reply: Reply | undefined) => void;
}

export class RenderPool {
    private readonly idle: Worker[] = [];
    private readonly queue: Job[] = [];

    constructor(private readonly config: SiteConfig, size: number, private readonly timeoutMs: number) {
        for (let i = 0; i < size; i++) this.idle.push(this.spawn());
    }

    async render(request: RenderRequest): Promise<RenderResult> {
        const reply = await this.send(request);
        if (!reply) return { status: 503, body: "This page took too long to render.\n" };
        if (reply.error) console.error(reply.error);
        return reply.result ?? { status: 500, body: "This page could not be rendered.\n" };
    }

    // Whether a worker answers, for health checks.
    async ping(): Promise<boolean> {
        return !!(await this.send("ping"))?.pong;
    }

    async close(): Promise<void> {
        await Promise.all(this.idle.splice(0).map(worker => worker.terminate()));
    }

    private send(request: Job["request"]): Promise<Reply | undefined> {
        return new Promise(resolve => {
            this.queue.push({ request, resolve });
            this.next();
        });
    }

    private spawn(): Worker {
        return new Worker(path.join(__dirname, "worker.js"), { workerData: this.config });
    }

    private next(): void {
        while (this.idle.length && this.queue.length) {
            const worker = this.idle.pop()!;
            const job = this.queue.shift()!;
            const timer = setTimeout(() => {
                worker.removeAllListeners("message");
                void worker.terminate();
                this.idle.push(this.spawn());
                job.resolve(undefined);
                this.next();
            }, this.timeoutMs);
            worker.once("message", (reply: Reply) => {
                clearTimeout(timer);
                this.idle.push(worker);
                job.resolve(reply);
                this.next();
            });
            worker.postMessage(job.request);
        }
    }
}
