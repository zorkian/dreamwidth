// parser.ts
//
// Parse Template Toolkit templates, as Template::Parser does, into a tree
// for runtime.ts to run. Covers the directives Dreamwidth's views and site
// schemes use.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//
// This program is free software; you may redistribute it and/or modify it under
// the same terms as Perl itself. For a copy of the license, please reference
// 'perldoc perlartistic' or 'perldoc perlgpl'.

export type Expr =
    | { t: "lit"; value: string | number }
    | { t: "str"; parts: (string | Expr)[] }
    | { t: "var"; nodes: VarNode[] }
    | { t: "list"; items: (Expr | { t: "range"; from: Expr; to: Expr })[] }
    | { t: "hash"; pairs: [Expr, Expr][] }
    | { t: "not"; expr: Expr }
    | { t: "neg"; expr: Expr }
    | { t: "op"; op: string; left: Expr; right: Expr }
    | { t: "cond"; test: Expr; then: Expr; else: Expr }
    | { t: "block"; body: Node[] }
    | { t: "filtered"; expr: Expr; name: string; args?: Args }
    | { t: "assign"; target: Expr & { t: "var" }; value: Expr };

// One step of a dotted variable: a name, or an expression giving it, with any arguments.
export interface VarNode {
    readonly name: string | Expr;
    readonly args?: Args;
}

export interface Args {
    readonly positional: Expr[];
    readonly named: [Expr, Expr][];
}

// A template name as INCLUDE and friends take it: a literal or a variable's value.
export type Name = string | Expr;

export type Node =
    | { t: "text"; text: string }
    | { t: "get"; expr: Expr }
    | { t: "call"; expr: Expr }
    | { t: "set"; assigns: [Expr & { t: "var" }, Expr][]; ifUnset?: boolean }
    | { t: "include"; how: "INCLUDE" | "PROCESS" | "INSERT"; names: Name[]; args: [Expr, Expr][] }
    | { t: "wrapper"; names: Name[]; args: [Expr, Expr][]; body: Node[] }
    | { t: "if"; branches: [Expr, Node[]][]; else?: Node[] }
    | { t: "foreach"; target?: string; list: Expr; body: Node[] }
    | { t: "while"; test: Expr; body: Node[] }
    | { t: "filter"; name: string; args?: Args; body: Node[] }
    | { t: "switch"; expr: Expr; cases: [Expr | undefined, Node[]][] }
    | { t: "macro"; name: string; params: string[]; body: Node[] }
    | { t: "use"; as: string; plugin: string; args?: Args }
    | { t: "next" } | { t: "last" } | { t: "return" } | { t: "stop" } | { t: "clear" };

export interface Document {
    readonly body: Node[];
    // BLOCKs defined anywhere in the template, by name.
    readonly blocks: Map<string, Node[]>;
}

export class TemplateError extends Error {}

const KEYWORDS = new Set(["GET", "CALL", "SET", "DEFAULT", "INSERT", "INCLUDE", "PROCESS", "WRAPPER", "BLOCK", "END",
    "IF", "UNLESS", "ELSE", "ELSIF", "FOR", "FOREACH", "WHILE", "SWITCH", "CASE", "USE", "FILTER", "MACRO", "NEXT",
    "LAST", "RETURN", "STOP", "CLEAR", "IN", "TO", "PERL", "RAWPERL", "TRY", "THROW", "CATCH", "FINAL", "META", "TAGS",
    "DEBUG", "PLUGIN", "VIEW"]);

interface Token {
    // "text", "word", "num", "str" (single-quoted), "dstr", "op", or "end" (of a tag).
    readonly type: string;
    readonly value: string;
    // Whether whitespace came before it, for template names written without quotes.
    readonly spaced: boolean;
    readonly line?: number;
}

