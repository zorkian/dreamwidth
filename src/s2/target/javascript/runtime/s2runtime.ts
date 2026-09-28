// s2runtime.ts
//
// Synchronous runtime for trusted, offline S2 JavaScript fixture artifacts.
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

import {raiseNativeExecutionStop, nativeProgramError, isNativeProgramError} from './native-scalar';
import {NativeSink, scalarPV, scalarNumber, scalarConcat, scalarTruthy, scalarNotags, scalarCopy, incrementScalar, legacyText, NativeString, NativeNumber} from "./native-scalar";

import {arithmetic, divide, modulo, intCast, numericCompare, arrayIndex} from "./native-number";

import {NativeProfile} from "./native-profile";
import * as nativeStrings from "./native-string";

export const ABI_VERSION = 1;

type EvaluationMode = "scalar" | "list" | "void";
let evaluationMode: EvaluationMode = "scalar";
function evaluateAs<T>(mode: EvaluationMode, operation: () => T): T {
    const previous=evaluationMode;
    evaluationMode=mode;
    try {return operation();} finally {evaluationMode=previous;}
}
const contextBrands = new WeakSet<object>();
const hashIdentities = new WeakMap<object, Map<string, NativeString>>();

type S2Function = (context: Context, ...args: unknown[]) => unknown;
type S2Object = Record<string, unknown>;

