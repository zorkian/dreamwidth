// program.ts
//
// Credential-free program transfer validation and execution.
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
import {createHash} from "node:crypto";
import type {NativeProfile} from "../../runtime/native-profile";
import {ABI_VERSION, Layer, s2} from "../../runtime/s2runtime";

export type LayerType = "core" | "i18nc" | "layout" | "i18n" | "theme" | "user";
export interface ActiveLayerInput {
    readonly id:number; readonly ownerId:number; readonly parentId:number; readonly type:LayerType;
    readonly sourceBytes:Uint8Array|null;
    // Exactly decoded/decompressed authoritative compdata, not its SQL encoding.
    readonly activeCompiledBytes:Uint8Array; readonly compiledTime:number;
}
export interface ActiveStyleSnapshot {
    readonly styleId:number; readonly systemUserId:number; readonly layers:readonly ActiveLayerInput[];
}
export interface LayerIdentity {
    readonly id:number; readonly ownerId:number; readonly parentId:number; readonly type:LayerType;
    readonly compiledTime:number; readonly untrusted:boolean;
    readonly sourceSha256:string|null; readonly activeSha256:string;
}
export interface CompiledLayer extends LayerIdentity {
    readonly variable:string; readonly code:string; readonly codeSha256:string;
}
export interface ProgramArtifact {
    readonly schema:1; readonly abi:number; readonly compilerDigest:string;
    readonly dependenciesDigest:string; readonly recoveryDigest?:string; readonly route?:"source"|"recovery"; readonly scalarProfile:NativeProfile; readonly layers:readonly CompiledLayer[];
}

export interface ProgramAdmission {
    readonly abi:number; readonly compilerDigest:string; readonly dependenciesDigest:string;
    readonly recoveryDigest:string; readonly programDigest:string; readonly profileDigest:string;
}
export interface AdmittedProgram {readonly program:ProgramArtifact;}
const admitted=new WeakSet<object>();
export function programDigest(value:unknown):string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function invalid():never {throw new Error("Invalid private program transfer");}
const hash=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
// Expected identity is supplied by the private parent channel, never by S2 or
// a public request. A self-consistent code/hash object is not channel authority.
export function admitProgram(value:unknown, expected:ProgramAdmission):AdmittedProgram {
    if(!expected||expected.abi!==ABI_VERSION||!hash(expected.programDigest)||
        !hash(expected.compilerDigest)||!hash(expected.dependenciesDigest)||
        !hash(expected.recoveryDigest)||!hash(expected.profileDigest))invalid();
    let program:ProgramArtifact;
    try{program=JSON.parse(JSON.stringify(value));}catch{invalid();}
    if(programDigest(program)!==expected.programDigest||program.schema!==1||program.abi!==expected.abi||
        program.compilerDigest!==expected.compilerDigest||program.dependenciesDigest!==expected.dependenciesDigest||
        program.recoveryDigest!==expected.recoveryDigest||programDigest(program.scalarProfile)!==expected.profileDigest||
        !["source","recovery"].includes(program.route??"")||!Array.isArray(program.layers))invalid();
    for(const layer of program.layers) {
        if(!layer||!Number.isSafeInteger(layer.id)||layer.id<1||!Number.isSafeInteger(layer.ownerId)||layer.ownerId<1||
            !Number.isSafeInteger(layer.parentId)||layer.parentId<0||
            !Number.isSafeInteger(layer.compiledTime)||layer.compiledTime<0||
            !["core","i18nc","layout","i18n","theme","user"].includes(layer.type)||
            !hash(layer.activeSha256)||!(layer.sourceSha256===null||hash(layer.sourceSha256))||
            typeof layer.untrusted!=="boolean"||typeof layer.code!=="string"||!layer.code||
            !/^(?:layer_[0-9]+|recovered_layer)$/.test(layer.variable)||
            createHash("sha256").update(layer.code).digest("hex")!==layer.codeSha256)invalid();
    }
    const freeze=(input:any):void=>{
        if(input&&typeof input==="object"&&!Object.isFrozen(input)){
            for(const child of Object.values(input))freeze(child);Object.freeze(input);
        }
    };
    freeze(program);
    const result=Object.freeze({program});admitted.add(result);return result;
}
export function instantiateAdmittedProgram(value:AdmittedProgram):Layer[] {
    if(!admitted.has(value))invalid();
    return value.program.layers.map(item=>{
        const layer=new Function("s2",`"use strict";\n${item.code}\nreturn ${item.variable};`)(s2);
        if(!(layer instanceof Layer))invalid();
        layer.source=`active-layer:${item.id}`;layer.scalarProfile=value.program.scalarProfile;return layer;
    });
}