// Template::Parser::split_text: text and the tokens of each directive, with
// the chomping flags applied to the text around it.
function tokenize(source: string): Token[] {
    const tokens: Token[] = [];
    const pattern = /\[%([-+=~]?)([\s\S]*?)([-+=~]?)%\]/g;
    let at = 0;
    let postChomp = "";
    let match: RegExpExecArray | null;
    const chomp = (text: string, flag: string, side: "pre" | "post") => {
        if (flag === "-") return side === "pre" ? text.replace(/(\r?\n|^)[^\S\n]*$/, "") : text.replace(/^[^\S\n]*(\r?\n|$)/, "");
        if (flag === "~") return side === "pre" ? text.replace(/\s+$/, "") : text.replace(/^\s+/, "");
        if (flag === "=") return side === "pre" ? text.replace(/\s+$/, " ") : text.replace(/^\s+/, " ");
        return text;
    };
    while ((match = pattern.exec(source))) {
        let text = chomp(source.slice(at, match.index), postChomp, "post");
        text = chomp(text, match[1]!, "pre");
        if (text) tokens.push({ type: "text", value: text, spaced: false });
        at = pattern.lastIndex;
        postChomp = match[3]!;
        // A directive starting with # is a comment.
        if (match[2]!.startsWith("#")) continue;
        // A chomp flag set apart from %] still counts as one.
        const spacedFlag = /\s([-+=~])\s*$/.exec(match[2]!);
        if (spacedFlag && !postChomp) postChomp = spacedFlag[1]!;
        const line = source.slice(0, match.index).split("\n").length;
        tokens.push(...lex(spacedFlag ? match[2]!.slice(0, spacedFlag.index) : match[2]!, line),
            { type: "end", value: ";", spaced: true, line });
    }
    const rest = chomp(source.slice(at), postChomp, "post");
    if (rest) tokens.push({ type: "text", value: rest, spaced: false });
    return tokens;
}