function object(value: unknown): value is S2Object {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneData(value: unknown, seen = new Map<object, unknown>()): unknown {
    if (NativeString.is(value) || NativeNumber.is(value)) return scalarCopy(value);
    if (typeof value !== "object" || value === null) return value;
    if (seen.has(value)) return seen.get(value);
    const copy: unknown[] | S2Object = Array.isArray(value) ? [] : Object.create(null);
    seen.set(value, copy);
    if (Array.isArray(value)) (copy as unknown[]).length = value.length;
    for (const key of Object.keys(value)) {
        (copy as S2Object)[key] = cloneData((value as S2Object)[key], seen);
    }
    const identities = hashIdentities.get(value);
    if (identities) hashIdentities.set(copy, new Map([...identities].map(([key, pv]) => [key, pv.clone()])));
    return copy;
}

export interface InvocationClock { nowMilliseconds(): number; }
export type NativeRunOrigin = 'top-level' | 'plural' | 'ordinal';
const nativeSites = new WeakMap<Layer, Map<number, object>>();
const functionEntries = new WeakMap<S2Function, object>();
const hostSites = Object.freeze({
    'top-level': Object.freeze({}), plural: Object.freeze({}), ordinal: Object.freeze({}),
    runEval: Object.freeze({}), runCall: Object.freeze({}),
});
function nativeSite(layer: Layer, line: number): object {
    if (!Number.isSafeInteger(line) || line < 1) throw new Error('Invalid native COP');
    let sites = nativeSites.get(layer);
    if (!sites) { sites = new Map(); nativeSites.set(layer, sites); }
    let site = sites.get(line);
    if (!site) { site = Object.freeze({}); sites.set(line, site); }
    return site;
}

export class Layer {
    scalarProfile?: NativeProfile;
    source = "<unknown S2 layer>";
    readonly info: Record<string, string> = Object.create(null);
    readonly functions = new Map<string, S2Function>();
    readonly properties = new Map<string, unknown>();
    readonly classes = new Map<string, string | undefined>();
    readonly declarations = new Map<string, {type: string; attributes: Readonly<Record<string, string>>}>();
    readonly propertyUses: string[] = [];
    readonly hiddenProperties = new Set<string>();
    readonly propertyGroups = new Map<string, readonly string[]>();
    readonly propertyGroupNames = new Map<string, string>();
    readonly classMetadata = new Map<string, Readonly<Record<string, unknown>>>();
    readonly globalFunctions = new Map<string, {returntype:string;docstring:string;attrs:string}>();

    setLayerInfo(key: string, value: string): void {
        this.info[key] = value;
    }

    registerClass(name: string, parent?: string): void {
        this.classes.set(name, parent);
    }

    registerClassMetadata(name: string, nativeData: Record<string, unknown>): void {
        this.classMetadata.set(name, cloneData(nativeData) as Record<string, unknown>);
        this.registerClass(name, typeof nativeData.parent === "string" ? nativeData.parent : undefined);
    }

    registerGlobalFunction(signature: string, returntype: string, docstring: string, attrs: string): void {
        this.globalFunctions.set(signature, {returntype, docstring, attrs});
    }

    registerFunction(names: string[], factory: () => S2Function, nativeEntryLine?: number): void {
        const implementation = factory();
        if (nativeEntryLine !== undefined) functionEntries.set(implementation, nativeSite(this, nativeEntryLine));
        for (const name of names) this.functions.set(name, implementation);
    }

    registerProperty(name: string, type: string, attributes: object): void {
        this.declarations.set(name, {type, attributes: Object.freeze({...attributes})});
    }

    hideProperty(name: string): void { this.hiddenProperties.add(name); }
    useProperty(name: string): void { this.propertyUses.push(name); }
    namePropGroup(name: string, displayName: string): void { this.propertyGroupNames.set(name, displayName); }
    registerPropGroup(name: string, members: string[]): void {
        this.propertyGroups.set(name, Object.freeze([...members]));
    }

    setProperty(name: string, value: unknown): void {
        this.properties.set(name, value);
    }
}

function nativeHashKey(value: unknown): string {
    if (!NativeString.is(value) && !NativeNumber.is(value)) return String(value);
    const key = nativeStrings.hashKeyBytes(scalarPV(value));
    return (key.utf8 ? "\u0000utf8:" : "\u0000pv:") + key.bytes.toString("hex");
}

interface OperandSlot { get(): unknown; set?(value: unknown): unknown; }
const operandCells = new WeakMap<object, OperandSlot>();
function readOperand(value: unknown): unknown {
    return value !== null && typeof value === "object" && operandCells.has(value)
        ? operandCells.get(value)!.get() : value;
}
function captureOperand(slot: OperandSlot): object {
    const operand = Object.freeze({});
    operandCells.set(operand, slot);
    return operand;
}

export const runtime = {
    captureOperand(slot: OperandSlot & {exists?(): boolean}): object {
        return captureOperand(slot.exists && !slot.exists() ? {get: () => undefined} : slot);
    },
    readOperand,
    operandList(operands: readonly unknown[]): unknown[] {
        return operands.map(value => scalarCopy(readOperand(value)));
    },
    pvBytes(hex: string): NativeString {
        if (!/^(?:[0-9a-f]{2})*$/.test(hex)) throw new Error("Invalid native PV literal");
        return NativeString.bytes(Buffer.from(hex, "hex"));
    },
    // Native dereference creates a missing container through its actual lvalue,
    // even for reads; the final absent element itself remains absent.
    referenceValue(slot: {get(): unknown; set?(value: unknown): unknown}, kind: "array" | "hash" | "field"): unknown {
        let value = slot.get();
        if (value === undefined || value === null) {
            value = kind === "array" ? [] : runtime.makeHash([]);
            if (!slot.set) throw new Error("Missing native reference lvalue");
            slot.set(value);
        }
        if (runtime.isContext(value)) throw new Error("S2 Context dereference refused");
        return value;
    },
    memberSlot(receiver: unknown, key: unknown, kind: "array" | "hash" | "field") {
        if (receiver === null || typeof receiver !== "object" || runtime.isContext(receiver)) {
            throw new Error("Invalid S2 lvalue receiver");
        }
        let property: string;
        if (kind === "array") {
            if (!Array.isArray(receiver)) throw new Error("S2 array lvalue requires an array");
            let index = arrayIndex(scalarNumber(key));
            if (index < 0n) index += BigInt(receiver.length);
            property = index.toString();
            return {
                exists: () => Object.hasOwn(receiver, property),
                get: () => index < 0n || index >= BigInt(receiver.length) ? undefined : receiver[Number(index)],
                set: (value: unknown) => {
                    if (index < 0n) throw nativeProgramError("Modification of non-creatable array value");
                    // JavaScript's array length is a transport constraint; do not
                    // wrap a wide positive index into another native element.
                    if (index >= 4294967295n) throw new Error("S2 array allocation exceeds transport bounds");
                    receiver[Number(index)] = value;
                    return value;
                },
            };
        }
        // Untyped native hash references have no class marker. Generated field
        // spelling still addresses the same logical keys as source hash syntax.
        if (kind === "field" && hashIdentities.has(receiver) && !Object.hasOwn(receiver, ".type")) {
            const name = String(key);
            key = NativeString.bytes(Buffer.from(name.startsWith("_") ? name.slice(1) : name, "latin1"));
            kind = "hash";
        }
        property = kind === "hash" ? nativeHashKey(key) : String(key);
        const target = receiver as Record<string, unknown>;
        return {exists: () => Object.hasOwn(target, property), get: () => target[property], delete: () => {
            hashIdentities.get(target)?.delete(property);
            return delete target[property];
        }, set: (value: unknown) => {
            if (kind === "hash" && (NativeString.is(key) || NativeNumber.is(key))) {
                let identities = hashIdentities.get(target);
                if (!identities) { identities = new Map(); hashIdentities.set(target, identities); }
                identities.set(property, scalarPV(key));
            }
            Object.defineProperty(target, property, {value, writable: true, enumerable: true, configurable: true});
            return value;
        }};
    },
    deleteSlot(slot: {delete?(): boolean}): boolean {
        if (!slot.delete) throw new Error("Native delete requires a hash element");
        return slot.delete();
    },
    pushSlot(slot: {get(): unknown; set(value: unknown): unknown}, operation: () => unknown,
        spread: boolean): void {
        let target = slot.get();
        if (target === undefined || target === null) { target = []; slot.set(target); }
        if (!Array.isArray(target)) throw new Error("Native push requires an array");
        const value = evaluateAs(spread ? "scalar" : "list", operation);
        if (spread) {
            const values = runtime.asArray(value);
            // Do not use spread-call arguments: native lists can exceed V8's
            // call-argument limit. Capture the list before mutating its target.
            const copy = values.map(item => scalarCopy(item));
            for (const item of copy) target.push(item);
        } else target.push(scalarCopy(value));
    },
    assignSlot(slot: {get(): unknown; set(value: unknown): unknown}, value: unknown, notags: boolean,
        operand = false): unknown {
        const resolved = readOperand(value);
        const result = slot.set(notags ? scalarNotags(resolved) : scalarCopy(resolved));
        return operand ? captureOperand(slot) : result;
    },
    incrementSlot(slot: {get(): unknown; set(value: unknown): unknown}, plus: boolean, pre: boolean, operand = false): unknown {
        const before = scalarCopy(slot.get());
        const after = incrementScalar(slot.get(), plus);
        slot.set(after);
        return pre ? operand ? captureOperand(slot) : after : before;
    },
    scalarCopy,
    scalarTruthy,
    s2StringTruthy(value: unknown): boolean { return scalarPV(value).bytes().length !== 0; },
    scalarLogical(op: "and" | "or", left: unknown, right: () => unknown): unknown {
        return op === "and" ? scalarTruthy(left) ? right() : left : scalarTruthy(left) ? left : right();
    },
    scalarNumber,
    scalarPV,
    scalarInt(value: unknown): NativeNumber { return intCast(scalarNumber(value)); },
    scalarCompare(kind: string, op: string, left: unknown, right: unknown): boolean {
        left = readOperand(left); right = readOperand(right);
        const comparison = kind === "string" ? nativeStrings.compareStrings(scalarPV(left), scalarPV(right)) :
            numericCompare(scalarNumber(left), scalarNumber(right));
        switch (op) {
            case "==": return comparison === 0;
            case "!=": return comparison !== 0;
            case "<": return comparison < 0;
            case "<=": return comparison <= 0;
            case ">": return comparison > 0;
            case ">=": return comparison >= 0;
            default: throw new Error("Unknown scalar comparison");
        }
    },
    scalarNegate(value: unknown): NativeNumber { return arithmetic("-", NativeNumber.integer(0n), scalarNumber(value)); },
    numericLiteral(lexeme: string): NativeNumber { return NativeNumber.literal(lexeme); },
    scalarBinary(op: string, left: unknown, right: unknown): NativeString | NativeNumber {
        left = readOperand(left); right = readOperand(right);
        if (op === "concat") return scalarConcat(left, right);
        const a = scalarNumber(left), b = scalarNumber(right);
        if (op === "/") return intCast(divide(a, b));
        if (op === "%") return modulo(a, b);
        if (op === "+" || op === "-" || op === "*") return arithmetic(op, a, b);
        throw new Error("Unknown native scalar operator");
    },
    scalarConcatChain(operands: readonly (() => unknown)[]): NativeString {
        if (!operands.length) return NativeString.bytes(new Uint8Array());
        // Perl's multiconcat reads borrowed SVs only after every operand runs.
        const captured = operands.map(operation => evaluateAs("scalar", operation));
        let value: unknown = readOperand(captured[0]);
        for (let index = 1; index < captured.length; index++) {
            value = scalarConcat(value, readOperand(captured[index]));
        }
        return scalarPV(value);
    },
    isContext(value: unknown): value is Context {
        return typeof value === "object" && value !== null && contextBrands.has(value);
    },
    evaluateAs,
    evaluationContext(): EvaluationMode { return evaluationMode; },
    reverseNative(value: unknown): NativeString {
        const pv=scalarPV(value);
        return evaluationMode === "scalar" ? nativeStrings.reverseString(pv) : pv;
    },
    reverseInContext(context: Context, value: unknown): NativeString {
        if (!runtime.isContext(context)) throw new Error("Invalid native evaluation Context");
        return runtime.reverseNative(value);
    },
    recoveryCheckpoint(context: Context): void { context.recoveryCheckpoint(); },
    executionCheckpoint(context: Context): void { context.checkExecutionDeadline(); },
    nativeCOP(context: Context, layer: Layer, line: number): void { context.setNativeCOP(layer, line); },
    nativeFunctionEntry(fn: S2Function, layer: Layer, line: number): void {
        functionEntries.set(fn, nativeSite(layer, line));
    },
    makeHash(pairs: readonly (readonly [unknown, unknown])[]): Record<string, unknown> {
        const hash: Record<string, unknown> = Object.create(null);
        const identities = new Map<string, NativeString>();
        for (const [keyOperand, valueOperand] of pairs) {
            const key = readOperand(keyOperand), value = readOperand(valueOperand);
            const encoded = nativeHashKey(key);
            hash[encoded] = scalarCopy(value);
            if (NativeString.is(key) || NativeNumber.is(key)) identities.set(encoded, scalarPV(key));
        }
        hashIdentities.set(hash, identities);
        return hash;
    },
    prepareString(value: unknown): string {
        if (value === null || value === undefined) return "";
        if (object(value) && value[".isnull"]) return "";
        if (NativeString.is(value) || NativeNumber.is(value)) return scalarPV(value) as unknown as string;
        return String(value);
    },

    objectToBool(value: unknown): boolean {
        return value !== null && value !== undefined && !(object(value) && value[".isnull"]);
    },

    objectInstanceOf(value: unknown, type: string): boolean {
        return object(value) && !value[".isnull"] && value[".type"] === type;
    },

    hashSize(value: Record<string, unknown>): number {
        return Object.keys(value ?? {}).length;
    },

    hashToBool(value: Record<string, unknown>): boolean {
        return Object.keys(value ?? {}).length !== 0;
    },

    hashKeys(value: unknown): string[] {
        if (value === null || value === undefined) return [];
        if (!object(value)) throw new Error("S2 hash foreach requires a hash");
        const identities = hashIdentities.get(value);
        return Object.keys(value).map(key => identities?.get(key)?.clone() ?? key) as string[];
    },

    characters(value: unknown): string[] {
        if (NativeString.is(value)) return nativeStrings.byteCharacters(value) as unknown as string[];
        return Array.from(String(value ?? ""));
    },

    asArray(value: unknown): unknown[] {
        if (value === null || value === undefined) return [];
        if (!Array.isArray(value)) throw new Error("S2 array foreach requires an array");
        return value;
    },

    *iterationSlots(value: unknown, kind: "array" | "hash" | "string") {
        if (kind === "array") {
            const values = runtime.asArray(value);
            // Native foreach aliases each array element and observes changes to
            // the remaining array while iterating. Do not clone the collection.
            for (let index = 0; index < values.length; index++) {
                yield runtime.memberSlot(values, NativeNumber.integer(BigInt(index)), "array");
            }
            return;
        }
        const values = kind === "hash" ? runtime.hashKeys(value) : runtime.characters(value);
        for (const value of values) {
            let current: unknown = scalarCopy(value);
            yield {get: () => current, set: (next: unknown) => current = next};
        }
    },

    isDefined(value: unknown): boolean {
        return object(value) && value[".type"] !== undefined && value[".type"] !== null && !scalarTruthy(value[".isnull"]);
    },

    makeRange(first: number, last: number): number[] {
        if (NativeNumber.is(first) || NativeNumber.is(last)) {
            const a = arrayIndex(scalarNumber(first)), b = arrayIndex(scalarNumber(last));
            if (b < a) return [];
            // The child memory/CPU limits govern allocation. This check is only
            // the representation's real array-length limit, not a fixture cap.
            if (b - a + 1n > 4294967295n) throw new Error("S2 range exceeds array transport bounds");
            const values: NativeNumber[] = [];
            for (let index = a; index <= b; index++) values.push(NativeNumber.integer(index));
            return values as unknown as number[];
        }
        if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) {
            throw new Error("S2 range requires safe integers in this slice");
        }
        if (last < first) return [];
        if (last - first > 100_000) throw new Error("S2 fixture range exceeds 100000 elements");
        return Array.from({ length: last - first + 1 }, (_, index) => first + index);
    },

    stringLength(value: string): number {
        if (NativeString.is(value)) return nativeStrings.stringLength(value);
        return Buffer.byteLength(value, "utf8");
    },

    stringSubstr(value: string, start: number, length: number): string {
        if (NativeString.is(value)) return nativeStrings.builtinSubstr(value, start, length) as unknown as string;
        const characters = Array.from(value);
        const offset = start < 0 ? Math.max(0, characters.length + start) : start;
        return characters.slice(offset, offset + length).join("");
    },

    reverseArray<T>(value: T[]): T[] {
        return [...value].reverse();
    },

    reverseString(value: string): string {
        if (NativeString.is(value)) return nativeStrings.reverseString(value) as unknown as string;
        return Array.from(value).reverse().join("");
    },

    notags(value: string): string {
        if (NativeString.is(value)) return scalarNotags(value) as unknown as string;
        return value.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    },
};

