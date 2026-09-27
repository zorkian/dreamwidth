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
    type Cell = {get(): any; set(value: any): void; remove?(): void};
    type Env = {vars: Map<string, Cell>; parent?: Env; context?: any};
    if(typeof s2.runtime.isContext !== "function")throw new Error("Missing authoritative Context brand ABI");
    const isContext = (value: any): boolean => s2.runtime.isContext(value);
    const layer = s2.makeLayer();
    layer.source = "active compiled layer #" + layerId;
    const makeCell = (initial: any): Cell => {
        let value=initial; return {get:()=>value,set:v=>{value=v;}};
    };
    const environment = (parent?: Env): Env => ({vars:new Map(),parent,context:parent?.context});
    const lookup = (env: Env, name: string): Cell => {
        for(let scope: Env|undefined=env;scope;scope=scope.parent) {
            const found=scope.vars.get(name); if(found)return found;
        }
        throw new Error("Unbound recovered lexical");
    };
    const string = (x: any): string => {
        if(typeof x === "number" && !Number.isSafeInteger(x))throw new Error("Recovered native integer ABI gap");
        return x === undefined || x === null ? "" : String(x);
    };
    const number = (x: any): number => {
        if(typeof x === "number")return x;
        const m=/^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(string(x));
        return m ? Number(m[0]) : 0;
    };
    const integer = (value: any): number => {
        const n=number(value);
        if(!Number.isSafeInteger(n))throw new Error("Recovered native integer ABI gap");
        return n;
    };
    const integerResult = (n: number): number => {
        if(!Number.isSafeInteger(n))throw new Error("Recovered native integer ABI gap");
        return n;
    };
    // The native generated dialect includes explicit ne '' for S2 string truth.
    // Remaining Perl scalar truth treats both '' and '0' as false.
    const truth = (x: any): boolean => x !== undefined && x !== null && x !== false && x !== 0 && x !== "" && x !== "0";
    const object = (pairs: [any,any][]): any => {
        return s2.runtime.makeHash(pairs);
    };
    const props = Symbol("properties"), vtable=Symbol("virtual table"), method=Symbol("method key");
    const isObject = (x: any) => x !== null && typeof x === "object";
    const keyFor = (base: any, key: any): any => {
        if(Array.isArray(base) && Number.isInteger(number(key)) && number(key) < 0)return base.length+number(key);
        if(base && Object.hasOwn(base, props)) return "_"+string(key);
        if(base && Object.hasOwn(base,".type")) {
            if(key === "_type")return ".type";
            if(key === "_isnull")return ".isnull";
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
        const key=keyFor(base,evalExpr(x.key,env));
        if(!isObject(base))throw new Error("Invalid recovered dereference");
        return {get:()=>Object.hasOwn(base,key) ? base[key] : undefined,
            set:v=>{Object.defineProperty(base,key,{value:v,writable:true,enumerable:true,configurable:true});},
            remove:()=>{delete base[key];}};
    };
    const list = (xs: Expr[], env: Env): any[] => xs.flatMap(x => {
        const value=evalExpr(x,env);
        return x.kind === "tuple" || (x.kind === "unary" && x.op === "@") ||
            (x.kind === "binary" && x.op === "..") ||
            (x.kind === "call" && x.name === "reverse" && x.args[0]?.kind === "unary" && x.args[0].op === "@") ? value ?? [] : [value];
    });
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
            case "get_func_num": return args[0];
            case "get_object_func_num":
                if(args[6] !== context)throw new Error("Recovered method requires executing Context");
                return {[method]:true,classname:args[0],value:args[1],name:args[2],
                layer:args[3],line:args[4],super:!!args[5],context};
            case "S2::Object::new": return object([[".type",args[0]]]);
            case "S2::notags": return s2.runtime.notags(string(args[0]));
            case "S2::check_defined": return s2.runtime.isDefined(args[0]);
            case "S2::check_elements": return Array.isArray(args[0]) ? args[0].length !== 0 : isObject(args[0]) && Object.keys(args[0]).length !== 0;
            case "S2::get_characters": return Array.from(string(args[0]));
            case "S2::object_isa":
                if(args[0] !== context)throw new Error("Recovered helper requires executing Context"); return args[0].objectIsa(args[1],args[2]);
            case "S2::downcast_object":
                if(args[0] !== context)throw new Error("Recovered helper requires executing Context"); return args[0].downcastObject(args[1],args[2],layer,args[4]);
            case "S2::interpolate_object":
                if(args[0] !== context)throw new Error("Recovered helper requires executing Context"); {
                if(!s2.runtime.isDefined(args[2]))return "";
                try {return args[0].getFunction(string(args[2][".type"])+"::"+args[3])(args[0],args[2]);}
                catch {return string(args[2]?.[".type"] ?? args[1] ?? "undef")+"::"+args[3]+" call failed.";}
            }
            case "S2::check_depth": return s2.runtime.recoveryCheckpoint(context);
            case "int": return integerResult(Math.trunc(number(args[0])));
            case "length": return Array.from(string(args[0])).length;
            case "keys": return Object.keys(args[0] ?? {});
            case "scalar": return Array.isArray(args[0]) ? args[0].length : args[0];
            case "reverse": return Array.isArray(args[0]) ? [...args[0]].reverse() : Array.from(string(args[0])).reverse().join("");
            case "pop": return args[0]?.pop();
            case "push": return args[0].push(...args.slice(1));
            default: throw new Error("Invalid recovered capability");
        }
    };
    const evalExpr = (x: Expr, env: Env): any => {
        switch(x.kind) {
            case "literal": return x.value;
            case "name": return ({VTABLE:0,STATIC:1,PROPS:2} as Record<string,number>)[x.name];
            case "variable": {
                if(x.name === "$S2::pout")return (v: any)=>env.context.print(string(v));
                if(x.name === "$S2::pout_s")return (v: any)=>env.context.safePrint(string(v));
                if(x.name === "$S2::depth_check_every")return 1;
                return lookup(env,x.name).get();
            }
            case "array": case "tuple": return list(x.items,env);
            case "hash": return object(x.entries.map(([k,v])=>[evalExpr(k,env),evalExpr(v,env)]));
            case "conditional": return evalExpr(truth(evalExpr(x.test,env)) ? x.yes : x.no,env);
            case "declare": {
                const value=x.value ? evalExpr(x.value,env) : undefined;
                const values=x.list ? value ?? [] : [value];
                x.names.forEach((n,i)=>{
                    const cell=makeCell(values[i]);env.vars.set(n,cell);
                    if(n.startsWith("@"))env.vars.set("$"+n.slice(1),cell);
                });
                return value;
            }
            case "member": {
                const base=evalExpr(x.base,env), key=evalExpr(x.key,env);
                if(isContext(base) && (base !== env.context || x.container !== "array"))throw new Error("Recovered Context hash access refused");
                if(base === env.context && x.container === "array") {
                    if(key === 0)return {[vtable]:true,context:env.context};
                    if(key === 2)return ctxProps(env.context);
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
                const mapped=keyFor(base,key);
                return Object.hasOwn(base,mapped) ? base[mapped] : undefined;
            }
            case "sub": return (...args: any[]) => {
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
            case "call": {
                const args=["scalar","keys","reverse","pop"].includes(x.name) ? x.args.map(a=>evalExpr(a,env)) :
                    x.name === "push" ? [evalExpr(x.args[0]!,env),...list(x.args.slice(1),env)] : list(x.args,env);
                return call(x.name,args,env);
            }
            case "invoke": return evalExpr(x.callee,env)(...list(x.args,env));
            case "unary": {
                if(x.op === "coderef")return (...args: any[])=>call((x.value as {name:string}).name,args,env);
                if(x.op === "delete") {const ref=reference(x.value,env);const old=ref.get();ref.remove?.();return old;}
                if(["++","--","post++","post--"].includes(x.op)) {
                    const ref=reference(x.value,env,true),old=integer(ref.get()),next=integerResult(old+(x.op.includes("++") ? 1 : -1));
                    ref.set(next);return x.op.startsWith("post") ? old : next;
                }
                const value=evalExpr(x.value,env);
                if(x.op === "!")return !truth(value);
                if(x.op === "-")return integerResult(-integer(value));
                if(x.op === "+")return integer(value);
                if(x.op === "@" || x.op === "%") {
                    if(value !== null && value !== undefined)return value;
                    const fresh=x.op === "@" ? [] : object([]);
                    reference(x.value,env,true).set(fresh);return fresh;
                }
                throw new Error("Invalid recovered unary operation");
            }
            case "binary": {
                if(x.op === "=") {const right=evalExpr(x.right,env);reference(x.left,env,true).set(right);return right;}
                const a=evalExpr(x.left,env);
                if(x.op === "&&")return truth(a) ? evalExpr(x.right,env) : a;
                if(x.op === "||")return truth(a) ? a : evalExpr(x.right,env);
                const b=evalExpr(x.right,env);
                switch(x.op) {
                    case ".": return string(a)+string(b);
                    case "+": return integerResult(integer(a)+integer(b));
                    case "-": return integerResult(integer(a)-integer(b));
                    case "*": return integerResult(integer(a)*integer(b));
                    case "/": if(integer(b) === 0)throw new Error("Recovered division by zero");return integer(a)/integer(b);
                    case "%": {const n=integer(b);if(n === 0)throw new Error("Recovered modulo by zero");return ((integer(a)%n)+n)%n;}
                    case "eq": return string(a) === string(b);
                    case "ne": return string(a) !== string(b);
                    case "lt": return string(a)<string(b);
                    case "le": return string(a)<=string(b);
                    case "gt": return string(a)>string(b);
                    case "ge": return string(a)>=string(b);
                    case "==": return integer(a) === integer(b);
                    case "!=": return integer(a) !== integer(b);
                    case "<": return integer(a)<integer(b);
                    case "<=": return integer(a)<=integer(b);
                    case ">": return integer(a)>integer(b);
                    case ">=": return integer(a)>=integer(b);
                    case "..": return s2.runtime.makeRange(number(a),number(b));
                    default: throw new Error("Invalid recovered binary operation");
                }
            }
        }
    };
    type Signal = {kind:"return"|"last"|"next";value?:any};
    const run = (body: Stmt[], parent: Env, scoped=true): Signal|undefined => {
        const env=scoped ? environment(parent) : parent;
        for(const stmt of body) {
            switch(stmt.kind) {
                case "expr": evalExpr(stmt.expr,env);break;
                case "block": {const signal=run(stmt.body,env);if(signal)return signal;break;}
                case "return": return {kind:"return",value:stmt.value ? evalExpr(stmt.value,env) : undefined};
                case "last": case "next": return {kind:stmt.kind};
                case "if": {
                    const branch=stmt.branches.find(b=>truth(evalExpr(b.test,env)));
                    const signal=run(branch ? branch.body : stmt.otherwise,env);if(signal)return signal;break;
                }
                case "while": case "for": {
                    const scope=environment(env);
                    if(stmt.kind === "for")evalExpr(stmt.init,scope);
                    while(truth(evalExpr(stmt.test,scope))) {
                        s2.runtime.recoveryCheckpoint(scope.context);
                        const signal=run(stmt.body,scope);
                        if(signal?.kind === "return")return signal;
                        if(signal?.kind === "last")break;
                        if(stmt.kind === "for")evalExpr(stmt.step,scope);
                    }
                    break;
                }
                case "foreach": {
                    const scope=environment(env), items=evalExpr(stmt.list,scope) ?? [];
                    if(stmt.variable.kind === "declare")evalExpr(stmt.variable,scope);
                    const variable=stmt.variable.kind === "declare" ? {kind:"variable",name:stmt.variable.names[0]!} as Expr : stmt.variable;
                    const original=reference(variable,scope,true),saved=original.get();
                    try {
                        for(let i=0;i<items.length;i++) {
                            s2.runtime.recoveryCheckpoint(scope.context);
                            original.set(items[i]);
                            const signal=run(stmt.body,scope);
                            items[i]=original.get();
                            if(signal?.kind === "return")return signal;
                            if(signal?.kind === "last")break;
                        }
                    } finally {original.set(saved);}
                    break;
                }
            }
        }
        return undefined;
    };
    const root=environment();
    root.vars.set("$S2::sub_ctr",makeCell(0));
    const constantValue = (x: Expr): any => evalExpr(x,root);
    for(const stmt of program) {
        if(stmt.kind !== "expr")throw new Error("Invalid recovered top level");
        if(stmt.expr.kind === "literal")continue;
        const registration=stmt.expr as Extract<Expr,{kind:"call"}>;
        const args=registration.args.map(constantValue).slice(1);
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
