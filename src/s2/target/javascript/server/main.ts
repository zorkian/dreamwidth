// main.ts
//
// Start the journal server: main --config FILE [--port N] [--host ADDRESS]
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { parseArgs } from "node:util";
import { Compiler } from "../compile/compiler";
import { Databases } from "../data/db";
import { renderJournal } from "../render/render";
import { createApp } from "./app";
import { readConfig } from "./config";

const { values } = parseArgs({
    options: { config: { type: "string" }, port: { type: "string", default: "8091" }, host: { type: "string", default: "127.0.0.1" } },
});
if (!values.config) {
    console.error("Usage: main --config FILE [--port N] [--host ADDRESS]");
    process.exit(2);
}

const config = readConfig(values.config);
const db = new Databases(config);
const compiler = new Compiler(db);
const app = createApp(config, db, compiler, request => renderJournal(db, { config, host: request.host }, request));
app.listen({ port: Number(values.port), host: values.host }).then(() => {
    console.log(`Journal server listening on ${values.host}:${values.port}`);
});
