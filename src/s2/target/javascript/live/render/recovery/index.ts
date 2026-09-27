// index.ts
//
// Recover authoritative active S2 programs without evaluating stored Perl.
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
import {RecoveryGap, type Expr, type Stmt} from "./ast";
import {Parser} from "./parser";
import {instantiate} from "./execute";

export type LayerType = "core"|"i18nc"|"layout"|"theme"|"i18n"|"user";
export interface RecoveryInput {id:number;ownerId:number;systemUserId:number;parentId:number;type:LayerType;activeBytes:Uint8Array;}
export type RecoveryResult = {kind:"recovered";id:number;activeSha256:string;abi:number;
    variable:"recovered_layer";code:string;hostCalls:readonly string[]} | {kind:"gap";id:number;reason:string;readonly deterministic:boolean};

const emittedExecutorNotice = "// execute.ts\n//\n// Declarative lowered-program execution over the S2 runtime ABI.\n//\n// Authors:\n//      Dreamwidth contributors\n//\n// Copyright (c) 2026 by Dreamwidth Studios, LLC.\n//\n// Inherited semantic ports: src/s2/S2.pm registration/context helpers and\n// src/s2/S2/Node*::asPerl generated-language operations.\n//\n// This code was forked from the LiveJournal project owned and operated\n// by Live Journal, Inc. The code has been modified and expanded by\n// Dreamwidth Studios, LLC. These files were originally licensed under\n// the terms of the license supplied by Live Journal, Inc, which can\n// currently be found at:\n//\n// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt\n//\n// In accordance with the original license, this code and all its\n// modifications are provided under the GNU General Public License.\n// A copy of that license can be found in the LICENSE file included as\n// part of this distribution.\n//\n";

const registrations = new Set(["register_layer", "set_layer_info", "register_class", "register_function",
    "register_global_function", "register_property", "register_property_use", "register_property_hide",
    "register_propgroup_name", "register_propgroup_props", "register_set"]);
const helpers = new Set(["get_func_num", "get_object_func_num", "S2::Object::new", "S2::notags",
    "S2::check_defined", "S2::check_elements", "S2::get_characters", "S2::object_isa",
    "S2::downcast_object", "S2::interpolate_object", "int", "length", "keys",
    "scalar", "reverse", "pop", "push"]);

// NodeFunction.pm327's non-OO prologue is already owned by Context.invoke.
// Match closed AST shape, not source text or arbitrary conditional checkpoints.
function canonicalEntryCheckpoint(statement: Stmt | undefined): boolean {
    if(statement?.kind !== "if" || statement.branches.length !== 1 || statement.otherwise.length) return false;
    const branch=statement.branches[0]!;
    const test=branch.test;
    if(test.kind !== "binary" || test.op !== "==" || test.right.kind !== "literal" ||
        test.right.value !== 0 || test.left.kind !== "binary" || test.left.op !== "%") return false;
    const increment=test.left.left, frequency=test.left.right;
    if(increment.kind !== "unary" || increment.op !== "++" || increment.value.kind !== "variable" ||
        increment.value.name !== "$S2::sub_ctr" || frequency.kind !== "variable" ||
        frequency.name !== "$S2::depth_check_every") return false;
    const call=branch.body[0];
    return branch.body.length === 1 && call?.kind === "expr" && call.expr.kind === "call" &&
        call.expr.name === "S2::check_depth" && call.expr.args.length === 0;
}

