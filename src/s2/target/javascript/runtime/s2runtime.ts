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

    hashSize(value: Record<string, unknown>): number {
        return Object.keys(value).length;
    },

    hashToBool(value: Record<string, unknown>): boolean {
        return Object.keys(value).length !== 0;
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

export interface FixtureBuiltins {
    _string__length(context: Context, value: string): number;
    _string__substr(context: Context, value: string, start: number, length: number): string;
}

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
    readonly builtin: FixtureBuiltins = fixtureBuiltins;
    private readonly functions = new Map<string, S2Function>();
    private readonly classes = new Map<string, string | undefined>();
    private readonly methodFrames: string[] = [];

    constructor(layers: Layer[], private readonly write: (text: string) => void) {
        for (const layer of layers) {
            for (const [name, implementation] of layer.functions) {
                this.functions.set(name, implementation);
            }
            for (const [name, value] of layer.properties) this.prop[name] = value;
            for (const [name, parent] of layer.classes) this.classes.set(name, parent);
        }
    }

    print(value: unknown): void {
        this.write(String(value));
    }

    safePrint(value: unknown): void {
        this.print(runtime.notags(String(value)));
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
