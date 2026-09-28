// s2runtime.ts
//
// The runtime that S2 layers compiled by the JavaScript backend call into.
// Follows S2.pm: layers register functions and properties, a context merges
// them, and functions and methods run against that context.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

export const ABI_VERSION = 1;

type S2Object = Record<string, any>;
export type S2Function = (context: Context, ...args: any[]) => unknown;
export type BuiltinFunction = S2Function;

const isObject = (value: unknown): value is S2Object => typeof value === "object" && value !== null;

// A context gets its own copy of property values, so one page cannot change
// another's through a shared array or hash.
function cloneData(value: unknown): unknown {
    if (!isObject(value)) return value;
    if (Array.isArray(value)) return value.map(cloneData);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneData(item)]));
}

export class Layer {
    source = "<layer>";
    readonly info: Record<string, string> = {};
    readonly functions = new Map<string, S2Function>();
    readonly properties = new Map<string, unknown>();
    readonly classes = new Map<string, string | undefined>();
    readonly declarations = new Map<string, { type: string; attributes: Readonly<Record<string, string>> }>();
    readonly propertyGroups = new Map<string, readonly string[]>();
    readonly propertyGroupNames = new Map<string, string>();
    readonly hiddenProperties = new Set<string>();
    readonly propertyUses: string[] = [];

    setLayerInfo(key: string, value: string): void { this.info[key] = value; }
    registerClass(name: string, parent?: string): void { this.classes.set(name, parent); }
    registerFunction(names: string[], factory: () => S2Function): void {
        const implementation = factory();
        for (const name of names) this.functions.set(name, implementation);
    }
    registerProperty(name: string, type: string, attributes: Record<string, string>): void {
        this.declarations.set(name, { type, attributes: { ...attributes } });
    }
    registerPropGroup(name: string, members: string[]): void { this.propertyGroups.set(name, [...members]); }
    namePropGroup(name: string, displayName: string): void { this.propertyGroupNames.set(name, displayName); }
    hideProperty(name: string): void { this.hiddenProperties.add(name); }
    useProperty(name: string): void { this.propertyUses.push(name); }
    setProperty(name: string, value: unknown): void { this.properties.set(name, value); }
}

export class S2Error extends Error {}

export class Context {
    readonly prop: Record<string, unknown> = {};
    readonly builtin: Record<string, BuiltinFunction>;
    private readonly functions = new Map<string, S2Function>();
    private readonly classes = new Map<string, string | undefined>();
    private readonly methodClasses: string[] = [];
    private depth = 0;

    constructor(
        layers: readonly Layer[],
        private readonly write: (text: string) => void,
        properties: Record<string, unknown> = {},
        builtins: Record<string, BuiltinFunction> = {},
        private readonly safeOutput: (text: string) => string = runtime.notags,
        private readonly maxDepth = 500,
    ) {
        for (const layer of layers) {
            for (const [name, implementation] of layer.functions) this.functions.set(name, implementation);
            for (const [name, value] of layer.properties) this.prop[name] = cloneData(value);
            for (const [name, parent] of layer.classes) this.classes.set(name, parent);
        }
        for (const [name, value] of Object.entries(properties)) this.prop[`_${name}`] = value;

        // S2::make_context drops a set value that is not among the values a
        // declaring layer allows.
        for (const layer of layers) {
            for (const [name, declaration] of layer.declarations) {
                const value = this.prop[name];
                const { values, allow_other } = declaration.attributes;
                if (!value || value === "0" || !values || values === "0" || (allow_other && allow_other !== "0")) continue;
                const pairs = values.split("|");
                const labels = new Map<string, string | undefined>();
                for (let i = 0; i < pairs.length; i += 2) labels.set(pairs[i]!, pairs[i + 1]);
                const label = labels.get(value === true ? "1" : String(value));
                if (!label || label === "0") delete this.prop[name];
            }
        }

        const known = { ...stringBuiltins, ...builtins };
        this.builtin = new Proxy(known, {
            get(target, name) {
                if (typeof name !== "string" || !(name in target)) throw new S2Error(`Unknown builtin ${String(name)}`);
                return target[name];
            },
        });
    }

    print(value: unknown): void {
        this.write(String(value ?? ""));
    }

    safePrint(value: unknown): void {
        this.write(this.safeOutput(String(value ?? "")));
    }

    objectIsa(value: unknown, type: string): boolean {
        if (!isObject(value) || value[".isnull"]) return false;
        for (let current: string | undefined = value[".type"]; current !== undefined; current = this.classes.get(current)) {
            if (current === type) return true;
        }
        return false;
    }

    downcastObject(value: unknown, type: string, layer: Layer, line: number): unknown {
        if (runtime.isDefined(value) && !this.objectIsa(value, type)) {
            throw new S2Error(`${layer.source}:${line}: cannot cast object to ${type}`);
        }
        return value;
    }

    toString(value: unknown): string {
        if (!runtime.isDefined(value)) return "";
        return String(this.getMethod(value, "as_string()", { source: "<interpolation>" } as Layer, 0)(this, value));
    }

    getFunction(name: string): S2Function {
        const implementation = this.functions.get(name);
        if (!implementation) throw new S2Error(`Undefined S2 function ${name}`);
        return (context, ...args) => this.call(implementation, context, args);
    }

