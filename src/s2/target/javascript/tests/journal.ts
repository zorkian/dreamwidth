// journal.ts
//
// Render fixture journals in-process for tests. Needs the devcontainer
// database with tools/seed-fixtures.pl applied.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { Compiler } from "../compile/compiler";
import { styleInfo, styleLayers } from "../compile/styles";
import { Databases, int } from "../data/db";
import { User } from "../data/user";
import type { EntryArgs } from "../render/entry-page";
import { type RenderRequest, type RenderResult, renderJournal } from "../render/render";
import type { SiteConfig } from "../server/config";

export const HOST = "localhost:8092";

export class TestJournals {
    readonly config: SiteConfig = JSON.parse(execFileSync("perl",
        [path.resolve(__dirname, "../../tools/export-config.pl")], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    readonly db = new Databases(this.config);
    private readonly compiler = new Compiler(this.db);

    async recent(user: string, skip?: number): Promise<RenderResult> {
        return this.render(user, "recent", { skip });
    }

    async entry(user: string, ditemid: number, args: EntryArgs = {}): Promise<RenderResult> {
        return this.render(user, "entry", { ditemid, entryArgs: args });
    }

    // The ditemid of the journal's entry whose subject starts with this ASCII text.
    async ditemid(user: string, subject: string): Promise<number> {
        const u = (await User.byName(this.db, user))!;
        const rows = await u.cluster(this.db, `SELECT l.jitemid, l.anum FROM log2 l JOIN logtext2 t USING (journalid, jitemid)
            WHERE l.journalid = ? AND t.subject LIKE ?`, [u.userid, `${subject}%`]);
        return int(rows[0]!.jitemid) * 256 + int(rows[0]!.anum);
    }

    async close(): Promise<void> {
        this.compiler.close();
        await this.db.close();
    }

    // What the server would send a render worker for this page.
    async request(user: string, view: "recent" | "entry",
        options: { skip?: number; ditemid?: number; entryArgs?: EntryArgs } = {}): Promise<RenderRequest> {
        const u = (await User.byName(this.db, user))!;
        await u.loadProps(this.db, ["s2_style"]);
        const layers = await styleLayers(this.db, this.config, u);
        const [compiled, style] = await Promise.all([
            this.compiler.compile(layers), styleInfo(this.db, this.config, u, layers),
        ]);
        return { username: user, view, ...options, requestPath: `/~${user}/`, host: HOST, layers: compiled, style };
    }

    private async render(user: string, view: "recent" | "entry",
        options: { skip?: number; ditemid?: number; entryArgs?: EntryArgs }): Promise<RenderResult> {
        if (!await User.byName(this.db, user)) return { status: 404, html: "" };
        return renderJournal(this.db, { config: this.config, host: HOST }, await this.request(user, view, options));
    }
}
