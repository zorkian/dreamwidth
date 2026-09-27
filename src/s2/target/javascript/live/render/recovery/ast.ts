// ast.ts
//
// Closed generated-Perl recovery frontend.
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

export interface Token {value: string; kind: "word" | "variable" | "number" | "string" | "symbol" | "end"; offset: number; endOffset: number; line: number; endLine: number;}
export type Expr =
    | {kind: "literal"; value: string | number | null; numeric?: string}
    | {kind: "concat"; items: Expr[]}
    | {kind: "name"; name: string}
    | {kind: "variable"; name: string}
    | {kind: "array" | "tuple"; items: Expr[]}
    | {kind: "hash"; entries: [Expr, Expr][]}
    | {kind: "unary"; op: string; value: Expr}
    | {kind: "binary"; op: string; left: Expr; right: Expr}
    | {kind: "conditional"; test: Expr; yes: Expr; no: Expr}
    | {kind: "member"; base: Expr; key: Expr; container: "array" | "hash"}
    | {kind: "call"; name: string; args: Expr[]}
    | {kind: "invoke"; callee: Expr; args: Expr[]}
    | {kind: "sub"; body: Stmt[]; entryLine?: number}
    | {kind: "declare"; names: string[]; list?: boolean; value?: Expr};
export type Stmt = (
    | {kind: "expr"; expr: Expr}
    | {kind: "block"; body: Stmt[]}
    | {kind: "if"; branches: {test: Expr; body: Stmt[]}[]; otherwise: Stmt[]}
    | {kind: "while"; test: Expr; body: Stmt[]}
    | {kind: "for"; init: Expr; test: Expr; step: Expr; body: Stmt[]}
    | {kind: "foreach"; variable: Expr; list: Expr; body: Stmt[]}
    | {kind: "return"; value?: Expr}
    | {kind: "last" | "next"}) & {copLine?: number};
export class RecoveryGap extends Error {}
