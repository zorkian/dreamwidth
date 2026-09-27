// execute.ts
//
// Declarative lowered-program execution over the S2 runtime ABI.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// Inherited semantic ports: src/s2/S2.pm registration/context helpers and
// src/s2/S2/Node*::asPerl generated-language operations.
//
// This code was forked from the LiveJournal project owned and operated
// by Live Journal, Inc. The code has been modified and expanded by
// Dreamwidth Studios, LLC. These files were originally licensed under
// the terms of the license supplied by Live Journal, Inc, which can
// currently be found at:
//
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
//
// In accordance with the original license, this code and all its
// modifications are provided under the GNU General Public License.
// A copy of that license can be found in the LICENSE file included as
// part of this distribution.
//


import type {Expr, Stmt} from "./ast";

// This function's installed source is emitted with the closed IR. It contains
// no imports or ambient I/O; persisted text is passed only as serialized data.
export function instantiate(program: Stmt[], s2: any, layerId: number): any {
    type Cell = {get(): any; set(value: any): any; exists?(): boolean; delete?(): boolean};
    type Env = {vars: Map<string, Cell>; parent?: Env; context?: any};
    if(typeof s2.runtime.isContext !== "function")throw new Error("Missing authoritative Context brand ABI");
    const isContext = (value: any): boolean => s2.runtime.isContext(value);
    const layer = s2.makeLayer();
    layer.source = "active compiled layer #" + layerId;
    const makeCell = (initial: any): Cell => {
        let value=rt.scalarCopy(initial); return {get:()=>value,set:v=>{value=rt.scalarCopy(v);return value;}};
    };
    const environment = (parent?: Env): Env => ({vars:new Map(),parent,context:parent?.context});
    const lookup = (env: Env, name: string): Cell => {
        for(let scope: Env|undefined=env;scope;scope=scope.parent) {
            const found=scope.vars.get(name); if(found)return found;
        }
        throw new Error("Unbound recovered lexical");
    };
    const rt=s2.runtime;
    const string = (x: any): string => {
        const bytes=rt.scalarPV(x).bytes();
        let text="";
        for(let offset=0;offset<bytes.length;offset+=8192)
            text+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
        return text;
    };
    const truth = rt.scalarTruthy;
    const literalString = (value: string): any => {
        let hex="";
        for(let i=0;i<value.length;i++)hex+=value.charCodeAt(i).toString(16).padStart(2,"0");
        return rt.pvBytes(hex);
    };
    const as = (mode: "scalar"|"list"|"void", operation: ()=>any): any => rt.evaluateAs(mode,operation);
    const object = (pairs: [any,any][]): any => {
        return s2.runtime.makeHash(pairs);
    };
    const props = Symbol("properties"), vtable=Symbol("virtual table"), method=Symbol("method key");
    const isObject = (x: any) => x !== null && typeof x === "object";
    const keyFor = (base: any, key: any): any => {
        if(base && Object.hasOwn(base, props)) return "_"+string(key);
        if(base && Object.hasOwn(base,".type")) {
            if(string(key) === "_type")return ".type";
            if(string(key) === "_isnull")return ".isnull";
            return "_"+string(key);
        }
        return key;
    };
    const ctxProps = (context: any) => {
        // The marker is nonenumerable, never a property supplied by a layer.
        if(!Object.hasOwn(context.prop,props))Object.defineProperty(context.prop,props,{value:true});
        return context.prop;
    };
    const reference = (x: Expr, env: Env, create=false): Cell => {
        if(x.kind === "variable")return lookup(env,x.name);
        if(x.kind !== "member")throw new Error("Invalid recovered lvalue");
        let base=evalExpr(x.base,env);
        if(base === null || base === undefined) {
            if(!create) return makeCell(undefined);
            base=x.container === "array" ? [] : object([]);
            reference(x.base,env,true).set(base);
        }
        if(isContext(base))throw new Error("Recovered Context mutation refused");
        const key=evalAs(x.key,env,"scalar");
        if(!isObject(base))throw new Error("Invalid recovered dereference");
        const field=Object.hasOwn(base,props)||Object.hasOwn(base,".type");
        return rt.memberSlot(base,field ? keyFor(base,key) : key,
            field ? "field" : x.container);
    };
    const list = (xs: Expr[], env: Env): any[] => {
        const captured=xs.map(x=>evalAs(x,env,"list",true));
        const values=rt.operandList(captured);
        return values.flatMap((value: any,i: number)=>{
            const x=xs[i]!;
            return x.kind === "tuple" || (x.kind === "unary" && x.op === "@") ||
                (x.kind === "binary" && x.op === "..") ||
                (x.kind === "call" && x.name === "reverse" && x.args[0]?.kind === "unary" && x.args[0].op === "@") ? value ?? [] : [value];
        });
    };
    const invokeBuiltin = (name: string, args: any[], env: Env): any => {
        const short=name.replace(/^S2::Builtin(?:::LJ)?::/,"");
        const ctor=/^([A-Za-z_][A-Za-z0-9_]*)__\1$/.exec(short);
        if(ctor) {
            const fn=s2.builtin["construct_"+ctor[1]];
            if(!Object.hasOwn(s2.builtin,"construct_"+ctor[1]) || typeof fn !== "function")throw new Error("Missing recovered constructor capability " + short);
            return fn(...args);
        }
        const context=env.context;
        if(!isContext(context) || args[0] !== context)throw new Error("Recovered builtin requires executing Context");
        const nameKey="_"+short;
        if(!Object.hasOwn(context.builtin,nameKey))throw new Error("Missing recovered host capability " + short);
        return context.builtin[nameKey](...args);
    };
    const call = (name: string, args: any[], env: Env): any => {
        const context=env.context;
        if(/^S2::Builtin(?:::LJ)?::/.test(name))return invokeBuiltin(name,args,env);
        switch(name) {
            case "get_func_num": return string(args[0]);
            case "get_object_func_num":
                if(args[6] !== context)throw new Error("Recovered method requires executing Context");
                return {[method]:true,classname:string(args[0]),value:args[1],name:string(args[2]),
                layer:args[3],line:args[4],super:truth(args[5]),context};
            case "S2::Object::new": return object([[".type",string(args[0])]]);
            case "S2::notags": return s2.runtime.notags(args[0]);
            case "S2::check_defined": return s2.runtime.isDefined(args[0]);
            case "S2::check_elements": return Array.isArray(args[0]) ? args[0].length !== 0 : isObject(args[0]) && Object.keys(args[0]).length !== 0;
            case "S2::get_characters": return s2.runtime.characters(args[0]);
            case "S2::object_isa":
                if(args[0] !== context)throw new Error("Recovered helper requires executing Context"); return args[0].objectIsa(args[1],string(args[2]));
            case "S2::downcast_object":
                if(args[0] !== context)throw new Error("Recovered helper requires executing Context"); return args[0].downcastObject(args[1],string(args[2]),layer,string(args[4]));
            case "S2::interpolate_object":
                if(args[0] !== context)throw new Error("Recovered helper requires executing Context"); {
                if(!s2.runtime.isDefined(args[2]))return "";
                try {return args[0].getFunction(string(args[2][".type"])+"::"+string(args[3]))(args[0],args[2]);}
                catch {return string(args[2]?.[".type"] ?? args[1] ?? "undef")+"::"+string(args[3])+" call failed.";}
            }
            case "int": return rt.scalarInt(args[0]);
            case "length": return rt.numericLiteral(String(rt.stringLength(args[0])));
            case "keys": return rt.hashKeys(args[0]);
            case "scalar": return Array.isArray(args[0]) ? rt.numericLiteral(String(args[0].length)) : args[0];
            case "reverse": return Array.isArray(args[0]) ? [...args[0]].reverse() : rt.reverseInContext(context,args[0]);
            case "pop": return args[0]?.pop();
            case "push": for(const value of args.slice(1))args[0].push(rt.scalarCopy(value));return rt.numericLiteral(String(args[0].length));
            default: throw new Error("Invalid recovered capability");
        }
    };
    const evalAs = (x: Expr, env: Env, mode: "scalar"|"list"|"void", operand=false): any => as(mode,()=>evalExpr(x,env,operand));
    const evalExpr = (x: Expr, env: Env, operand=false): any => {
        switch(x.kind) {
            case "literal": return x.numeric ? rt.numericLiteral(x.numeric) : typeof x.value === "string" ? literalString(x.value) : x.value;
            case "concat": return rt.scalarConcatChain(x.items.map(item=>()=>evalAs(item,env,"scalar",true)));
            case "name": return ({VTABLE:0,STATIC:1,PROPS:2} as Record<string,number>)[x.name];
            case "variable": {
                if(x.name === "$S2::pout")return (v: any)=>env.context.print(v);
                if(x.name === "$S2::pout_s")return (v: any)=>env.context.safePrint(v);
                return operand ? rt.captureOperand(lookup(env,x.name)) : lookup(env,x.name).get();
            }
            case "array": case "tuple": return list(x.items,env);
            case "hash": return object(x.entries.map(([k,v])=>[evalAs(k,env,"scalar",true),evalAs(v,env,"scalar",true)]));
            case "conditional": return evalExpr(truth(evalAs(x.test,env,"scalar")) ? x.yes : x.no,env,operand);
            case "declare": {
                const value=x.value ? evalAs(x.value,env,x.list ? "list" : "scalar") : undefined;
                const values=x.list ? value ?? [] : [value];
                x.names.forEach((n,i)=>{
                    const cell=makeCell(values[i]);env.vars.set(n,cell);
                    if(n.startsWith("@"))env.vars.set("$"+n.slice(1),cell);
                });
                return value;
            }
            case "member": {
                const base=evalAs(x.base,env,"scalar"), key=evalAs(x.key,env,"scalar");
                if(isContext(base) && (base !== env.context || x.container !== "array"))throw new Error("Recovered Context hash access refused");
                if(base === env.context && x.container === "array") {
                    if(string(key) === "0")return {[vtable]:true,context:env.context};
                    if(string(key) === "2")return ctxProps(env.context);
                    throw new Error("Unimplemented recovered context slot");
                }
                if(base && Object.hasOwn(base,vtable)) {
                    if(key && key[method]) {
                        if(!isObject(key.value) || !Object.hasOwn(key.value,".type") || key.value[".isnull"])
                            throw new Error("Recovered method called on null object");
                        // Native helper uses the emitted class unchanged for
                        // super, otherwise the object's exact runtime type.
                        const type=key.super ? key.classname : key.value[".type"];
                        return key.context.getFunction(string(type)+"::"+key.name);
                    }
                    return base.context.getFunction(string(key));
                }
                if(base === null || base === undefined)return undefined;
                const field=Object.hasOwn(base,props)||Object.hasOwn(base,".type");
                const slot=rt.memberSlot(base,field ? keyFor(base,key) : key,field ? "field" : x.container);
                return operand ? rt.captureOperand(slot) : slot.get();
            }
            case "sub": { const fn=(...args: any[]) => {
                const local=environment(env);
                local.vars.set("@_",makeCell(args));
                // Only native-style returned function bodies establish the executing
                // Context. An arbitrary object with a getFunction field is
                // not authority to change host dispatch or output channels.
                const contextBody=x.body.some(statement=>statement.kind === "expr" &&
                    statement.expr.kind === "declare" && statement.expr.names.includes("$_ctx"));
                if(contextBody) {
                    if(!isContext(args[0]))throw new Error("Recovered function requires authoritative Context");
                    if(env.context && args[0] !== env.context)throw new Error("Recovered function changed executing Context");
                    local.context=args[0];
                }
                const signal=run(x.body,local,false);
                return signal?.kind === "return" ? signal.value : undefined;
            };
                if(x.entryLine !== undefined)rt.nativeFunctionEntry(fn,layer,x.entryLine);
                return fn;
            }
            case "call": {
                const args=["scalar","keys","reverse","pop","length","int"].includes(x.name) ? x.args.map(a=>evalAs(a,env,x.name === "reverse" ? "list" : "scalar")) :
                    x.name === "push" ? [evalExpr(x.args[0]!,env),...list(x.args.slice(1),env)] : list(x.args,env);
                return call(x.name,args,env);
            }
            case "invoke": return evalAs(x.callee,env,"scalar")(...list(x.args,env));
            case "unary": {
                if(x.op === "coderef")return (...args: any[])=>call((x.value as {name:string}).name,args,env);
                if(x.op === "delete") {const ref=reference(x.value,env);const old=ref.get();rt.deleteSlot(ref);return old;}
                if(["++","--","post++","post--"].includes(x.op)) {
                    return rt.incrementSlot(reference(x.value,env,true),x.op.includes("++"),!x.op.startsWith("post"),operand);
                }
                const value=evalAs(x.value,env,"scalar");
                if(x.op === "!")return !truth(value);
                if(x.op === "-")return rt.scalarNegate(value);
                if(x.op === "+")return rt.scalarNumber(value);
                if(x.op === "@" || x.op === "%") {
                    if(value !== null && value !== undefined)return value;
                    const fresh=x.op === "@" ? [] : object([]);
                    reference(x.value,env,true).set(fresh);return fresh;
                }
                throw new Error("Invalid recovered unary operation");
            }
            case "binary": {
                if(x.op === "=") {
                    const right=evalAs(x.right,env,"scalar");
                    return rt.assignSlot(reference(x.left,env,true),right,false,operand);
                }
                const a=evalAs(x.left,env,"scalar",true);
                if(x.op === "&&")return truth(rt.readOperand(a)) ? evalExpr(x.right,env,operand) : rt.readOperand(a);
                if(x.op === "||")return truth(rt.readOperand(a)) ? rt.readOperand(a) : evalExpr(x.right,env,operand);
                const b=evalAs(x.right,env,"scalar",true);
                if(["+","-","*","/","%"].includes(x.op))return rt.scalarBinary(x.op,a,b);
                const comparisons: Record<string,string>={eq:"==",ne:"!=",lt:"<",le:"<=",gt:">",ge:">="};
                if(Object.hasOwn(comparisons,x.op))return rt.scalarCompare("string",comparisons[x.op],a,b);
                if(["==","!=","<","<=",">",">="].includes(x.op))return rt.scalarCompare("number",x.op,a,b);
                if(x.op === "..")return rt.makeRange(rt.readOperand(a),rt.readOperand(b));
                throw new Error("Invalid recovered binary operation");
            }
        }
    };
    type Signal = {kind:"return"|"last"|"next";value?:any};
    const run = (body: Stmt[], parent: Env, scoped=true): Signal|undefined => {
        const env=scoped ? environment(parent) : parent;
        for(const stmt of body) {
            if(env.context && stmt.copLine !== undefined)rt.nativeCOP(env.context,layer,stmt.copLine);
            switch(stmt.kind) {
                case "expr": evalAs(stmt.expr,env,"void");break;
                case "block": {const signal=run(stmt.body,env);if(signal)return signal;break;}
                case "return": return {kind:"return",value:stmt.value ? evalExpr(stmt.value,env) : undefined};
                case "last": case "next": return {kind:stmt.kind};
                case "if": {
                    const branch=stmt.branches.find(b=>truth(evalAs(b.test,env,"scalar")));
                    const signal=run(branch ? branch.body : stmt.otherwise,env);if(signal)return signal;break;
                }
                case "while": case "for": {
                    const scope=environment(env);
                    if(stmt.kind === "for")evalExpr(stmt.init,scope);
                    while(truth((stmt.kind === "for" && stmt.copLine !== undefined
                        ? (rt.nativeCOP(scope.context,layer,stmt.copLine),evalAs(stmt.test,scope,"scalar"))
                        : evalAs(stmt.test,scope,"scalar")))) {
                        s2.runtime.executionCheckpoint(scope.context);
                        const signal=run(stmt.body,scope);
                        if(signal?.kind === "return")return signal;
                        if(signal?.kind === "last")break;
                        if(signal?.kind === "next" && stmt.copLine !== undefined)rt.nativeCOP(scope.context,layer,stmt.copLine);
                        if(stmt.kind === "for") {if(stmt.copLine !== undefined)rt.nativeCOP(scope.context,layer,stmt.copLine);evalExpr(stmt.step,scope);}
                    }
                    break;
                }
                case "foreach": {
                    const scope=environment(env), items=evalAs(stmt.list,scope,"list") ?? [];
                    if(stmt.variable.kind === "declare")evalExpr(stmt.variable,scope);
                    const variable=stmt.variable.kind === "declare" ? {kind:"variable",name:stmt.variable.names[0]!} as Expr : stmt.variable;
                    if(variable.kind !== "variable")throw new Error("Invalid recovered foreach variable");
                    const original=lookup(scope,variable.name);
                    try {
                        for(const slot of rt.iterationSlots(items,"array")) {
                            s2.runtime.executionCheckpoint(scope.context);
                            scope.vars.set(variable.name,slot);
                            const signal=run(stmt.body,scope);
                            if(signal?.kind === "return")return signal;
                            if(signal?.kind === "last")break;
                        }
                    } finally {scope.vars.set(variable.name,original);}
                    break;
                }
            }
        }
        return undefined;
    };
    const root=environment();
    const constantValue = (x: Expr): any => evalAs(x,root,"scalar");
    const metadata = (value: any): any => {
        if(value === null || value === undefined || typeof value !== "object")return value;
        if(typeof value.bytes === "function")return string(value);
        if(typeof value.wire === "function") {
            const text=string(value),number=Number(text);
            return Number.isSafeInteger(number) ? number : value;
        }
        if(Array.isArray(value))return value.map(metadata);
        const result=Object.create(null);
        for(const key of rt.hashKeys(value))result[string(key)]=metadata(rt.memberSlot(value,key,"hash").get());
        return result;
    };
    for(const stmt of program) {
        if(stmt.kind !== "expr")throw new Error("Invalid recovered top level");
        if(stmt.expr.kind === "literal")continue;
        const registration=stmt.expr as Extract<Expr,{kind:"call"}>;
        let args=registration.args.map(constantValue).slice(1);
        if(registration.name === "register_set")args[0]=string(args[0]);
        else if(registration.name === "register_function")args[0]=metadata(args[0]);
        else args=args.map(metadata);
        switch(registration.name) {
            case "register_layer": break;
            case "set_layer_info": layer.setLayerInfo(args[0],args[1]);break;
            case "register_class": if(typeof layer.registerClassMetadata !== "function")throw new Error("Recovery class metadata ABI missing");
                layer.registerClassMetadata(args[0],args[1]);break;
            case "register_global_function":
                if(typeof layer.registerGlobalFunction !== "function")throw new Error("Recovery global metadata ABI missing");
                layer.registerGlobalFunction(...args);break;
            case "register_property": {
                const attrs=args[1];layer.registerProperty(args[0],attrs.type,attrs);break;
            }
            case "register_property_use": layer.useProperty(args[0]);break;
            case "register_property_hide": layer.hideProperty(args[0]);break;
            case "register_propgroup_name": layer.namePropGroup(args[0],args[1]);break;
            case "register_propgroup_props": layer.registerPropGroup(args[0],args[1]);break;
            case "register_set": {
                let value=args[1];
                if(Array.isArray(value) && value.length === 2 && typeof value[1] === "function")value=invokeBuiltin("S2::Builtin::Color__Color",[value[0]],root);
                layer.setProperty("_"+args[0],value);break;
            }
            case "register_function": layer.registerFunction(args[0],args[1]);break;
        }
    }
    return layer;
}
