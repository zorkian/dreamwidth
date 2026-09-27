// parser.ts
//
// Complete-token parser for the S2 generated Perl dialect.
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

import {RecoveryGap, type Expr, type Stmt, type Token} from "./ast";
import {tokenize} from "./lexer";

// Perl's emitted operators retain their native precedence, including the
// legacy concatenation precedence of the generated package/use-strict code
// (it does not select a modern Perl version feature bundle).
const precedence: Record<string, number> = {"=":1, "?":2, "..":3, "||":4, "&&":5,
    eq:6, ne:6, "==":6, "!=":6, lt:7, le:7, gt:7, ge:7, "<":7, ">":7, "<=":7, ">=":7,
    ".":9, "+":9, "-":9, "*":10, "/":10, "%":10};

export class Parser {
    private readonly tokens: Token[];
    private at = 0;
    constructor(source: string) { this.tokens = tokenize(source); }
    private token(): Token { return this.tokens[this.at]!; }
    private is(value: string): boolean { return this.token().kind !== "string" && this.token().value === value; }
    private take(): Token { return this.tokens[this.at++]!; }
    private eat(value: string): boolean { if (!this.is(value)) return false; this.at++; return true; }
    private need(value: string): void {
        if (!this.eat(value)) throw new RecoveryGap("Expected " + value + " at " + this.token().offset);
    }
    private word(): string {
        if (this.token().kind !== "word") throw new RecoveryGap("Expected identifier");
        return this.take().value;
    }
    parse(): Stmt[] {
        this.need("package"); this.need("S2"); this.need(";");
        this.need("use"); this.need("strict"); this.need(";");
        const statements: Stmt[] = [];
        while (this.token().kind !== "end") {
            if (this.eat("use")) {
                this.need("constant");
                const name = this.word(); this.need("=>"); const value = this.take(); this.need(";");
                const constants: Record<string, string> = {VTABLE:"0",STATIC:"1",PROPS:"2"};
                if (value.kind !== "number" || constants[name] !== value.value) throw new RecoveryGap("Invalid historical constant");
            } else statements.push(this.statement());
        }
        return statements;
    }
    private block(): Stmt[] {
        this.need("{"); const body: Stmt[] = [];
        while (!this.eat("}")) {
            if (this.token().kind === "end") throw new RecoveryGap("Unclosed block");
            body.push(this.statement());
        }
        return body;
    }
    private parenthesis(): Expr { this.need("("); const x = this.expr(); this.need(")"); return x; }
    private statement(): Stmt {
        const start=this.at;
        const statement=this.statementShape();
        const initial=this.tokens[start]!;
        // The ordinary emitter keeps a statement on one line except literal
        // arrays/hashes. Those retain the statement-start COP, not element lines.
        const end=this.tokens[this.at-1]!;
        const before=end.value===';' ? this.tokens[this.at-2]! : end;
        statement.copLine ??= initial.line;
        if(statement.kind==='expr' || statement.kind==='return') {
            const span=this.tokens.slice(start,this.at);
            const literal=span.some((token,i)=>['[','{'].includes(token.value) &&
                span.slice(i+1).some(next=>next.line>token.line));
            if(!literal)statement.copLine=before.endLine;
        }
        const share=(body:Stmt[],line:number)=>{
            if(body.length!==1)return;
            const only=body[0]!;
            if(only.kind==='if')only.branches.forEach(branch=>share(branch.body,line));
            else if(!['while','for','foreach'].includes(only.kind))only.copLine=line;
        };
        if(statement.kind==='if')statement.branches.forEach(branch=>share(branch.body,statement.copLine!));
        if(statement.kind==='for')share(statement.body,statement.copLine!);
        return statement;
    }
    private statementShape(): Stmt {
        if (this.is("{")) return {kind:"block", body:this.block()};
        if (this.eat("if")) {
            const branches = [{test:this.parenthesis(), body:this.block()}];
            while (this.eat("elsif")) branches.push({test:this.parenthesis(), body:this.block()});
            return {kind:"if", branches, otherwise:this.eat("else") ? this.block() : []};
        }
        if (this.eat("while")) return {kind:"while",test:this.parenthesis(),body:this.block()};
        if (this.eat("for")) {
            this.need("("); const init=this.expr(); this.need(";"); const test=this.expr();
            this.need(";"); const step=this.expr(); this.need(")");
            return {kind:"for",init,test,step,body:this.block()};
        }
        if (this.eat("foreach")) {
            const variable = this.eat("my") ? this.declaration(false) : this.prefix();
            this.need("(");
            const from=this.at;const list=this.expr();const to=this.at;this.need(")");
            const statement:Stmt={kind:"foreach",variable,list,body:this.block()};
            const tokens=this.tokens.slice(from,to);
            const literal=tokens.findIndex((token,i)=>['[','{'].includes(token.value) && tokens[i+1] && tokens[i+1]!.line>token.line);
            if(literal>=0 && tokens[literal+1] && tokens[literal+1]!.line>tokens[literal]!.line)
                statement.copLine=tokens[literal+1]!.line;
            return statement;
        }
        if (this.eat("return")) {
            const value = this.is(";") ? undefined : this.expr(); this.need(";");
            return value ? {kind:"return",value} : {kind:"return"};
        }
        if (this.is("last") || this.is("next")) { const kind=this.take().value as "last"|"next"; this.need(";"); return {kind}; }
        const expr = this.expr();
        if (this.eat("if")) {
            const test=this.expr(); this.need(";");
            return {kind:"if",branches:[{test,body:[{kind:"expr",expr}]}],otherwise:[]};
        }
        this.need(";"); return {kind:"expr",expr};
    }
    private declaration(initializer = true): Expr {
        const names: string[] = [];
        const name = () => {
            if (this.token().kind !== "variable") throw new RecoveryGap("Expected lexical declaration");
            const n=this.take().value;
            if (!/^[$@][A-Za-z_][A-Za-z0-9_]*$/.test(n)) throw new RecoveryGap("Invalid lexical declaration");
            names.push(n);
        };
        const list = this.eat("(");
        if (list) { name(); while(this.eat(",")) name(); this.need(")"); } else name();
        const value = initializer && this.eat("=") ? this.expr(1) : undefined;
        return value ? {kind:"declare",names,list,value} : {kind:"declare",names,list};
    }
    private list(close: string): Expr[] {
        const items: Expr[] = [];
        if (this.eat(close)) return items;
        do { if(this.is(close)) break; items.push(this.expr()); } while(this.eat(","));
        this.need(close); return items;
    }
    private prefix(): Expr {
        const t=this.take(); let x: Expr;
        if (t.kind === "number") x={kind:"literal",value:Number.isSafeInteger(Number(t.value)) ? Number(t.value) : null,numeric:t.value};
        else if(t.kind === "string") x={kind:"literal",value:t.value};
        else if(t.kind === "variable") x={kind:"variable",name:t.value};
        else if(t.value === "undef") x={kind:"literal",value:null};
        else if(t.value === "my") x=this.declaration();
        else if(t.value === "sub") x={kind:"sub",body:this.block()};
        else if(t.value === "(") {
            const items=this.list(")"); x=items.length === 1 ? items[0]! : {kind:"tuple",items};
        } else if(t.value === "[") x={kind:"array",items:this.list("]")};
        else if(t.value === "{") {
            const entries: [Expr,Expr][] = [];
            if(!this.eat("}")) {
                do {
                    if(this.is("}")) break;
                    let key=this.expr();
                    if(key.kind === "name") key={kind:"literal",value:key.name};
                    this.need("=>"); entries.push([key,this.expr()]);
                } while(this.eat(","));
                this.need("}");
            }
            x={kind:"hash",entries};
        } else if(["!","-","+","++","--","delete"].includes(t.value)) x={kind:"unary",op:t.value,value:this.expr(11)};
        else if(["@","%"].includes(t.value)) {
            this.need("{"); x={kind:"unary",op:t.value,value:this.expr()}; this.need("}");
        } else if(t.value === "\\") {
            this.need("&"); x={kind:"unary",op:"coderef",value:{kind:"name",name:this.word()}};
        } else if(t.kind === "word") {
            if (["keys", "scalar"].includes(t.value) && !this.is("(")) x={kind:"call",name:t.value,args:[this.expr(11)]};
            else if(this.eat("(")) x={kind:"call",name:t.value,args:this.list(")")};
            else x={kind:"name",name:t.value};
        } else throw new RecoveryGap("Unexpected token at " + t.offset);
        while(true) {
            if(this.eat("->")) {
                if(this.eat("(")) { x={kind:"invoke",callee:x,args:this.list(")")}; continue; }
                if(this.eat("[")) { const key=this.expr();this.need("]");x={kind:"member",base:x,key,container:"array"};continue; }
                if(this.eat("{")) {
                    let key=this.expr(); if(key.kind === "name")key={kind:"literal",value:key.name};
                    this.need("}");x={kind:"member",base:x,key,container:"hash"};continue;
                }
                const name=this.word();this.need("("); const args=this.list(")");
                if(x.kind !== "name" || x.name !== "S2::Object" || name !== "new") throw new RecoveryGap("Non-generated method capability");
                x={kind:"call",name:"S2::Object::new",args};continue;
            }
            if(this.eat("[")) { const key=this.expr();this.need("]");x={kind:"member",base:x,key,container:"array"};continue; }
            if(this.eat("{")) { let key=this.expr();if(key.kind === "name")key={kind:"literal",value:key.name};this.need("}");x={kind:"member",base:x,key,container:"hash"};continue; }
            if(this.is("++") || this.is("--")) {x={kind:"unary",op:"post"+this.take().value,value:x};continue;}
            break;
        }
        return x;
    }
    private expr(minimum=0): Expr {
        let left=this.prefix();
        while(true) {
            const token=this.token();
            if(token.kind === "string" || token.kind === "number" || token.kind === "variable")break;
            const op=token.value, p=precedence[op];
            if(p === undefined || p < minimum) break;
            this.take();
            if(op === "?") {const yes=this.expr();this.need(":");left={kind:"conditional",test:left,yes,no:this.expr(p)};}
            else {
                const right=this.expr(op === "=" ? p : p+1);
                if(op === ".") {
                    if(left.kind === "concat")left.items.push(right);
                    else left={kind:"concat",items:[left,right]};
                } else left={kind:"binary",op,left,right};
            }
        }
        return left;
    }
}
