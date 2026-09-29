// runtime.ts
//
// Run parsed templates as Template::Context, Template::Stash and
// Template::VMethods do. Values are plain JavaScript: strings, numbers,
// arrays, objects and functions, which are called when a template reads them.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

import { type Args, type Document, type Expr, type Name, type Node, TemplateError, parse } from "./parser";

export type Value = unknown;
export type Stash = Record<string, Value>;
// A filter is a function of the text, or a factory taking the context and
// the filter's arguments, like Template::Filters' dynamic filters.
export type Filter = ((text: string) => string) | { dynamic: (context: Context, ...args: Value[]) => (text: string) => string };
export type Plugin = (context: Context, ...args: Value[]) => Value;

export interface Options {
    // The template source for a name, or undefined when there is none.
    readonly load: (name: string) => string | undefined;
    readonly filters?: Readonly<Record<string, Filter>>;
    readonly plugins?: Readonly<Record<string, Plugin>>;
    // Extra list methods, as $Template::Stash::LIST_OPS entries.
    readonly listMethods?: Readonly<Record<string, (list: Value[], ...args: Value[]) => Value>>;
    // Parsed templates by name, to share between renders.
    readonly cache?: Map<string, Document>;
}

// Control flow out of loops and templates, carrying the output made before it.
export class Control {
    output = "";
    constructor(readonly kind: "next" | "last" | "return" | "stop") {}
}

// Perl's truth.
export function truthy(value: Value): boolean {
    return value !== undefined && value !== null && value !== false && value !== "" && value !== "0" && value !== 0;
}

// Perl's string form of a value.
export function str(value: Value): string {
    if (value === undefined || value === null) return "";
    if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(15)));
    if (value === true) return "1";
    if (value === false) return "";
    // Perl prints a list as its address, which means nothing to a reader either.
    if (Array.isArray(value)) return "ARRAY(0x0)";
    return String(value);
}

// Perl's numeric form of a value.
export function num(value: Value): number {
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    const match = /^\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(str(value));
    return match ? Number(match[0]) : 0;
}

export const isHash = (value: Value): value is Record<string, Value> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

// Template::Stash's pattern for members templates may not read.
const PRIVATE = /^[_.]/;

const pairs = (hash: Record<string, Value>) => Object.keys(hash).sort().map(key => ({ key, value: hash[key] }));
const perlRegExp = (pattern: Value, flags = "") => new RegExp(str(pattern), flags);
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const sortKey = (item: Value, fields: Value[]) =>
    fields.length ? fields.map(field => str(isHash(item) ? item[str(field)] : item)).join("").toLowerCase() : str(item).toLowerCase();