function validate(program: Stmt[], id: number): string[] {
    const host = new Set<string>();
    const checkExpr = (x: Expr, scope: Set<string>, top=false, contextArgument=false): void => {
        switch(x.kind) {
            case "literal": break;
            case "name": if(!["VTABLE","STATIC","PROPS"].includes(x.name))throw new RecoveryGap("Unknown generated constant");break;
            case "variable":
                if(["$S2::sub_ctr","$S2::depth_check_every"].includes(x.name))throw new RecoveryGap("Counter outside canonical generated prologue");
                if(x.name === "$_ctx" && !contextArgument)throw new RecoveryGap("Context is only a generated slot receiver or argument");
                if(!scope.has(x.name) && !["$S2::pout","$S2::pout_s"].includes(x.name))throw new RecoveryGap("Unbound generated lexical " + x.name);
                break;
            case "concat": case "array": case "tuple": x.items.forEach(v=>checkExpr(v,scope));break;
            case "hash": x.entries.forEach(([k,v])=>{checkExpr(k,scope);checkExpr(v,scope);});break;
            case "member":
                if(x.base.kind === "variable" && x.base.name === "$_ctx") {
                    const slot=x.key;
                    if(x.container !== "array" || !((slot.kind === "name" && ["VTABLE","PROPS"].includes(slot.name)) ||
                        (slot.kind === "literal" && [0,2].includes(slot.value as number))))
                        throw new RecoveryGap("Non-generated Context member");
                    checkExpr(x.base,scope,false,true);
                } else checkExpr(x.base,scope);
                checkExpr(x.key,scope);break;
            case "conditional": checkExpr(x.test,scope);checkExpr(x.yes,scope);checkExpr(x.no,scope);break;
            case "declare":
                if(x.value)checkExpr(x.value,scope);
                x.names.forEach(n=>{if(["$S2::sub_ctr","$S2::depth_check_every"].includes(n))throw new RecoveryGap("Reserved generated counter");scope.add(n);if(n.startsWith("@"))scope.add("$"+n.slice(1));});break;
            case "sub": {
                if(canonicalEntryCheckpoint(x.body[0])) {
                    const declaration=x.body[1];
                    if(declaration?.kind !== "expr" || declaration.expr.kind !== "declare" ||
                        !declaration.expr.list || !declaration.expr.names.includes("$_ctx") ||
                        declaration.expr.value?.kind !== "variable" || declaration.expr.value.name !== "@_")
                        throw new RecoveryGap("Checkpoint outside generated function entry");
                    x.body.shift();
                }
                checkBody(x.body,new Set([...scope,"@_"]));break;
            }
            case "call": {
                const builtin=/^S2::Builtin(?:::LJ)?::[A-Za-z_][A-Za-z0-9_]*$/.test(x.name);
                if(!helpers.has(x.name) && !(top && registrations.has(x.name)) && !builtin)throw new RecoveryGap("Non-S2 capability " + x.name);
                if(builtin)host.add(x.name);
                x.args.forEach(a=>checkExpr(a,scope,false,true));break;
            }
            case "invoke": {
                const c=x.callee;
                const output=c.kind === "variable" && ["$S2::pout","$S2::pout_s"].includes(c.name);
                const virtual=c.kind === "member" && c.container === "hash" && c.base.kind === "member" &&
                    c.base.container === "array" && c.base.base.kind === "variable" && c.base.base.name === "$_ctx" &&
                    ((c.base.key.kind === "name" && c.base.key.name === "VTABLE") ||
                        (c.base.key.kind === "literal" && c.base.key.value === 0));
                if(!output && !virtual)throw new RecoveryGap("Computed non-S2 callable");
                checkExpr(c,scope);x.args.forEach(a=>checkExpr(a,scope,false,true));break;
            }
            case "binary":
                if(x.op === "=" && x.left.kind !== "variable" && x.left.kind !== "member")throw new RecoveryGap("Invalid generated assignment");
                checkExpr(x.left,scope);checkExpr(x.right,scope);break;
            case "unary":
                if(x.op === "coderef") {
                    if(x.value.kind !== "name" || !/^S2::Builtin(?:::LJ)?::Color__Color$/.test(x.value.name))throw new RecoveryGap("Unknown historical code reference");
                    host.add(x.value.name);
                } else checkExpr(x.value,scope);
                break;
        }
    };
    const checkBody = (body: Stmt[], scope: Set<string>, loop=false): void => {
        for(const s of body) {
            switch(s.kind) {
                case "expr": checkExpr(s.expr,scope);break;
                case "block": checkBody(s.body,new Set(scope),loop);break;
                case "if": s.branches.forEach(b=>{checkExpr(b.test,scope);checkBody(b.body,new Set(scope),loop);});checkBody(s.otherwise,new Set(scope),loop);break;
                case "while": checkExpr(s.test,scope);checkBody(s.body,new Set(scope),true);break;
                case "for": {const local=new Set(scope);checkExpr(s.init,local);checkExpr(s.test,local);checkExpr(s.step,local);checkBody(s.body,local,true);break;}
                case "foreach": {const local=new Set(scope);checkExpr(s.list,scope);checkExpr(s.variable,local);checkBody(s.body,local,true);break;}
                case "return": if(s.value)checkExpr(s.value,scope);break;
                case "last": case "next": if(!loop)throw new RecoveryGap("Loop control outside generated loop");break;
            }
        }
    };
    if(!program.length)throw new RecoveryGap("Missing generated registration envelope");
    let layer=false;
    for(const s of program) {
        if(s.kind !== "expr")throw new RecoveryGap("Executable top-level Perl");
        const e=s.expr;
        if(e.kind === "literal" && e.value === 1)continue;
        if(e.kind !== "call" || !registrations.has(e.name))throw new RecoveryGap("Invalid registration envelope");
        const key=e.args[0];
        if(key?.kind !== "literal" || key.value !== id)throw new RecoveryGap("Compiled registration identity mismatch");
        if(!layer && e.name !== "register_layer")throw new RecoveryGap("Missing first layer registration");
        if(e.name === "register_layer") {if(layer || e.args.length !== 1)throw new RecoveryGap("Duplicate layer registration");layer=true;}
        checkExpr(e,new Set(),true);
    }
    if(!layer)throw new RecoveryGap("Missing generated layer");
    return [...host].sort();
}

export function recoverActiveLayer(input: RecoveryInput, abi: number): RecoveryResult {
    try {
        if(!Number.isSafeInteger(input.id) || input.id < 1 || !Number.isSafeInteger(input.ownerId) ||
            input.ownerId < 1 || !Number.isSafeInteger(input.systemUserId) || input.systemUserId < 1 ||
            !Number.isSafeInteger(input.parentId) || input.parentId < 0 || !["core","i18nc","layout","theme","i18n","user"].includes(input.type) || !Number.isSafeInteger(abi) || abi < 1)
            throw new RecoveryGap("Invalid authoritative recovery identity");
        const bytes=Uint8Array.from(input.activeBytes);
        // This is a reversible one-byte lexical view, not a decoded program.
        // Literal octets become shared PV literals only at execution.
        let source="";
        for(let offset=0;offset<bytes.length;offset+=8192)
            source+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
        const program=new Parser(source).parse();
        const hostCalls=validate(program,input.id);
        const data=JSON.stringify(program).replaceAll("\u2028","\\u2028").replaceAll("\u2029","\\u2029");
        // Only the installed lowering function and JSON-serialized closed IR
        // become executable JS; input substrings are never copied as syntax.
        const code=emittedExecutorNotice + `s2.assertABI(${abi});\nvar recovered_layer = (${instantiate.toString()})(${data}, s2, ${input.id});\n`;
        return {kind:"recovered",id:input.id,abi,variable:"recovered_layer",code,hostCalls,
            activeSha256:createHash("sha256").update(bytes).digest("hex")};
    } catch(error) {
        return {kind:"gap",id:input.id,deterministic:error instanceof RecoveryGap,reason:error instanceof RecoveryGap ? error.message : "Generated program could not be parsed"};
    }
}
