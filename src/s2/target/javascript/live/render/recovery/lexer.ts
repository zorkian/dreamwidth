// lexer.ts
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

import {RecoveryGap, type Token} from "./ast";

// The frontend accepts the generated dialect without invoking Perl's compiler:
// even Perl -c can execute BEGIN/use blocks from hostile input.
export function tokenize(source: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    const starts=[0];
    for(let at=0;at<source.length;at++)if(source[at]==='\n')starts.push(at+1);
    const lineAt=(offset:number)=>{let lo=0,hi=starts.length;while(lo+1<hi){const mid=(lo+hi)>>1;if(starts[mid]!<=offset)lo=mid;else hi=mid;}return lo+1;};
    const push = (kind: Token["kind"], value: string, offset: number) => tokens.push({kind, value, offset,
        endOffset:i,line:lineAt(offset),endLine:lineAt(Math.max(offset,i-1))});
    while (i < source.length) {
        const start = i, c = source[i]!;
        if (/\s/.test(c)) { i++; continue; }
        if (c === "#") { while (i < source.length && source[i] !== "\n") i++; continue; }
        if (c === '"' || c === "'") {
            const quote = c;
            let value = "", closed = false;
            i++;
            while (i < source.length) {
                const ch = source[i++]!;
                if (ch === quote) { closed = true; break; }
                if (ch === "\\") {
                    if (i === source.length) throw new RecoveryGap("Incomplete quoted literal");
                    const next = source[i++]!;
                    if (quote === "'") value += next === "'" || next === "\\" ? next : "\\" + next;
                    else {
                        const escapes: Record<string, string> = {n:"\n", r:"\r", t:"\t", b:"\b", f:"\f", a:"\u0007", e:"\u001b"};
                        if (Object.hasOwn(escapes, next)) value += escapes[next];
                        else if ('\\"$@'.includes(next)) value += next;
                        else throw new RecoveryGap("Non-generated string escape");
                    }
                } else {
                    if (quote === '"' && (ch === "$" || ch === "@")) throw new RecoveryGap("Interpolated Perl literal");
                    value += ch;
                }
            }
            if (!closed) throw new RecoveryGap("Unclosed literal");
            push("string", value, start); continue;
        }
        if ("$@%".includes(c)) {
            const name = /^(?:[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*)/.exec(source.slice(i + 1));
            if (name) { i += name[0].length + 1; push("variable", c + name[0], start); continue; }
        }
        const number = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(i));
        if (number) { i += number[0].length; push("number", number[0], start); continue; }
        const word = /^[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*/.exec(source.slice(i));
        if (word) { i += word[0].length; push("word", word[0], start); continue; }
        const op = ["->", "=>", "++", "--", "&&", "||", "==", "!=", "<=", ">=", ".."].find(x => source.startsWith(x, i));
        if (op) { i += op.length; push("symbol", op, start); continue; }
        if ("(){}[];,?:=+*/%.!<>-\\@&".includes(c)) { i++; push("symbol", c, start); continue; }
        throw new RecoveryGap("Non-generated token at " + start);
    }
    push("end", "", i);
    return tokens;
}