const TEXT_METHODS: Record<string, (text: string, ...args: Value[]) => Value> = {
    item: text => text,
    list: text => [text],
    hash: text => ({ value: text }),
    // Perl measures the UTF-8 bytes the site keeps text in.
    length: text => Buffer.byteLength(text),
    size: () => 1,
    empty: text => text.length ? 0 : 1,
    defined: () => 1,
    upper: text => text.toUpperCase(),
    lower: text => text.toLowerCase(),
    ucfirst: text => text.charAt(0).toUpperCase() + text.slice(1),
    lcfirst: text => text.charAt(0).toLowerCase() + text.slice(1),
    match: (text, pattern, global) => {
        const found = truthy(global)
            ? [...text.matchAll(perlRegExp(pattern, "g"))].flatMap(m => m.length > 1 ? m.slice(1) : [m[0]])
            : (() => {
                const m = perlRegExp(pattern).exec(text);
                return m ? (m.length > 1 ? m.slice(1) : [1]) : [];
            })();
        return found.length ? found : "";
    },
    search: (text, pattern) => perlRegExp(pattern).test(text) ? 1 : "",
    repeat: (text, count) => truthy(count) ? text.repeat(Math.max(0, Math.trunc(num(count)))) : "",
    replace: (text, pattern, replacement, global) => text.replace(
        perlRegExp(pattern ?? "", global === undefined || truthy(global) ? "g" : ""),
        str(replacement).replace(/\\([\\$])/g, "$1$1")),
    remove: (text, pattern) => text.replace(perlRegExp(pattern, "g"), ""),
    split: (text, pattern, limit) => {
        // Only a missing pattern splits on whitespace as Perl's split ' ' does.
        const parts = pattern === undefined ? text.trim().split(/\s+/).filter(Boolean) : text.split(perlRegExp(pattern));
        const count = Math.trunc(num(limit));
        if (count > 0 && parts.length > count) {
            const re = pattern === undefined ? /\s+/ : perlRegExp(pattern);
            let rest = text;
            const out: string[] = [];
            while (out.length < count - 1) {
                const m = re.exec(rest);
                if (!m) break;
                out.push(rest.slice(0, m.index));
                rest = rest.slice(m.index + m[0].length);
            }
            return [...out, rest];
        }
        while (parts.length && parts.at(-1) === "") parts.pop();
        return parts;
    },
    chunk: (text, size) => {
        const n = Math.trunc(num(size)) || 1;
        const out: string[] = [];
        if (n < 0) for (let end = text.length; end > 0; end += n) out.unshift(text.slice(Math.max(0, end + n), end));
        else for (let at = 0; at < text.length; at += n) out.push(text.slice(at, at + n));
        return out;
    },
    substr: (text, offset, length, replacement) => {
        const from = Math.trunc(num(offset));
        const start = from < 0 ? Math.max(0, text.length + from) : from;
        if (length === undefined) return text.slice(start);
        const len = Math.trunc(num(length));
        const end = len < 0 ? text.length + len : start + len;
        if (replacement !== undefined) return text.slice(0, start) + str(replacement) + text.slice(end);
        return text.slice(start, end);
    },
    trim: text => text.trim(),
    collapse: text => text.trim().replace(/\s+/g, " "),
    squote: text => text.replace(/(['\\])/g, "\\$1"),
    dquote: text => text.replace(/(["\\])/g, "\\$1").replace(/\n/g, "\\n"),
};

const HASH_METHODS: Record<string, (hash: Record<string, Value>, ...args: Value[]) => Value> = {
    item: (hash, key) => PRIVATE.test(str(key)) ? undefined : hash[str(key)],
    hash: hash => hash,
    size: hash => Object.keys(hash).length,
    empty: hash => Object.keys(hash).length ? 0 : 1,
    each: hash => Object.entries(hash).flat(),
    keys: hash => Object.keys(hash),
    values: hash => Object.values(hash),
    items: hash => Object.entries(hash).flat(),
    pairs,
    list: (hash, what) => what === "keys" ? Object.keys(hash) : what === "values" ? Object.values(hash)
        : what === "each" ? Object.entries(hash).flat() : pairs(hash),
    exists: (hash, key) => str(key) in hash ? 1 : "",
    defined: (hash, ...key) => key.length ? (hash[str(key[0])] !== undefined && hash[str(key[0])] !== null ? 1 : "") : 1,
    delete: (hash, ...keys) => {
        for (const key of keys) delete hash[str(key)];
        return undefined;
    },
    import: (hash, other) => {
        if (isHash(other)) Object.assign(hash, other);
        return "";
    },
    sort: hash => Object.keys(hash).sort((a, b) => cmp(str(hash[a]).toLowerCase(), str(hash[b]).toLowerCase())),
    nsort: hash => Object.keys(hash).sort((a, b) => num(hash[a]) - num(hash[b])),
};

const LIST_METHODS: Record<string, (list: Value[], ...args: Value[]) => Value> = {
    item: (list, index) => list[Math.trunc(num(index))],
    list: list => list,
    hash: (list, ...start) => {
        if (start.length) {
            let n = Math.trunc(num(start[0]));
            return Object.fromEntries(list.map(item => [String(n++), item]));
        }
        const hash: Record<string, Value> = {};
        for (let i = 0; i < list.length; i += 2) hash[str(list[i])] = list[i + 1];
        return hash;
    },
    push: (list, ...items) => {
        list.push(...items);
        return "";
    },
    pop: list => list.pop(),
    unshift: (list, ...items) => {
        list.unshift(...items);
        return "";
    },
    shift: list => list.shift(),
    max: list => list.length - 1,
    size: list => list.length,
    empty: list => list.length ? 0 : 1,
    defined: (list, ...index) => !index.length ? 1
        : /^\s*-?\d/.test(str(index[0])) && list.at(Math.trunc(num(index[0]))) !== undefined ? 1 : "",
    first: (list, ...n) => n.length ? list.slice(0, Math.trunc(num(n[0]))) : list[0],
    last: (list, ...n) => n.length ? list.slice(-Math.trunc(num(n[0]))) : list.at(-1),
    reverse: list => [...list].reverse(),
    grep: (list, pattern) => list.filter(item => perlRegExp(pattern ?? "").test(str(item))),
    join: (list, joint) => list.map(str).join(joint === undefined ? " " : str(joint)),
    sort: (list, ...fields) => list.length < 2 ? list
        : [...list].sort((a, b) => cmp(sortKey(a, fields), sortKey(b, fields))),
    nsort: (list, ...fields) => list.length < 2 ? list : [...list].sort((a, b) => {
        for (const field of fields.length ? fields : [undefined]) {
            const key = (item: Value) => num(field === undefined || !isHash(item) ? item : item[str(field)]);
            const d = key(a) - key(b);
            if (d) return d;
        }
        return 0;
    }),
    unique: list => list.filter((item, i) => list.findIndex(other => str(other) === str(item)) === i),
    import: (list, ...others) => {
        for (const other of others) if (Array.isArray(other)) list.push(...other);
        return list;
    },
    merge: (list, ...others) => [...list, ...others.flatMap(other => Array.isArray(other) ? other : [])],
    slice: (list, from, to) => {
        let a = Math.trunc(num(from));
        let b = to === undefined ? list.length - 1 : Math.trunc(num(to));
        if (a < 0) a += list.length;
        if (b < 0) b += list.length;
        return list.slice(a, b + 1);
    },
    splice: (list, offset, length, ...replace) => {
        const items = replace.length === 1 && Array.isArray(replace[0]) ? replace[0] : replace;
        if (offset === undefined) return list.splice(0);
        if (length === undefined) return list.splice(Math.trunc(num(offset)));
        return list.splice(Math.trunc(num(offset)), Math.trunc(num(length)), ...items);
    },
};

const html = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const escapeBytes = (text: string, keep: RegExp) => [...Buffer.from(text, "utf8")].map(byte => {
    const char = String.fromCharCode(byte);
    return keep.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
}).join("");

// The standard filters Template::Filters provides.
export const STANDARD_FILTERS: Record<string, Filter> = {
    html,
    html_para: text => `<p>\n${text.split(/(?:\r?\n){2,}/).join("\n</p>\n\n<p>\n")}</p>\n`,
    html_break: text => text.replace(/(\r?\n){2,}/g, "$&<br />\n$&"),
    html_line_break: text => text.replace(/(\r?\n)/g, "<br />$1"),
    uri: text => escapeBytes(text, /[A-Za-z0-9\-_.~]/),
    url: text => escapeBytes(text, /[;/?:@&=+$,A-Za-z0-9\-_.~]/),
    xml: text => html(text).replaceAll("&#39;", "&apos;"),
    trim: text => text.trim(),
    collapse: text => text.trim().replace(/\s+/g, " "),
    upper: text => text.toUpperCase(),
    lower: text => text.toLowerCase(),
    ucfirst: text => text.charAt(0).toUpperCase() + text.slice(1),
    lcfirst: text => text.charAt(0).toLowerCase() + text.slice(1),
    null: () => "",
    replace: { dynamic: (_c, search, replacement) => text => text.replace(perlRegExp(search ?? "", "g"), str(replacement)) },
    remove: { dynamic: (_c, search) => text => text.replace(perlRegExp(search ?? "", "g"), "") },
    repeat: { dynamic: (_c, count) => text => text.repeat(Math.max(0, Math.trunc(num(count ?? 1)))) },
    truncate: {
        dynamic: (_c, length, end) => text => {
            const len = Math.trunc(num(length ?? 32)), tail = end === undefined ? "..." : str(end);
            return text.length <= len ? text : text.slice(0, Math.max(0, len - tail.length)) + tail;
        },
    },
    indent: {
        dynamic: (_c, pad) => text => {
            const prefix = pad === undefined ? "    " : /^\d+$/.test(str(pad)) ? " ".repeat(num(pad)) : str(pad);
            return text.replace(/^/gm, prefix);
        },
    },
    format: {
        dynamic: (_c, format) => text => text.split("\n").map(line => str(format ?? "%s").replace(/%s/g, line)).join("\n"),
    },
};

export class Context {
    stash: Stash;
    // BLOCKs from templates processed with PROCESS, by name.
    private readonly blocks = new Map<string, Node[]>();
    // The BLOCKs of each template being processed, innermost last.
    private readonly visiting: Map<string, Node[]>[] = [];
    // The names of the templates being processed, innermost last.
    readonly components: string[] = [];
    private readonly cache: Map<string, Document>;

    constructor(private readonly options: Options, stash: Stash) {
        this.stash = stash;
        this.cache = options.cache ?? new Map();
    }

    // Template::Context::process: localized is INCLUDE, otherwise PROCESS.
    process(name: string | Node[], params: Stash = {}, localize = false): string {
        const template = this.template(name);
        const saved = this.stash;
        if (localize) this.stash = Object.assign(Object.create(null), this.stash);
        Object.assign(this.stash, params);
        try {
            if (!localize && template.document) for (const [key, body] of template.document.blocks) this.blocks.set(key, body);
            return this.run(template.body, template.document, typeof name === "string" ? name : undefined);
        } finally {
            if (localize) this.stash = saved;
        }
    }

    private template(name: string | Node[]): { body: Node[]; document?: Document } {
        if (typeof name !== "string") return { body: name };
        for (let i = this.visiting.length - 1; i >= 0; i--) {
            const block = this.visiting[i]!.get(name);
            if (block) return { body: block };
        }
        const block = this.blocks.get(name);
        if (block) return { body: block };
        let document = this.cache.get(name);
        if (!document) {
            const source = this.options.load(name);
            if (source === undefined) throw new TemplateError(`file error - ${name}: not found`);
            document = parse(source);
            this.cache.set(name, document);
        }
        return { body: document.body, document };
    }

    private run(body: Node[], document: Document | undefined, name: string | undefined): string {
        if (document) this.visiting.push(document.blocks);
        if (name !== undefined) this.components.push(name);
        try {
            return this.nodes(body);
        } catch (error) {
            if (error instanceof Control && error.kind === "return" && document) return error.output;
            throw error;
        } finally {
            if (document) this.visiting.pop();
            if (name !== undefined) this.components.pop();
        }
    }

    private nodes(nodes: readonly Node[]): string {
        let out = "";
        try {
            for (const node of nodes) out += this.node(node);
        } catch (error) {
            if (error instanceof Control) error.output = out + error.output;
            throw error;
        }
        return out;
    }

    // The output of a loop body; NEXT and LAST keep what came before them.
    private iteration(body: Node[]): [string, boolean] {
        try {
            return [this.nodes(body), false];
        } catch (error) {
            if (!(error instanceof Control) || (error.kind !== "next" && error.kind !== "last")) throw error;
            return [error.output, error.kind === "last"];
        }
    }

    private node(node: Node): string {
        switch (node.t) {
            case "text": return node.text;
            case "get": return str(this.eval(node.expr));
            case "call": this.eval(node.expr); return "";
            case "set":
                for (const [target, value] of node.assigns) {
                    if (node.ifUnset && truthy(this.eval(target))) continue;
                    this.assign(target, this.eval(value));
                }
                return "";
            case "include": {
                const params = Object.fromEntries(node.args.map(([key, value]) => [str(this.keyName(key)), this.eval(value)]));
                return node.names.map(name => {
                    const resolved = this.name(name);
                    if (node.how === "INSERT") return this.options.load(resolved) ?? "";
                    return this.process(resolved, params, node.how === "INCLUDE");
                }).join("");
            }
            case "wrapper": {
                const params = Object.fromEntries(node.args.map(([key, value]) => [str(this.keyName(key)), this.eval(value)]));
                let content = this.nodes(node.body);
                for (const name of [...node.names].reverse()) content = this.process(this.name(name), { ...params, content }, true);
                return content;
            }
            case "if":
                for (const [test, body] of node.branches) if (truthy(this.eval(test))) return this.nodes(body);
                return node.else ? this.nodes(node.else) : "";
            case "foreach": return this.foreach(node.target, this.eval(node.list), node.body);
            case "while": {
                let out = "";
                for (let guard = 0; truthy(this.eval(node.test)); guard++) {
                    if (guard > 1000) throw new TemplateError("WHILE loop terminated (> 1000 iterations)");
                    const [text, stop] = this.iteration(node.body);
                    out += text;
                    if (stop) break;
                }
                return out;
            }
            case "filter": return this.filter(node.name, node.args)(this.nodes(node.body));
            case "switch": {
                const value = this.eval(node.expr);
                const values = Array.isArray(value) ? value.map(str) : [str(value)];
                for (const [test, body] of node.cases) {
                    if (!test) return this.nodes(body);
                    const tested = this.eval(test);
                    const candidates = Array.isArray(tested) ? tested.map(str) : [str(tested)];
                    if (candidates.some(candidate => values.includes(candidate))) return this.nodes(body);
                }
                return "";
            }
            case "macro":
                this.stash[node.name] = (...args: Value[]) => {
                    // A trailing hash of named arguments counts only past the parameters.
                    const named = isHash(args.at(-1)) && args.length > node.params.length ? args.pop() as Stash : {};
                    const params: Stash = { ...named };
                    node.params.forEach((param, i) => { params[param] = args[i]; });
                    return this.process(node.body, params, true);
                };
                return "";
            case "use": {
                const plugin = this.options.plugins?.[node.plugin];
                if (!plugin) throw new TemplateError(`plugin error - ${node.plugin}: plugin not found`);
                const [positional, named] = this.argValues(node.args);
                this.stash[node.as] = plugin(this, ...positional, ...(named ? [named] : []));
                return "";
            }
            case "next": case "last": case "return": case "stop": throw new Control(node.t);
            case "clear": return "";
        }
    }

    private foreach(target: string | undefined, list: Value, body: Node[]): string {
        const items = Array.isArray(list) ? [...list] : isHash(list) ? pairs(list) : list === undefined || list === null ? [] : [list];
        const saved = this.stash.loop;
        let out = "";
        try {
            for (const [index, item] of items.entries()) {
                this.stash.loop = {
                    index, count: index + 1, number: index + 1, size: items.length, max: items.length - 1,
                    first: index === 0 ? 1 : 0, last: index === items.length - 1 ? 1 : 0,
                    prev: items[index - 1], next: items[index + 1],
                    parity: (index + 1) % 2 ? "odd" : "even", odd: (index + 1) % 2 ? 1 : 0, even: (index + 1) % 2 ? 0 : 1,
                };
                if (target !== undefined) this.stash[target] = item;
                else if (isHash(item)) Object.assign(this.stash, item);
                const [text, stop] = this.iteration(body);
                out += text;
                if (stop) break;
            }
        } finally {
            this.stash.loop = saved;
        }
        return out;
    }

    private filter(name: string, args?: Args): (text: string) => string {
        const filter = this.options.filters?.[name] ?? STANDARD_FILTERS[name];
        if (!filter) throw new TemplateError(`filter error - ${name}: filter not found`);
        if (typeof filter === "function") return filter;
        const [positional, named] = this.argValues(args);
        return filter.dynamic(this, ...positional, ...(named ? [named] : []));
    }

    private argValues(args?: Args): [Value[], Stash | undefined] {
        if (!args) return [[], undefined];
        const positional = args.positional.map(expr => this.eval(expr));
        const named = args.named.length
            ? Object.fromEntries(args.named.map(([key, value]) => [str(this.keyName(key)), this.eval(value)]))
            : undefined;
        return [positional, named];
    }

    // An argument or parameter name: a bare word names itself.
    private keyName(key: Expr): Value {
        if (key.t === "var" && key.nodes.length === 1 && typeof key.nodes[0]!.name === "string") return key.nodes[0]!.name;
        return this.eval(key);
    }

    private name(name: Name): string {
        return typeof name === "string" ? name : str(this.eval(name));
    }

    // The template name output is coming from, for filters that scope text by it.
    get component(): string | undefined {
        return this.components.at(-1);
    }

    eval(expr: Expr): Value {
        switch (expr.t) {
            case "lit": return expr.value;
            case "str": return expr.parts.map(part => typeof part === "string" ? part : str(this.eval(part))).join("");
            case "var": return this.lookup(expr);
            case "list": return expr.items.flatMap(item => {
                if (item.t !== "range") return [this.eval(item)];
                const from = Math.trunc(num(this.eval(item.from))), to = Math.trunc(num(this.eval(item.to)));
                return to < from ? [] : Array.from({ length: to - from + 1 }, (_, i) => from + i);
            });
            case "hash": return Object.fromEntries(expr.pairs.map(([key, value]) => [str(this.eval(key)), this.eval(value)]));
            case "not": return truthy(this.eval(expr.expr)) ? "" : 1;
            case "neg": return -num(this.eval(expr.expr));
            case "cond": return truthy(this.eval(expr.test)) ? this.eval(expr.then) : this.eval(expr.else);
            case "block": return this.process(expr.body, {}, false);
            case "filtered": return this.filter(expr.name, expr.args)(str(this.eval(expr.expr)));
            case "assign": {
                const value = this.eval(expr.value);
                this.assign(expr.target, value);
                return value;
            }
            case "op": {
                if (expr.op === "&&") {
                    const left = this.eval(expr.left);
                    return truthy(left) ? this.eval(expr.right) : left;
                }
                if (expr.op === "||") {
                    const left = this.eval(expr.left);
                    return truthy(left) ? left : this.eval(expr.right);
                }
                const [a, b] = [this.eval(expr.left), this.eval(expr.right)];
                switch (expr.op) {
                    case "_": return str(a) + str(b);
                    // TT compares with eq and ne.
                    case "==": return str(a) === str(b) ? 1 : "";
                    case "!=": return str(a) !== str(b) ? 1 : "";
                    case "<": return num(a) < num(b) ? 1 : "";
                    case ">": return num(a) > num(b) ? 1 : "";
                    case "<=": return num(a) <= num(b) ? 1 : "";
                    case ">=": return num(a) >= num(b) ? 1 : "";
                    case "+": return num(a) + num(b);
                    case "-": return num(a) - num(b);
                    case "*": return num(a) * num(b);
                    case "/": return num(a) / num(b);
                    case "div": return Math.trunc(num(a) / num(b));
                    case "%": case "mod": {
                        const [x, y] = [Math.trunc(num(a)), Math.trunc(num(b))];
                        const r = x % y;
                        return r && (r < 0) !== (y < 0) ? r + y : r;
                    }
                }
                throw new TemplateError(`unknown operator ${expr.op}`);
            }
        }
    }

    private lookup(expr: Expr & { t: "var" }): Value {
        let value: Value = this.stash;
        let atRoot = true;
        for (const node of expr.nodes) {
            const name = typeof node.name === "string" ? node.name : str(this.eval(node.name));
            const [positional, named] = this.argValues(node.args);
            value = this.dot(value, name, named ? [...positional, named] : positional, atRoot);
            atRoot = false;
            if (value === undefined || value === null) return undefined;
        }
        return value;
    }

    // Template::Stash::_dotop
    private dot(root: Value, item: string, args: Value[], atRoot: boolean): Value {
        if (root === undefined || root === null || PRIVATE.test(item)) return undefined;
        const call = (fn: Value, self: Value) => typeof fn === "function" ? fn.apply(self, args) : fn;
        if (Array.isArray(root)) {
            const method = this.options.listMethods?.[item] ?? LIST_METHODS[item];
            if (method) return method(root, ...args);
            if (/^-?\d+$/.test(item)) return call(root.at(Number(item)), root);
            return undefined;
        }
        if (typeof root === "object") {
            const value = (root as Record<string, Value>)[item];
            if (value !== undefined && value !== null) return call(value, root);
            const hashMethod = HASH_METHODS[item];
            if (hashMethod && (!atRoot || item === "import")) return hashMethod(root as Record<string, Value>, ...args);
            return undefined;
        }
        if (typeof root === "function") return undefined;
        const text = str(root);
        const textMethod = TEXT_METHODS[item];
        if (textMethod) return textMethod(text, ...args);
        const listMethod = this.options.listMethods?.[item] ?? LIST_METHODS[item];
        return listMethod ? listMethod([root], ...args) : undefined;
    }

    // Set a variable, making the hashes along a dotted path as needed.
    private assign(target: Expr & { t: "var" }, value: Value): void {
        let root: Value = this.stash;
        const names = target.nodes.map(node => typeof node.name === "string" ? node.name : str(this.eval(node.name)));
        for (const [i, name] of names.entries()) {
            if (PRIVATE.test(name) || root === null || typeof root !== "object") return;
            const container = root as Record<string, Value>;
            if (i === names.length - 1) {
                container[name] = value;
                return;
            }
            if (Array.isArray(container) && /^-?\d+$/.test(name)) {
                root = container.at(Number(name));
            } else {
                if (container[name] === undefined || container[name] === null) container[name] = {};
                root = container[name];
            }
        }
    }
}
