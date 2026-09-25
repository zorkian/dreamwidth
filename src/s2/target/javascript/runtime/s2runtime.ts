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

export const ABI_VERSION = 1;

type S2Function = (context: Context, ...args: unknown[]) => unknown;
type S2Object = Record<string, unknown>;

function object(value: unknown): value is S2Object {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class Layer {
    source = "<unknown S2 layer>";
    readonly info: Record<string, string> = Object.create(null);
    readonly functions = new Map<string, S2Function>();
    readonly properties = new Map<string, unknown>();
    readonly classes = new Map<string, string | undefined>();

    setLayerInfo(key: string, value: string): void {
        this.info[key] = value;
    }

    registerClass(name: string, parent?: string): void {
        this.classes.set(name, parent);
    }

    registerFunction(names: string[], factory: () => S2Function): void {
        const implementation = factory();
        for (const name of names) this.functions.set(name, implementation);
    }

    registerProperty(_name: string, _type: string, _attributes: object): void {
        // Metadata does not affect execution in this fixture-only slice.
    }

    hideProperty(_name: string): void {}
    useProperty(_name: string): void {}
    namePropGroup(_name: string, _displayName: string): void {}
    registerPropGroup(_name: string, _members: string[]): void {}

    setProperty(name: string, value: unknown): void {
        this.properties.set(name, value);
    }
}

export const runtime = {
    prepareString(value: unknown): string {
        if (value === null || value === undefined) return "";
        if (object(value) && value[".isnull"]) return "";
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
        return Object.keys(value);
    },

    characters(value: unknown): string[] {
        return Array.from(String(value ?? ""));
    },

    asArray(value: unknown): unknown[] {
        if (value === null || value === undefined) return [];
        if (!Array.isArray(value)) throw new Error("S2 array foreach requires an array");
        return value;
    },

    isDefined(value: unknown): boolean {
        return value !== undefined && value !== null && !(object(value) && value[".isnull"]);
    },

    makeRange(first: number, last: number): number[] {
        if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) {
            throw new Error("S2 range requires safe integers in this slice");
        }
        if (last < first) return [];
        if (last - first > 100_000) throw new Error("S2 fixture range exceeds 100000 elements");
        return Array.from({ length: last - first + 1 }, (_, index) => first + index);
    },

    stringLength(value: string): number {
        return Buffer.byteLength(value, "utf8");
    },

    stringSubstr(value: string, start: number, length: number): string {
        const characters = Array.from(value);
        const offset = start < 0 ? Math.max(0, characters.length + start) : start;
        return characters.slice(offset, offset + length).join("");
    },

    reverseArray<T>(value: T[]): T[] {
        return [...value].reverse();
    },

    reverseString(value: string): string {
        return Array.from(value).reverse().join("");
    },

    notags(value: string): string {
        return value.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    },
};

// The real HTMLCleaner receives only S2 `print safe` chunks. For the pinned
// trusted page, its reached serialization rules are attribute quote
// canonicalization, removal of trailing tag space, and omission of comments.
export function cleanTrustedSafeChunk(input: string): string {
    let output = "";
    for (let index = 0; index < input.length;) {
        if (input.startsWith("<!--", index)) {
            const end = input.indexOf("-->", index + 4);
            if (end < 0) throw new Error("Unclosed safe HTML comment");
            index = end + 3;
            continue;
        }
        if (input[index] !== "<" || !/[A-Za-z/!]/.test(input[index + 1] ?? "")) {
            output += input[index++];
            continue;
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
                } else if (char === "&") {
                    const rest = input.slice(cursor);
                    const entity = /^&(?:amp|quot|lt|gt|#[0-9]+|#x[0-9a-fA-F]+);/.exec(rest);
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
        if (/^<[A-Za-z]/.test(tag) && !tag.endsWith("/")) tag = tag.trimEnd();
        output += tag + ">";
        index = cursor + 1;
    }
    return output;
}

export type BuiltinFunction = (context: Context, ...args: any[]) => unknown;
export type FixtureBuiltins = Record<string, BuiltinFunction>;

export const builtin = {
    construct_Color(value: string): S2Object | undefined {
        const match = /^#?([0-9a-fA-F]{6})$/.exec(value);
        if (!match) return undefined;
        const hex = match[1]!;
        return {
            ".type": "Color",
            _r: parseInt(hex.slice(0, 2), 16),
            _g: parseInt(hex.slice(2, 4), 16),
            _b: parseInt(hex.slice(4, 6), 16),
        };
    },
};

const fixtureBuiltins: FixtureBuiltins = {
    _string__length(_context, value) {
        return runtime.stringLength(value);
    },
    _string__substr(_context, value, start, length) {
        return runtime.stringSubstr(value, start, length);
    },
};

export class Context {
    readonly prop: Record<string, unknown> = Object.create(null);
    readonly builtin: FixtureBuiltins;
    private readonly functions = new Map<string, S2Function>();
    private readonly classes = new Map<string, string | undefined>();
    private readonly methodFrames: string[] = [];

    constructor(
        layers: Layer[], private readonly write: (text: string) => void,
        properties?: Record<string, unknown>, callbacks?: FixtureBuiltins,
        private readonly safeOutput: (text: string) => string = runtime.notags,
    ) {
        for (const layer of layers) {
            for (const [name, implementation] of layer.functions) {
                this.functions.set(name, implementation);
            }
            for (const [name, value] of layer.properties) this.prop[name] = value;
            for (const [name, parent] of layer.classes) this.classes.set(name, parent);
        }
        if (properties) {
            for (const [name, value] of Object.entries(properties)) this.prop[`_${name}`] = value;
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
        this.write(String(value));
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
            throw new Error(`${layer.source}:${line}: cannot cast object to ${type}`);
        }
        return value;
    }

    toString(value: unknown): string {
        if (!runtime.isDefined(value)) return "";
        return String(this.getMethod(value, "as_string()", { source: "<interpolation>" } as Layer, 0)(this, value));
    }

    safePrint(value: unknown): void {
        this.write(this.safeOutput(String(value)));
    }

    getFunction(name: string): S2Function {
        const implementation = this.functions.get(name);
        if (!implementation) throw new Error(`Undefined S2 function ${name}`);
        return implementation;
    }

    getMethod(value: unknown, name: string, layer: Layer, line: number, superCall = false): S2Function {
        const location = `${layer.source}:${line}`;
        if (!object(value) || value[".isnull"]) {
            throw new Error(`${location}: method ${name} called on null object`);
        }
        const type = value[".type"];
        if (typeof type !== "string") throw new Error(`${location}: object has no S2 class`);

        let current: string | undefined = superCall
            ? this.classes.get(this.methodFrames[this.methodFrames.length - 1] ?? type)
            : type;
        while (current !== undefined) {
            const definingClass = current;
            const implementation = this.functions.get(`${definingClass}::${name}`);
            if (implementation) {
                return (context, ...args) => {
                    this.methodFrames.push(definingClass);
                    try {
                        return implementation(context, ...args);
                    } finally {
                        this.methodFrames.pop();
                    }
                };
            }
            current = this.classes.get(current);
        }
        throw new Error(`${location}: undefined method ${type}::${name}`);
    }

    runFunction(name: string): void {
        this.getFunction(name)(this);
    }

    runMethod(value: unknown, name: string): void {
        this.getMethod(value, name, { source: "<page>" } as Layer, 0)(this, value);
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