// The real HTMLCleaner receives only S2 `print safe` chunks. For the pinned
// trusted page, its reached serialization rules are text angle escaping,
// attribute quote canonicalization, trailing-tag-space removal, and omitted
// comments. Unported cleaner decisions must fail instead of passing through.
export interface TrustedStylesheet {
    href: string;
    decision: number;
}

export function cleanTrustedSafeChunk(input: string, stylesheet?: TrustedStylesheet): string {
    let output = "";
    for (let index = 0; index < input.length;) {
        if (input.startsWith("<!--", index)) {
            const end = input.indexOf("-->", index + 4);
            if (end < 0) throw new Error("Unclosed safe HTML comment");
            index = end + 3;
            continue;
        }
        if (input[index] !== "<" || !/[A-Za-z/!]/.test(input[index + 1] ?? "")) {
            const char = input[index++]!;
            output += char === "<" ? "&lt;" : char === ">" ? "&gt;" : char;
            continue;
        }
        if (input[index + 1] === "!") {
            throw new Error("Unsupported safe HTML declaration");
        }
        let cursor = index + 1;
        let quote = "";
        let tag = "<";
        for (; cursor < input.length; cursor++) {
            const char = input[cursor]!;
            if (quote) {
                if (char === quote) {
                    tag += '"';
                    quote = "";
                } else if (char === '"' && quote === "'") {
                    tag += "&quot;";
                } else if (char === "'" && quote === '"') {
                    tag += "&#39;";
                } else if (char === "&") {
                    const rest = input.slice(cursor);
                    if (rest.startsWith("&#") && !rest.startsWith("&#39;")) {
                        throw new Error("Unsupported numeric safe HTML attribute entity");
                    }
                    const entity = /^&(?:amp|quot|lt|gt|#39);/.exec(rest);
                    if (entity) {
                        tag += entity[0];
                        cursor += entity[0].length - 1;
                    } else if (/^&[A-Za-z][A-Za-z0-9]+;/.test(rest)) {
                        throw new Error("Unsupported safe HTML attribute entity");
                    } else {
                        tag += "&amp;";
                    }
                } else if (char === "<") {
                    tag += "&lt;";
                } else if (char === ">") {
                    tag += "&gt;";
                } else if (char === "\n" || char === "\r") {
                    throw new Error("Unsupported multiline safe HTML attribute");
                } else {
                    tag += char;
                }
            } else if (char === "'" || char === '"') {
                quote = char;
                tag += '"';
            } else if (char === ">") {
                break;
            } else {
                tag += char;
            }
        }
        if (cursor >= input.length || quote) throw new Error("Unclosed safe HTML tag");
        const original = input.slice(index, cursor + 1);
        const head = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)/.exec(original);
        if (!head) throw new Error("Unsupported safe HTML tag");
        const name = head[2]!.toLowerCase();
        if (/^(script|object|iframe|applet|embed|param|style)$/.test(name) ||
            /^(?:g|fb):/.test(name)) {
            throw new Error(`Unsupported safe HTML element ${name}`);
        }
        const rest = original.slice(head[0].length, -1);
        if (head[1]) {
            if (rest.trim() !== "") throw new Error("Unsupported safe HTML end tag");
            output += `</${name}>`;
            index = cursor + 1;
            continue;
        }
        const attributes: Record<string, string> = Object.create(null);
        let remaining = rest.replace(/\s*\/\s*$/, "");
        while (remaining.trim()) {
            const match = /^\s+([A-Za-z_:][A-Za-z0-9_:.-]*)\s*=\s*(["'])(.*?)\2/s.exec(remaining);
            if (!match) throw new Error("Unsupported safe HTML attribute shape");
            const key = match[1]!.toLowerCase();
            if (match[1] !== key || match[0] !== ` ${key}=${match[2]}${match[3]}${match[2]}`) {
                throw new Error("Unsupported safe HTML attribute spacing or case");
            }
            if (key in attributes || /^on/.test(key) || key === "datasrc" ||
                key === "datafld" || key === "style" && match[3] !== "font-size: smaller;") {
                throw new Error(`Unsupported safe HTML attribute ${key}`);
            }
            // Only the reached ehtml encodings, decoded once. A literal source
            // &amp; or &#39; remains entity-looking text after this pass.
            const value = match[3]!.replace(/&(?:amp|quot|lt|gt|#39);/g, entity =>
                ({"&amp;":"&", "&quot;":'"', "&lt;":"<", "&gt;":">", "&#39;":"'"})[entity]!);
            if (/((?:java|vb)script|about):/i.test(value.replace(/[\s\0]/g, ""))) {
                throw new Error("Unsupported safe HTML attribute URL");
            }
            if ((key === "href" || key === "src") &&
                (/[\s\x00-\x1f\x7f]/.test(value) || /^(?:data|blob|file|filesystem):/i.test(value))) {
                throw new Error("Unsupported safe HTML URL whitespace or active scheme");
            }
            attributes[key] = value;
            remaining = remaining.slice(match[0].length);
        }
        if (name === "meta" || name === "input" && attributes.type?.toLowerCase() === "password") {
            throw new Error(`Unsupported safe HTML element ${name}`);
        }
        if (name === "link") {
            if (attributes.rel?.toLowerCase() !== "stylesheet" ||
                typeof attributes.href !== "string" ||
                attributes.href !== stylesheet?.href || stylesheet?.decision !== 1 ||
                !/^https?:\/\/[^/]+\/.*$/.test(attributes.href)) {
                throw new Error("Unsupported safe HTML stylesheet link");
            }
        }
        tag = tag.replace(/^<[A-Za-z][A-Za-z0-9:-]*/, `<${name}`);
        if (tag.endsWith("/")) {
            tag = tag.slice(0, -1).trimEnd() + " /";
        } else {
            tag = tag.trimEnd();
        }
        output += tag + ">";
        index = cursor + 1;
    }
    return output;
}

export type BuiltinFunction = (context: Context, ...args: any[]) => unknown;
export type FixtureBuiltins = Record<string, BuiltinFunction>;

export const builtin = {
    construct_Color(value: string | NativeString | NativeNumber): S2Object | undefined {
        // This host constructor recognizes ASCII color syntax. Inspect scalar
        // octets without coercing a private scalar object through JS String().
        const text = typeof value === "string" ? value : scalarPV(value).bytes().toString("latin1");
        let hex = text.replace(/^#/, "");
        if (hex === "") return {".type": "Color", _as_string: ""};
        if (/^[0-9a-fA-F]{3}$/.test(hex)) hex = [...hex].map(char => char + char).join("");
        if (typeof value === "string" ? !/^[0-9a-fA-F]{6}$/.test(hex) :
            hex.length !== 6 || /[^0-9a-fA-F]/.test(hex)) return undefined;
        return {
            ".type": "Color",
            _as_string: "#" + hex.toLowerCase(),
            _r: parseInt(hex.slice(0, 2), 16),
            _g: parseInt(hex.slice(2, 4), 16),
            _b: parseInt(hex.slice(4, 6), 16),
        };
    },
};

const fixtureBuiltins: FixtureBuiltins = {
    _string__length(_context, value) {
        return NativeString.is(value) ? NativeNumber.integer(BigInt(nativeStrings.stringLength(value))) : runtime.stringLength(value);
    },
    _string__index(_context, value, needle, position) {
        const offset = arrayIndex(scalarNumber(position));
        if (offset > BigInt(nativeStrings.stringLength(scalarPV(value)))) return NativeNumber.integer(-1n);
        return NativeNumber.integer(BigInt(nativeStrings.stringIndex(scalarPV(value), scalarPV(needle), Number(offset < 0n ? 0n : offset))));
    },
    _string__substr(_context, value, start, length) {
        if (!NativeString.is(value)) return runtime.stringSubstr(value, start, length);
        const offset = arrayIndex(scalarNumber(start)), count = arrayIndex(scalarNumber(length));
        const bound = BigInt(value.bytes().length);
        if (offset > bound || offset < -bound) return NativeString.bytes(new Uint8Array());
        return nativeStrings.builtinSubstr(value, Number(offset), Number(count > bound ? bound : count < -bound ? -bound : count));
    },
    _string__lower(context, value) { return nativeStrings.caseString(scalarPV(value), "lower",context.scalarProfile); },
    _string__upper(context, value) { return nativeStrings.caseString(scalarPV(value), "upper",context.scalarProfile); },
    _string__upperfirst(context, value) { return nativeStrings.caseString(scalarPV(value), "upperfirst",context.scalarProfile); },
    _string__starts_with(_context, value, needle) { return nativeStrings.startsWith(scalarPV(value), scalarPV(needle)); },
    _string__ends_with(_context, value, needle) { return nativeStrings.endsWith(scalarPV(value), scalarPV(needle)); },
    _string__contains(_context, value, needle) { return nativeStrings.stringIndex(scalarPV(value), scalarPV(needle)) >= 0; },
    _string__replace(_context, value, find, replacement) { return nativeStrings.replaceString(scalarPV(value), scalarPV(find), scalarPV(replacement)); },
    _string__split(_context, value, separator) { return nativeStrings.splitString(scalarPV(value), scalarPV(separator)); },
    _string__compare(_context, value, other) { return NativeNumber.integer(BigInt(nativeStrings.compareStrings(scalarPV(other), scalarPV(value)))); },
    _string__repeat(_context, value, times) {
        const pv = scalarPV(value), number = scalarNumber(times), wire = number.wire();
        const count = wire.mode === "nv" ? Buffer.from(wire.value, "hex").readDoubleBE() : Number(BigInt(wire.value));
        if (nativeStrings.stringLength(pv) * count > 5000) return NativeString.hostUtf8Bytes("[too large]");
        if (!(count > 0) || !pv.bytes().length) return NativeString.bytes(new Uint8Array());
        const chunks = Array.from({length: Math.trunc(count)}, () => pv.bytes());
        return pv.flagged() ? NativeString.flagged(Buffer.concat(chunks)) : NativeString.bytes(Buffer.concat(chunks));
    },
};

export class Context {
    readonly prop: Record<string, unknown> = Object.create(null);
    readonly builtin: FixtureBuiltins;
    readonly scalarProfile?: NativeProfile;
    private readonly functions = new Map<string, S2Function>();
    private readonly classes = new Map<string, string | undefined>();
    private readonly methodFrames: string[] = [];
    private readonly callFrames: {label: string; cop: object | string}[] = [];
    private readonly nativeHostFrames: object[] = [];
    private runDepth = 0;
    private lastDepthCheck = 0;
    private readonly now: () => number;
    private readonly loadedLayers: Set<Layer>;
    private deadline = 0;
    private functionCalls = 0;
    private printCalls = 0;
    private readonly sinkOwnsPrintCheckpoints: boolean;
    evaluationContext(): EvaluationMode { return evaluationMode; }
    evaluateAs<T>(mode: EvaluationMode, operation: () => T): T { return evaluateAs(mode, operation); }

    constructor(
        layers: Layer[], private readonly write: (text: string) => void,
        properties?: Record<string, unknown>, callbacks?: FixtureBuiltins,
        private readonly safeOutput: (text: string) => string = runtime.notags,
        private readonly maxRecursion = 500,
        private readonly nativeSink?: NativeSink,
        clock?: InvocationClock,
    ) {
        if (!Number.isSafeInteger(maxRecursion) || maxRecursion < 1) throw new Error("Invalid S2 recursion bound");
        this.now = clock ? clock.nowMilliseconds.bind(clock) : () => performance.now();
        this.loadedLayers = new Set(layers);
        this.sinkOwnsPrintCheckpoints = nativeSink?.ownsPrintCheckpoints === true;
        this.scalarProfile=layers.find(layer=>layer.scalarProfile)?.scalarProfile;
        contextBrands.add(this);
        for (const layer of layers) {
            for (const [name, implementation] of layer.functions) {
                this.functions.set(name, implementation);
            }
            // A program may reuse a cached artifact, never mutable request state.
            // Composite/class values retain their data shape and graph identity.
            for (const [name, value] of layer.properties) this.prop[name] = cloneData(value);
            for (const [name, parent] of layer.classes) this.classes.set(name, parent);
        }
        if (properties) {
            for (const [name, value] of Object.entries(properties)) this.prop[`_${name}`] = value;
        }
        // S2::make_context checks every declaring layer after merging sets. Labels
        // are not enum values, and invalid values disappear rather than falling
        // back to a lower layer's set. Perl-false scalar values bypass this check.
        for (const layer of layers) for (const [name, declaration] of layer.declarations) {
            const value = this.prop[name];
            if (!scalarTruthy(value)) continue;
            const {values, allow_other} = declaration.attributes;
            if (!values || values === "0" || (allow_other && allow_other !== "0")) continue;
            const pairs = values.split("|");
            while (pairs[pairs.length - 1] === "") pairs.pop();
            const allowed = new Map<string, string | undefined>();
            for (let index = 0; index < pairs.length; index += 2) allowed.set(pairs[index]!, pairs[index + 1]);
            const key = value === true ? "1" : NativeString.is(value) || NativeNumber.is(value) ? legacyText(scalarPV(value)) : String(value);
            const label = allowed.get(key);
            if (!label || label === "0") delete this.prop[name];
        }
        const functions: FixtureBuiltins = { ...fixtureBuiltins, ...callbacks };
        this.builtin = new Proxy(functions, {
            get(target, name) {
                if (typeof name !== "string" || !(name in target)) {
                    throw new Error(`Unknown S2 host capability ${String(name)}`);
                }
                return target[name];
            },
        });
    }

    print(value: unknown): void {
        if (!this.sinkOwnsPrintCheckpoints && ++this.printCalls % 8 === 0) this.recoveryCheckpoint();
        if (this.nativeSink) this.nativeSink.raw(scalarPV(value));
        else this.write(NativeString.is(value) || NativeNumber.is(value) ? legacyText(scalarPV(value)) : String(value));
    }

    objectIsa(value: unknown, type: string): boolean {
        if (!object(value) || value[".isnull"] || typeof value[".type"] !== "string") return false;
        let current: string | undefined = value[".type"];
        while (current !== undefined) {
            if (current === type) return true;
            current = this.classes.get(current);
        }
        return false;
    }

    downcastObject(value: unknown, type: string, layer: Layer, line: number): unknown {
        if (runtime.isDefined(value) && !this.objectIsa(value, type)) {
            throw nativeProgramError(`${layer.source}:${line}: cannot cast object to ${type}`);
        }
        return value;
    }

    toString(value: unknown): string {
        if (!runtime.isDefined(value)) return "";
        const result = this.getMethod(value, "as_string()", { source: "<interpolation>" } as Layer, 0)(this, value);
        return NativeString.is(result) || NativeNumber.is(result) ? result as unknown as string : String(result);
    }

    safePrint(value: unknown): void {
        if (!this.sinkOwnsPrintCheckpoints && ++this.printCalls % 8 === 0) this.recoveryCheckpoint();
        if (this.nativeSink) this.nativeSink.safe(scalarPV(value));
        else this.write(this.safeOutput(NativeString.is(value) || NativeNumber.is(value) ? legacyText(scalarPV(value)) : String(value)));
    }

    getFunction(name: string): S2Function {
        const implementation = this.functions.get(name);
        if (!implementation) throw nativeProgramError(`Undefined S2 function ${name}`);
        return (context, ...args) => this.invoke(name, implementation, context, args);
    }

    checkExecutionDeadline(): void {
        if (this.deadline && this.now() > this.deadline) raiseNativeExecutionStop("deadline");
    }

    recoveryCheckpoint(): void {
        // Native run_function defaults to four seconds. DW configuration sets
        // MAX_RECURSION to500, overriding check_depth's standalone fallback50.
        // Entry and print checkpoints use the native depth cadence; loop
        // backedges check only the independent execution deadline.
        const now = this.now();
        this.checkExecutionDeadline();
        // S2.pm513 is a liveness window, not a throttle: a lapse never refreshes it.
        if (this.lastDepthCheck < now - 150) return;
        this.lastDepthCheck = now;
        const counts = new Map<object | string, number>();
        for (const site of [...this.nativeHostFrames, ...this.callFrames.map(frame => frame.cop)]) {
            const count = (counts.get(site) ?? 0) + 1;
            if (count >= this.maxRecursion) raiseNativeExecutionStop("recursion");
            counts.set(site, count);
        }
    }

    private invoke(name: string, implementation: S2Function, context: Context, args: unknown[]): unknown {
        if (!this.callFrames.length && !this.runDepth) {
            this.deadline = this.now() + 4000;
            this.functionCalls = 0;
            this.lastDepthCheck = this.now();
        }
        this.callFrames.push({label: name, cop: functionEntries.get(implementation) ?? name});
        try {
            if (++this.functionCalls % 16 === 0) this.recoveryCheckpoint();
            return scalarCopy(implementation(context, ...args.map(scalarCopy)));
        } finally {
            this.callFrames.pop();
            // S2::run_function cancels its alarm before s2_run prints diagnostics.
            // The enclosing worker/page deadline remains independently active.
            if (!this.callFrames.length && !this.runDepth) this.deadline = 0;
        }
    }

    getMethod(value: unknown, name: string, layer: Layer, line: number, superCall = false,
        dispatchClass?: string): S2Function {
        const location = `${layer.source}:${line}`;
        if (!object(value) || !runtime.isDefined(value)) {
            throw nativeProgramError(`${location}: method ${name} called on null object`);
        }
        const type = value[".type"];
        if (typeof type !== "string") throw nativeProgramError(`${location}: object has no S2 class`);

        let current: string | undefined = superCall
            ? dispatchClass ?? this.classes.get(this.methodFrames[this.methodFrames.length - 1] ?? type)
            : type;
        while (current !== undefined) {
            const definingClass = current;
            const implementation = this.functions.get(`${definingClass}::${name}`);
            if (implementation) {
                return (context, ...args) => {
                    this.methodFrames.push(definingClass);
                    try {
                        return this.invoke(`${definingClass}::${name}`, implementation, context, args);
                    } finally {
                        this.methodFrames.pop();
                    }
                };
            }
            // Native super lookup uses the checker-emitted class unchanged.
            // Do not mask a missing exact alias with another ancestor lookup.
            if (superCall && dispatchClass !== undefined) break;
            current = this.classes.get(current);
        }
        throw nativeProgramError(`${location}: undefined method ${type}::${name}`);
    }

    /** Installed compiler only; source text cannot nominate filenames. */
    setNativeCOP(layer: Layer, line: number): void {
        if (!contextBrands.has(this) || !this.loadedLayers.has(layer) || !this.callFrames.length)
            throw new Error('Native COP requires active loaded Context frame');
        this.callFrames[this.callFrames.length - 1]!.cop = nativeSite(layer, line);
    }

    runBoundary<T>(operation: () => T, origin: NativeRunOrigin = 'top-level'): T {
        if (!['top-level', 'plural', 'ordinal'].includes(origin)) throw new Error('Unknown native run origin');
        const outer = this.runDepth === 0 && this.callFrames.length === 0;
        if (outer) this.deadline = this.now() + 4000;
        this.functionCalls = 0;
        this.lastDepthCheck = this.now();
        this.runDepth++;
        // Native caller() retains host/run/eval frames across nested re-entry.
        this.nativeHostFrames.push(hostSites[origin], hostSites.runEval, hostSites.runCall);
        try { return operation(); }
        finally {
            this.nativeHostFrames.splice(-3);
            this.runDepth--;
            if (outer) this.deadline = 0;
        }
    }

    runNativeFunction(name: string, args: readonly unknown[] = [], origin: NativeRunOrigin = 'top-level'): unknown {
        // Never string-wrap an unknown inner failure; private stop identity survives.
        try { return this.runBoundary(() => this.getFunction(name)(this, ...args), origin); }
        catch (error) {
            if (isNativeProgramError(error))
                throw nativeProgramError(`Died in S2::run_code running ${name}: ${error.message}`);
            throw error;
        }
    }
    runFunction(name: string): void { this.runNativeFunction(name); }
    runMethod(value: unknown, name: string): void {
        this.runBoundary(() => this.getMethod(value, name, {source: '<page>'} as Layer, 0)(this, value));
    }

}

export const s2 = {
    assertABI(version: number): void {
        if (version !== ABI_VERSION) throw new Error(`S2 artifact ABI ${version} != runtime ABI ${ABI_VERSION}`);
    },
    makeLayer(): Layer {
        return new Layer();
    },
    runtime,
    builtin,
};