// The tokens inside one directive.
function lex(text: string, line = 1): Token[] {
    const tokens: Token[] = [];
    const pattern = /\s*(?:(#[^\n]*)|("(?:\\[\s\S]|[^"\\])*")|('(?:\\[\s\S]|[^'\\])*')|(\d+(?:\.\d+)?)|(\w+)|(==|!=|<=|>=|&&|\|\||=>|\.\.|\$\{|[-+*\/%<>!=?:;,.()[\]{}|$&]))/gy;
    let at = 0;
    let match: RegExpExecArray | null;
    while (at < text.length && (match = pattern.exec(text))) {
        const spaced = match.index === 0 || /^\s/.test(match[0]);
        const here = line + (text.slice(0, match.index).match(/\n/g)?.length ?? 0);
        at = pattern.lastIndex;
        if (match[1]) continue;
        const token = (type: string, value: string) => tokens.push({ type, value, spaced, line: here });
        if (match[2]) token("dstr", match[2].slice(1, -1));
        else if (match[3]) token("str", match[3].slice(1, -1).replace(/\\(['\\])/g, "$1"));
        else if (match[4]) token("num", match[4]);
        else if (match[5]) token("word", match[5]);
        else if (match[6]) token("op", match[6]);
    }
    if (text.slice(at).trim()) throw new TemplateError(`unexpected text in directive: ${text.slice(at).trim()}`);
    return tokens;
}

// Operator precedence, lowest first. Concatenation binds like '+' and '-'.
const LEVELS: string[][] = [["||", "or"], ["&&", "and"], ["==", "!=", "<", ">", "<=", ">="], ["+", "-", "_"],
    ["*", "/", "%", "div", "mod"]];

class Parser {
    private at = 0;

    // The line of the token being read, for errors.
    get line(): number {
        return (this.tokens[Math.min(this.at, this.tokens.length - 1)]?.line) ?? 0;
    }
    readonly blocks = new Map<string, Node[]>();

    constructor(private readonly tokens: Token[]) {}

    private peek(offset = 0): Token | undefined {
        return this.tokens[this.at + offset];
    }

    private is(value: string, type?: string): boolean {
        const token = this.peek();
        return !!token && token.value === value && (!type || token.type === type) && token.type !== "text" &&
            token.type !== "str" && token.type !== "dstr";
    }

    private keyword(value: string): boolean {
        const token = this.peek();
        return !!token && token.type === "word" && token.value === value;
    }

    private take(value?: string): Token {
        const token = this.tokens[this.at];
        if (!token) throw new TemplateError(`unexpected end of template${value ? `, expected ${value}` : ""}`);
        if (value !== undefined && token.value !== value) {
            throw new TemplateError(`expected ${value}, found ${token.value}`);
        }
        this.at++;
        return token;
    }

    private endStatement(): boolean {
        const token = this.peek();
        return !token || token.type === "end" || token.type === "text" || (token.type === "op" && token.value === ";");
    }

    // Statements up to one of `stops` (a keyword starting a directive).
    parseBlock(stops: string[] = []): Node[] {
        const nodes: Node[] = [];
        for (;;) {
            const token = this.peek();
            if (!token) {
                if (stops.length) throw new TemplateError(`missing ${stops.join(" or ")}`);
                return nodes;
            }
            if (token.type === "text") {
                this.at++;
                nodes.push({ t: "text", text: token.value });
                continue;
            }
            if (token.type === "end" || this.is(";", "op")) {
                this.at++;
                continue;
            }
            if (token.type === "word" && stops.includes(token.value)) return nodes;
            nodes.push(...this.statement());
        }
    }

    private statement(): Node[] {
        const word = this.peek()!.type === "word" ? this.peek()!.value : "";
        let node: Node;
        switch (word) {
            case "IF": case "UNLESS": return [this.conditional()];
            case "FOREACH": case "FOR": this.at++; return [this.foreach()];
            case "WHILE": {
                this.at++;
                const test = this.expr();
                return [{ t: "while", test, body: this.body() }];
            }
            case "BLOCK": {
                this.at++;
                const name = this.name();
                const body = this.body();
                if (typeof name !== "string") throw new TemplateError("BLOCK needs a name");
                this.blocks.set(name, body);
                return [];
            }
            case "FILTER": {
                this.at++;
                const [name, args] = this.filterSpec();
                return [{ t: "filter", name, args, body: this.body() }];
            }
            case "WRAPPER": {
                this.at++;
                const [names, args] = this.nameArgs();
                return [{ t: "wrapper", names, args, body: this.body() }];
            }
            case "SWITCH": return [this.switch()];
            case "MACRO": return [this.macro()];
        }
        node = this.simple();
        // Postfix modifiers, applied innermost first.
        for (;;) {
            if (this.keyword("IF") || this.keyword("UNLESS")) {
                const negate = this.take().value === "UNLESS";
                const test = this.expr();
                node = { t: "if", branches: [[negate ? { t: "not", expr: test } : test, [node]]] };
            } else if (this.keyword("FOREACH") || this.keyword("FOR")) {
                this.at++;
                const [target, list] = this.loopSpec();
                node = { t: "foreach", target, list, body: [node] };
            } else if (this.keyword("WHILE")) {
                this.at++;
                node = { t: "while", test: this.expr(), body: [node] };
            } else if (this.keyword("FILTER") || this.is("|", "op")) {
                this.at++;
                const [name, args] = this.filterSpec();
                node = { t: "filter", name, args, body: [node] };
            } else {
                break;
            }
        }
        return [node];
    }

    // The statements of a block directive, up to and including its END.
    private body(): Node[] {
        const body = this.parseBlock(["END"]);
        this.take("END");
        return body;
    }

    private conditional(): Node {
        const branches: [Expr, Node[]][] = [];
        let negate = this.take().value === "UNLESS";
        for (;;) {
            const test = this.expr();
            branches.push([negate ? { t: "not", expr: test } : test, this.parseBlock(["ELSIF", "ELSE", "END"])]);
            negate = false;
            if (this.keyword("ELSIF")) {
                this.at++;
                continue;
            }
            let otherwise: Node[] | undefined;
            if (this.keyword("ELSE")) {
                this.at++;
                otherwise = this.parseBlock(["END"]);
            }
            this.take("END");
            return { t: "if", branches, else: otherwise };
        }
    }

    private loopSpec(): [string | undefined, Expr] {
        const next = this.peek(1);
        if (this.peek()?.type === "word" && next && (next.value === "IN" || (next.value === "=" && next.type === "op"))) {
            const target = this.take().value;
            this.at++;
            return [target, this.expr()];
        }
        return [undefined, this.expr()];
    }

    private foreach(): Node {
        const [target, list] = this.loopSpec();
        return { t: "foreach", target, list, body: this.body() };
    }

    private switch(): Node {
        this.take("SWITCH");
        const expr = this.expr();
        this.parseBlock(["CASE", "END"]);
        const cases: [Expr | undefined, Node[]][] = [];
        while (this.keyword("CASE")) {
            this.at++;
            let value: Expr | undefined;
            if (this.keyword("DEFAULT") || this.endStatement()) {
                if (this.keyword("DEFAULT")) this.at++;
            } else {
                value = this.expr();
            }
            cases.push([value, this.parseBlock(["CASE", "END"])]);
        }
        this.take("END");
        return { t: "switch", expr, cases };
    }

    private macro(): Node {
        this.take("MACRO");
        const name = this.take().value;
        const params: string[] = [];
        if (this.is("(", "op") && !this.peek()!.spaced) {
            this.at++;
            while (!this.is(")", "op")) {
                const token = this.take();
                if (token.type === "word") params.push(token.value);
            }
            this.at++;
        }
        const body = this.keyword("BLOCK") ? (this.at++, this.body()) : this.statement();
        return { t: "macro", name, params, body };
    }

    private filterSpec(): [string, Args | undefined] {
        const name = this.take().value;
        const args = this.is("(", "op") ? this.args() : undefined;
        return [name, args];
    }

    private simple(): Node {
        const token = this.peek()!;
        if (token.type === "word") {
            switch (token.value) {
                case "GET": this.at++; return { t: "get", expr: this.expr() };
                case "CALL": this.at++; return { t: "call", expr: this.expr() };
                case "SET": this.at++; return { t: "set", assigns: this.assigns() };
                case "DEFAULT": this.at++; return { t: "set", assigns: this.assigns(), ifUnset: true };
                case "INCLUDE": case "PROCESS": case "INSERT": {
                    this.at++;
                    const [names, args] = this.nameArgs();
                    return { t: "include", how: token.value, names, args };
                }
                case "USE": return this.use();
                case "NEXT": this.at++; return { t: "next" };
                case "LAST": this.at++; return { t: "last" };
                case "RETURN": this.at++; return { t: "return" };
                case "STOP": this.at++; return { t: "stop" };
                case "CLEAR": this.at++; return { t: "clear" };
            }
            if (KEYWORDS.has(token.value)) throw new TemplateError(`unexpected ${token.value}`);
        }
        const start = this.at;
        const expr = this.expr();
        if (expr.t === "var" && this.is("=", "op")) {
            this.at = start;
            return { t: "set", assigns: this.assigns() };
        }
        return { t: "get", expr };
    }

    private use(): Node {
        this.take("USE");
        let as: string | undefined;
        if (this.peek(1)?.value === "=" && this.peek(1)?.type === "op") {
            as = this.take().value;
            this.at++;
        }
        let plugin = this.take().value;
        while (this.is(".", "op") && !this.peek()!.spaced) {
            this.at++;
            plugin += "." + this.take().value;
        }
        const args = this.is("(", "op") ? this.args() : undefined;
        return { t: "use", as: as ?? plugin.split(".").at(-1)!, plugin, args };
    }

    private assigns(): [Expr & { t: "var" }, Expr][] {
        const assigns: [Expr & { t: "var" }, Expr][] = [];
        while (!this.endStatement() && !this.keyword("IF") && !this.keyword("UNLESS") && !this.is("|", "op") &&
            !this.keyword("FILTER") && !this.keyword("FOREACH") && !this.keyword("FOR")) {
            if (this.is(",", "op")) {
                this.at++;
                continue;
            }
            const target = this.variable();
            this.take("=");
            let value: Expr;
            if (this.keyword("BLOCK")) {
                this.at++;
                value = { t: "block", body: this.body() };
            } else if (this.keyword("PROCESS") || this.keyword("INCLUDE") || this.keyword("INSERT")) {
                // The output of a directive, as in x = PROCESS name.
                value = { t: "block", body: [this.simple()] };
            } else {
                value = this.expr();
            }
            // A filter after an assigned value applies to the value.
            while (this.is("|", "op")) {
                this.at++;
                const [name, args] = this.filterSpec();
                value = { t: "filtered", expr: value, name, args };
            }
            assigns.push([target, value]);
        }
        return assigns;
    }

    // Template names, joined by '+', then any arguments.
    private nameArgs(): [Name[], [Expr, Expr][]] {
        const names = [this.name()];
        while (this.is("+", "op")) {
            this.at++;
            names.push(this.name());
        }
        // Arguments may also come in parentheses, as in INCLUDE name(a = 1).
        if (this.is("(", "op")) return [names, this.args().named];
        const args: [Expr, Expr][] = [];
        while (!this.endStatement() && !this.keyword("IF") && !this.keyword("UNLESS") && !this.is("|", "op") &&
            !this.keyword("FILTER") && !this.keyword("FOREACH") && !this.keyword("FOR")) {
            if (this.is(",", "op")) {
                this.at++;
                continue;
            }
            const key = this.variable();
            this.take(this.is("=>", "op") ? "=>" : "=");
            args.push([key, this.expr()]);
        }
        return [names, args];
    }

    // A template or BLOCK name: a quoted string, $variable, or path-like words
    // such as block.page and components/login.tt.
    private name(): Name {
        const token = this.peek();
        if (!token) throw new TemplateError("missing template name");
        if (token.type === "str") return this.take().value;
        if (token.type === "dstr") return this.string(this.take().value);
        if (token.value === "$") {
            this.at++;
            return this.variable();
        }
        if (token.value === "${") {
            this.at++;
            const expr = this.expr();
            this.take("}");
            return expr;
        }
        let name = this.take().value;
        for (let next = this.peek(); next && !next.spaced && next.type !== "end" && next.type !== "text" &&
            (next.type === "word" || next.type === "num" || [".", "/", "-"].includes(next.value)); next = this.peek()) {
            name += this.take().value;
        }
        return name;
    }

    private args(): Args {
        this.take("(");
        const args: Args = { positional: [], named: [] };
        while (!this.is(")", "op")) {
            if (this.is(",", "op")) {
                this.at++;
                continue;
            }
            const start = this.at;
            const expr = this.expr();
            if (this.is("=>", "op") || (this.is("=", "op") && (expr.t === "var" || expr.t === "lit" || expr.t === "str"))) {
                this.at++;
                // A bare word names the argument; it is not a variable.
                const key = expr.t === "var" && expr.nodes.length === 1 && typeof expr.nodes[0]!.name === "string"
                    && !expr.nodes[0]!.args && this.tokens[start]!.type === "word"
                    ? { t: "lit", value: expr.nodes[0]!.name } as Expr : expr;
                args.named.push([key, this.expr()]);
            } else {
                args.positional.push(expr);
            }
        }
        this.take(")");
        return args;
    }

    expr(): Expr {
        const test = this.binary(0);
        if (this.is("?", "op")) {
            this.at++;
            const then = this.expr();
            this.take(":");
            return { t: "cond", test, then, else: this.expr() };
        }
        return test;
    }

    private operator(level: number): string | undefined {
        const token = this.peek();
        if (!token || token.type === "text" || token.type === "str" || token.type === "dstr" || token.type === "end") return undefined;
        return LEVELS[level]!.includes(token.value) ? token.value : undefined;
    }

    private binary(level: number): Expr {
        if (level === LEVELS.length) return this.unary();
        let left = this.binary(level + 1);
        for (let op = this.operator(level); op; op = this.operator(level)) {
            this.at++;
            const right = this.binary(level + 1);
            left = { t: "op", op: op === "and" ? "&&" : op === "or" ? "||" : op, left, right };
        }
        return left;
    }

    private unary(): Expr {
        if (this.is("!", "op") || this.keyword("not")) {
            this.at++;
            return { t: "not", expr: this.unary() };
        }
        if (this.is("-", "op")) {
            this.at++;
            return { t: "neg", expr: this.unary() };
        }
        return this.term();
    }

    private term(): Expr {
        const token = this.peek();
        if (!token) throw new TemplateError("unexpected end of expression");
        switch (token.type) {
            case "num": this.at++; return { t: "lit", value: Number(token.value) };
            case "str": this.at++; return { t: "lit", value: token.value };
            case "dstr": this.at++; return this.string(token.value);
        }
        if (this.is("(", "op")) {
            this.at++;
            const inner = this.expr();
            // An assignment in parentheses gives the value assigned.
            if (inner.t === "var" && this.is("=", "op")) {
                this.at++;
                const value = this.expr();
                this.take(")");
                return { t: "assign", target: inner, value };
            }
            this.take(")");
            return inner;
        }
        if (this.is("[", "op")) return this.list();
        if (this.is("{", "op")) return this.hash();
        return this.variable();
    }

    private list(): Expr {
        this.take("[");
        const items: (Expr | { t: "range"; from: Expr; to: Expr })[] = [];
        while (!this.is("]", "op")) {
            if (this.is(",", "op")) {
                this.at++;
                continue;
            }
            const from = this.expr();
            if (this.is("..", "op") || this.keyword("TO")) {
                this.at++;
                items.push({ t: "range", from, to: this.expr() });
            } else {
                items.push(from);
            }
        }
        this.take("]");
        return { t: "list", items };
    }

    private hash(): Expr {
        this.take("{");
        const pairs: [Expr, Expr][] = [];
        while (!this.is("}", "op")) {
            if (this.is(",", "op")) {
                this.at++;
                continue;
            }
            const token = this.take();
            const key: Expr = token.type === "word" ? { t: "lit", value: token.value }
                : token.type === "dstr" ? this.string(token.value)
                : token.value === "$" ? this.variable([this.take().value])
                : { t: "lit", value: token.value };
            this.take(this.is("=>", "op") ? "=>" : "=");
            pairs.push([key, this.expr()]);
        }
        this.take("}");
        return { t: "hash", pairs };
    }

    // A dotted variable, starting from `first` if its first name was read already.
    private variable(first?: string[]): Expr & { t: "var" } {
        const nodes: VarNode[] = [];
        const node = (): VarNode => {
            let name: string | Expr;
            if (first) {
                name = { t: "var", nodes: [{ name: first.shift()! }] };
                first = undefined;
            } else if (this.is("${", "op")) {
                this.at++;
                name = this.expr();
                this.take("}");
            } else if (this.is("$", "op")) {
                this.at++;
                name = { t: "var", nodes: [{ name: this.take().value }] };
            } else if (this.is("-", "op") && nodes.length && this.peek(1)?.type === "num") {
                // A negative list index, as in list.-1.
                this.at++;
                name = "-" + this.take().value;
            } else {
                const token = this.take();
                if (token.type !== "word" && token.type !== "num") throw new TemplateError(`unexpected ${token.value}`);
                name = token.value;
            }
            const args = this.is("(", "op") ? this.args() : undefined;
            return args ? { name, args } : { name };
        };
        nodes.push(node());
        while (this.is(".", "op")) {
            this.at++;
            nodes.push(node());
        }
        return { t: "var", nodes };
    }

    // A double-quoted string, with $var and ${expr} interpolated.
    string(raw: string): Expr {
        const parts: (string | Expr)[] = [];
        let text = "";
        const pattern = /\\([\s\S])|\$\{([^}]*)\}|\$(\w+(?:\.\w+)*)|([^\\$]+|\$)/g;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(raw))) {
            if (match[1] !== undefined) {
                text += { n: "\n", t: "\t", r: "\r" }[match[1]] ?? match[1];
            } else if (match[2] !== undefined || match[3] !== undefined) {
                if (text) parts.push(text);
                text = "";
                const inner = new Parser(lex(match[2] ?? match[3]!));
                parts.push(inner.expr());
            } else {
                text += match[4];
            }
        }
        if (text) parts.push(text);
        return parts.length === 1 && typeof parts[0] === "string" ? { t: "lit", value: parts[0] }
            : { t: "str", parts };
    }
}

export function parse(source: string): Document {
    const tokens = tokenize(source);
    const parser = new Parser(tokens);
    try {
        const body = parser.parseBlock();
        return { body, blocks: parser.blocks };
    } catch (error) {
        if (!(error instanceof TemplateError)) throw error;
        throw new TemplateError(`parse error - line ${parser.line}: ${error.message}`);
    }
}
