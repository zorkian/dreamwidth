// general-session.ts
//
// One admitted active program and Context across initialization and data resume.
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

import {Context, type BuiltinFunction, type Layer} from "../../runtime/s2runtime";
import {encodeScalar, scalarNumber, scalarTruthy, isNativeProgramError, isNativeExecutionStop, nativeExecutionStopKind,
    type NativeScalarWire, NativeString} from "../../runtime/native-scalar";
import type {NativePVFrame} from "../../runtime/native-string";
import type {PublicAppConfig} from "../contracts";
import {admitProgram, instantiateAdmittedProgram} from "./program";
import type {PrivateProgramTransfer} from "./program-coordinator";
import {initializeGeneralProperties, escapeGeneralProperties, type GeneralPropertyCleaner} from "./general-properties";
import {createNativeOutput, type NativePageOutput, type NativeOutputOptions} from "./native-output";

export type InitializedProgram =
    {readonly kind: "initialized"; readonly recentCount: NativeScalarWire} |
    // This object remains installed-worker-local. Only encoded diagnostics may
    // cross the private protocol, never an Error or its infrastructure stack.
    {readonly kind: "program-error"; readonly error: Error | NativeString; readonly signature?: "prop_init()" | "modules_init()"};

export interface GeneralRunFailure {
    readonly kind: "program" | "recursion" | "deadline";
    readonly signature: "RecentPage::print()" | "EntryPage::print()";
    readonly error: Error;
}

export class GeneralProgramSession {
    readonly context: Context;
    readonly layers: readonly Layer[];
    private phase: "new" | "initializing" | "ready" | "rendering" | "complete" | "failed" = "new";
    private readonly output: NativePageOutput;
    private initializationException: Error | NativeString | undefined;
    private initializationSignature: "prop_init()" | "modules_init()" | undefined;
    constructor(transfer: PrivateProgramTransfer, private readonly config: PublicAppConfig,
        callbacks: Record<string, BuiltinFunction>, output: Omit<NativeOutputOptions, "checkDepth" | "initialization">) {
        this.layers = instantiateAdmittedProgram(admitProgram(transfer.program, transfer.admission));
        // Native S2::layer_name uses active layerinfo, not stored-source paths.
        for (let index = 0; index < this.layers.length; index++) {
            const layer = this.layers[index]!, id = transfer.program.layers[index]!.id;
            const name = layer.info.name;
            layer.source = name && name !== "0" ? "'" + name + "' (#" + id + ")" : "layer #" + id;
        }
        // ONE output session and exact sink identity from before prop_init.
        // Printer suppression/rebinding is independent of persistent CSS scratch.
        this.output = createNativeOutput({...output, initialization: true,
            checkDepth: () => this.context.recoveryCheckpoint()});
        this.context = new Context([...this.layers], () => {throw new Error("Legacy output bridge forbidden");},
            undefined, {...callbacks,
                // These hosts must use the SAME native output session during
                // initialization and printing, including saved printer pairs.
                _start_css: ctx => {
                    if (ctx !== this.context) throw new Error("Invalid output Context");
                    this.startCss();
                },
                _end_css: ctx => {
                    if (ctx !== this.context) throw new Error("Invalid output Context");
                    this.endCss();
                },
            }, undefined, config.maxRecursion ?? 500, this.output.sink);
    }
    initialize(cleaner: GeneralPropertyCleaner): InitializedProgram {
        if (this.phase !== "new") throw new Error("Active program already initialized");
        this.phase = "initializing";
        try {
            initializeGeneralProperties(this.context, this.config);
            for (const name of ["prop_init()", "modules_init()"] as const) {
                try {this.context.runNativeFunction(name); this.initializationException = undefined; this.initializationSignature = undefined;}
                catch (error) {
                    if (!isNativeProgramError(error) && !isNativeExecutionStop(error)) throw error;
                    this.initializationException = error;
                    this.initializationSignature = name;
                }
            }
            escapeGeneralProperties(this.context, this.layers, cleaner, () => {this.initializationException = undefined; this.initializationSignature = undefined;});
            if (this.initializationException !== undefined &&
                (!NativeString.is(this.initializationException) || scalarTruthy(this.initializationException))) {
                this.phase = "failed";
                this.output.abort();
                return {kind: "program-error", error: this.initializationException,
                    ...(this.initializationSignature ? {signature: this.initializationSignature} : {})};
            }
            this.phase = "ready";
            return {kind: "initialized", recentCount: encodeScalar(scalarNumber(this.context.prop._num_items_recent))};
        } catch (error) {this.output.abort(); this.phase = "failed"; throw error;}
    }
    /** Installed cleaner adapters apply their reviewed effect union in token order. */
    setInitializationException(value: NativeString | undefined): void {
        if (this.phase !== "initializing") throw new Error("No initialization eval register");
        if (value !== undefined && !NativeString.is(value)) throw new Error("Invalid initialization exception scalar");
        this.initializationException = value?.clone();
        this.initializationSignature = undefined;
    }
    /** Only the trusted worker calls this after parent-selected data arrives. */
    beginRender(): NativePageOutput {
        if (this.phase !== "ready") throw new Error("Active program is not prepared");
        this.output.beginRendering();
        this.phase = "rendering";
        return this.output;
    }
    startCss(): void {this.assertOutputPhase(); this.output.startCss();}
    endCss(): void {this.assertOutputPhase(); this.output.endCss();}
    private assertOutputPhase(): void {
        if (!["initializing", "ready", "rendering"].includes(this.phase)) throw new Error("No active page output");
    }
    printPage(page: unknown, kind: "recent" | "entry"): void {
        if (this.phase !== "rendering") throw new Error("Active program is not rendering");
        // LJ/S2.pm159 derives the exact page entry from the requested view.
        this.context.runNativeFunction(kind === "recent" ? "RecentPage::print()" : "EntryPage::print()", [page]);
    }
    /** The installed coordinator encodes the public diagnostic; errors stay local. */
    completePage(page: unknown, kind: "recent" | "entry",
        diagnostic: (failure: GeneralRunFailure) => NativeString): NativePVFrame {
        if (this.phase !== "rendering") throw new Error("Active program is not rendering");
        let failure: GeneralRunFailure | undefined;
        try {
            this.printPage(page, kind);
        } catch (error) {
            const stop = nativeExecutionStopKind(error);
            if (stop || isNativeProgramError(error)) {
                failure = {kind: stop ?? "program", error: error as Error,
                    signature: kind === "recent" ? "RecentPage::print()" : "EntryPage::print()"};
            } else {
                this.output!.abort(); this.phase = "failed"; throw error;
            }
        }
        try {
            const frame = failure ? this.output!.runtimeError(diagnostic(failure)) : this.output!.finish();
            this.phase = "complete";
            return frame;
        } catch (error) {this.output!.abort(); this.phase = "failed"; throw error;}
    }
}