    getMethod(value: unknown, name: string, layer: Layer, line: number, superCall = false, dispatchClass?: string): S2Function {
        if (!isObject(value) || !runtime.isDefined(value)) throw new S2Error(`${layer.source}:${line}: method ${name} called on null object`);
        const type = value[".type"] as string;
        let current: string | undefined = superCall
            ? dispatchClass ?? this.classes.get(this.methodClasses.at(-1) ?? type)
            : type;
        for (; current !== undefined; current = this.classes.get(current)) {
            const definingClass = current;
            const implementation = this.functions.get(`${definingClass}::${name}`);
            if (implementation) {
                return (context, ...args) => {
                    this.methodClasses.push(definingClass);
                    try {
                        return this.call(implementation, context, args);
                    } finally {
                        this.methodClasses.pop();
                    }
                };
            }
            if (superCall && dispatchClass !== undefined) break;
        }
        throw new S2Error(`${layer.source}:${line}: undefined method ${type}::${name}`);
    }

    runFunction(name: string): void {
        this.getFunction(name)(this);
    }

    runMethod(value: unknown, name: string): void {
        this.getMethod(value, name, { source: "<page>" } as Layer, 0)(this, value);
    }

    // S2::check_depth
    private call(implementation: S2Function, context: Context, args: unknown[]): unknown {
        if (++this.depth > this.maxDepth) {
            this.depth = 0;
            throw new S2Error("Recursion limit exceeded");
        }
        try {
            return implementation(context, ...args);
        } finally {
            this.depth = Math.max(0, this.depth - 1);
        }
    }
}

// Helpers the generated code calls.
export const runtime = {
    prepareString(value: unknown): string {
        if (value === null || value === undefined) return "";
        if (isObject(value) && value[".isnull"]) return "";
        return String(value);
    },
    objectToBool(value: unknown): boolean {
        return value !== null && value !== undefined && !(isObject(value) && value[".isnull"]);
    },
    objectInstanceOf(value: unknown, type: string): boolean {
        return isObject(value) && !value[".isnull"] && value[".type"] === type;
    },
    isDefined(value: unknown): boolean {
        return isObject(value) && value[".type"] !== undefined && !value[".isnull"];
    },
    hashSize(value: Record<string, unknown>): number {
        return Object.keys(value ?? {}).length;
    },
    hashToBool(value: Record<string, unknown>): boolean {
        return Object.keys(value ?? {}).length !== 0;
    },
    hashKeys(value: unknown): string[] {
        return isObject(value) ? Object.keys(value) : [];
    },
    asArray(value: unknown): unknown[] {
        return Array.isArray(value) ? value : [];
    },
    characters(value: unknown): string[] {
        return Array.from(String(value ?? ""));
    },
    makeRange(first: number, last: number): number[] {
        return last < first ? [] : Array.from({ length: last - first + 1 }, (_, i) => first + i);
    },
    // Perl's length and substr work on the UTF-8 bytes S2 strings hold.
    stringLength(value: string): number {
        return Buffer.byteLength(value, "utf8");
    },
    reverseArray<T>(value: T[]): T[] {
        return [...value].reverse();
    },
    reverseString(value: string): string {
        return Array.from(value).reverse().join("");
    },
    notags(value: string): string {
        return String(value ?? "").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    },
};

// Color construction, used for Color property values.
export const builtin = {
    construct_Color(value: string): S2Object | undefined {
        let hex = String(value).replace(/^#/, "");
        if (hex === "") return { ".type": "Color", _as_string: "" };
        if (/^\w\w\w$/.test(hex)) hex = [...hex].map(char => char + char).join("");
        if (!/^[0-9a-fA-F]{6}$/.test(hex)) return undefined;
        const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
        return { ".type": "Color", _r: r, _g: g, _b: b, _as_string: `#${hex.toLowerCase()}` };
    },
};

// S2's core string methods.
const stringBuiltins: Record<string, BuiltinFunction> = {
    _string__length: (_ctx, value) => Buffer.byteLength(String(value), "utf8"),
    _string__index: (_ctx, value, needle, position = 0) => {
        const bytes = Buffer.from(String(value), "utf8");
        return bytes.indexOf(Buffer.from(String(needle), "utf8"), Math.max(0, Number(position)));
    },
    _string__substr: (_ctx, value, start, length) => {
        const chars = Array.from(String(value));
        const from = Number(start) < 0 ? Math.max(0, chars.length + Number(start)) : Number(start);
        const to = Number(length) < 0 ? chars.length + Number(length) : from + Number(length);
        return chars.slice(from, to).join("");
    },
    _string__lower: (_ctx, value) => String(value).toLowerCase(),
    _string__upper: (_ctx, value) => String(value).toUpperCase(),
    _string__upperfirst: (_ctx, value) => String(value).charAt(0).toUpperCase() + String(value).slice(1),
    _string__starts_with: (_ctx, value, needle) => String(value).startsWith(String(needle)),
    _string__ends_with: (_ctx, value, needle) => String(value).endsWith(String(needle)),
    _string__contains: (_ctx, value, needle) => String(value).includes(String(needle)),
    _string__replace: (_ctx, value, find, replacement) =>
        String(find) === "" ? String(value) : String(value).split(String(find)).join(String(replacement)),
    _string__split: (_ctx, value, separator) => {
        const parts = String(value).split(String(separator));
        while (parts.length && parts.at(-1) === "") parts.pop();
        return parts;
    },
    _string__compare: (_ctx, value, other) => {
        const [a, b] = [String(other), String(value)];
        return a < b ? -1 : a > b ? 1 : 0;
    },
    _string__repeat: (_ctx, value, times) => {
        const count = Math.trunc(Number(times));
        if (Buffer.byteLength(String(value), "utf8") * count > 5000) return "[too large]";
        return count > 0 ? String(value).repeat(count) : "";
    },
};

export const s2 = {
    assertABI(version: number): void {
        if (version !== ABI_VERSION) throw new Error(`S2 layer ABI ${version} != runtime ABI ${ABI_VERSION}`);
    },
    makeLayer(): Layer {
        return new Layer();
    },
    runtime,
    builtin,
};
