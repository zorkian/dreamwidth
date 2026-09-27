// general-subject.ts
//
// Native CleanHTML subject operations over neutral scalar values.
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
// Semantic ports: cgi-bin/LJ/CleanHTML.pm and HTMLCleaner.pm.
// This code was forked from the LiveJournal project owned and operated
// by Live Journal, Inc. The code has been modified and expanded by
// Dreamwidth Studios, LLC. These files were originally licensed under
// the terms of the license supplied by Live Journal, Inc, which can
// currently be found at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with the original license, this code and all its
// modifications are provided under the GNU General Public License.
// A copy of that license can be found in the LICENSE file included as
// part of this distribution.
//
import { Tokenizer, type TokenizerCallbacks } from 'htmlparser2';
import type { PageChunk } from './page-output-types';
import type { GeneralSubjectOptions, GeneralSubjectResult, SubjectExceptionEffect, SubjectHelperResult, SubjectEmbedToken } from './general-subject-types';
import { concatenate, copyChunk, scalarView, viewChunk, encodedEntityView } from './page-chunks';
import { decodeNativeEntities } from './native-entities';
import { stripRequestAuth } from './policy/request-auth';
const allowed = new Set(['a', 'b', 'i', 'u', 'em', 'strong', 'cite']);
const eaten = new Set('head title style layer iframe applet object xml param base script'.split(' '));
const removed = new Set('bgsound embed object caption link font noscript'.split(' '));
// HTML::Tagset's installed phrase metadata used by TokeParser::get_text.
const phrase = new Set('a abbr acronym b basefont bdo big blink br cite code del dfn em embed font i img ins kbd nobr noembed q s samp small spacer span strike strong sub sup tt u var wbr'.split(' '));
const literal = new Set(['script', 'style', 'xmp', 'textarea', 'title', 'plaintext']);
const updates: Readonly<Record<string, string>> = Object.freeze(Object.assign(Object.create(null) as Record<string, string>, { cut: 'lj-cut', poll: 'lj-poll', 'poll-item': 'lj-pi', 'poll-question': 'lj-pq', 'raw-code': 'lj-raw', 'site-embed': 'lj-embed', user: 'lj' }));
const parserLower = (value: string) => value.replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 32));
const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const angles = (s: string) => s.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function cleanGeneralSubject(input: PageChunk, options: GeneralSubjectOptions): GeneralSubjectResult {
    for (const limit of Object.values(options.limits))
        if (!Number.isSafeInteger(limit) || limit < 1)
            throw new Error('Invalid subject limits');
    input = copyChunk(input);
    if (input.bytes.length > options.limits.maxInputBytes)
        throw new Error('Subject input bound');
    const initial = scalarView(input);
    const source = stripRequestAuth(initial);
    // Privacy removal also applies to native's no-angle fast path, without
    // pretending that the skipped cleaner handler evaluated or cleared $@.
    if (!/[<>]/.test(initial)) {
        const value = viewChunk(source, input.utf8);
        if (value.bytes.length > options.limits.maxOutputBytes)
            throw new Error('Subject output bound');
        return { value, clearsException: false, exceptionEffect: { kind: 'none' } };
    }
    // HTML::Parser keeps a flagged document only when its parser input has
    // non-ASCII characters; an all-ASCII flagged scalar yields byte tokens.
    const parsedFlag = input.utf8 && /[^\x00-\x7f]/.test(source);
    const word = (c: string, flag = parsedFlag) => options.characterClass('word', c.codePointAt(0)!, flag);
    const space = (c: string, flag: boolean) => options.characterClass('space', c.codePointAt(0)!, flag);
    const boundary = (value: string, offset: number, flag: boolean) => {
        const before = Array.from(value.slice(0, offset)).at(-1);
        const after = Array.from(value.slice(offset))[0];
        return (before !== undefined && word(before, flag)) !==
            (after !== undefined && word(after, flag));
    };
    const withoutSpace = (value: string, flag: boolean) => Array.from(value).filter(c => !space(c, flag)).join('');
    const canonical = (value: string, flag = attributeChunk(value).utf8) => {
        const points = Array.from(value);
        let start = 0, end = points.length;
        while (start < end && space(points[start]!, flag)) start++;
        while (end > start && space(points[end - 1]!, flag)) end--;
        const trimmed = points.slice(start, end).join('');
        return trimmed === '0' ? '' : trimmed;
    };
    const deadline = Date.now() + options.limits.timeoutMs;
    const output: PageChunk[] = [];
    let size = 0, clearsException = false, stopped = false;
    const emit = (value: PageChunk) => {
        const copy = copyChunk(value);
        size += copy.bytes.length;
        if (size > options.limits.maxOutputBytes)
            throw new Error('Subject output bound');
        output.push(copy);
    };
    const ascii = (text: string) => emit(viewChunk(text));
    const raw = (text: string) => emit(viewChunk(text, parsedFlag));
    let exceptionEffect: SubjectExceptionEffect = { kind: 'none' };
    const effect = (next: SubjectExceptionEffect) => {
        if (next.kind !== 'none')
            exceptionEffect = next.kind === 'set' ? { kind: 'set', message: copyChunk(next.message) } : next;
    };
    const helper = <T>(result: SubjectHelperResult<T>): T => { effect(result.exceptionEffect); return result.value; };
    const count = new Map<string, number>();
    const stack: string[] = [];
    let helperAttributeFlags = new Map<string, boolean>();
    let eat: string | null = null, cutCount = 0, name = '', seq: string[] = [], attrs = new Map<string, string>();
    let tokenOffset = 0, pendingText = '';
    const slice = (a: number, b: number) => source.slice(tokenOffset + a, tokenOffset + b);
    let sourceAt = 0, tagStart = 0, consumed = 0;
    let currentRaw = '';
    let attrName = '', attrRawName = '', attrValue = '', literalTag: string | null = null;
    let userSpan = false, userText = '';
    let rteUser = false, rteText = '', rteB = true, rteSite: string | undefined;
    let capture: {
        tag: string;
        depth: number;
        finish?: () => void;
        tokens?: SubjectEmbedToken[];
    } | undefined;
    let extra: PageChunk | undefined;
    let xsl: {
        value: string;
        stage: 'value' | 'discard';
    } | undefined;
    const attributeChunk = (value: string) => viewChunk(value, parsedFlag || Array.from(value).some(c => c.codePointAt(0)! > 255));
    const open = (tag: string) => count.get(tag) ?? 0;
    const user = (value: string | undefined, site?: string) => helper(options.expandUser(value === undefined ? undefined : attributeChunk(value), {
        ...(site === undefined ? {} : { site: attributeChunk(site) }), textonly: options.mode === 'all', preserve_lj_tags_for: 0, no_ljuser_class: 0, no_link: open('a') > 0
    }));
    let literalText = false;
    const text = (value: string) => {
        if (xsl) {
            if (xsl.stage === 'value')
                xsl.value += literalText ? value : decodeNativeEntities(value);
            return;
        }
        if (capture) {
            capture.tokens?.push(['T', viewChunk(value, parsedFlag), literalText]);
            return;
        }
        if (eat)
            return;
        if (userSpan) {
            userText = value;
            return;
        }
        if (rteUser) {
            if (rteB)
                rteText += literalText ? value : decodeNativeEntities(value);
            return;
        }
        raw(angles(value));
    };
    const xslBoundary = (tag: string, starting: boolean): boolean => {
        if (!xsl)
            return false;
        if (starting && (tag === 'img' || tag === 'applet')) {
            if (xsl.stage === 'value')
                xsl.value += attrs.get('alt') ?? '[' + tag.toUpperCase() + ']';
            return true;
        }
        if (xsl.stage === 'discard') {
            xsl = undefined;
            return false;
        }
        if (/javascript|vbscript/i.test(withoutSpace(xsl.value, attributeChunk(xsl.value).utf8))) {
            xsl.stage = 'discard';
            return true;
        }
        const value = xsl.value;
        xsl = undefined;
        emit(viewChunk(angles(value), attributeChunk(value).utf8));
        return false;
    };
    const end = (original: string) => {
        const tag = updates[original] ?? original;
        if (xslBoundary(tag, false))
            return;
        // Native capture invokes on the first matching nested close; residual
        // eatuntil entries continue consuming after capture has been cleared.
        if (capture) {
            capture.tokens?.push(['E', original, viewChunk(currentRaw, parsedFlag)]);
            if (tag === capture.tag) {
                capture.depth--;
                const finish = capture.finish;
                capture.finish = undefined;
                finish?.();
                capture.tokens = undefined;
                if (!capture.depth)
                    capture = undefined;
            }
            return;
        }
        if (eat) {
            if (tag === eat)
                eat = null;
            return;
        }
        if (userSpan) {
            if (tag === 'span') {
                userSpan = false;
                emit(user(userText));
            }
            return;
        }
        if (rteUser) {
            if (tag === 'b')
                rteB = false;
            else if (rteB && (tag === 'br' || !phrase.has(tag)))
                rteText += ' ';
            if (tag === 'div') {
                rteUser = false;
                emit(user(rteText.replace(/\[[^\]]+\]/, ''), rteSite));
            }
            return;
        }
        if (!allowed.has(tag) || options.mode === 'all' || !open(tag))
            return;
        let closed: string | undefined;
        while ((closed = stack.pop()) !== undefined) {
            count.set(closed, open(closed) - 1);
            ascii('</' + closed + '>');
            if (closed === tag)
                break;
        }
    };
    const start = () => {
        let tag = (updates[parserLower(name)] ?? parserLower(name));
        if (xslBoundary(tag, true))
            return;
        if (capture) {
            capture.tokens?.push(startToken());
            if (tag === capture.tag)
                capture.depth++;
            return;
        }
        if (eat)
            return;
        if (userSpan)
            return;
        if (rteUser) {
            if (rteB) {
                if (tag === 'img' || tag === 'applet')
                    rteText += attrs.get('alt') ?? '[' + tag.toUpperCase() + ']';
                else if (tag === 'br' || !phrase.has(tag))
                    rteText += ' ';
            }
            return;
        }
        if (tag === 'lj-template' && options.mode === 'subject') {
            const name = (attrs.get('name') ?? '').replace(/-/g, '_');
            const finish = () => { ascii('<strong>'); emit(helper(options.templateError(viewChunk(escape(name), parsedFlag)))); ascii('</strong>'); };
            if (attrs.has('/'))
                finish();
            else
                capture = { tag, depth: 1, finish };
            return;
        }
        if ((tag === 'div' || tag === 'span') && attrs.get('class')?.toLowerCase() === 'ljvideo') {
            capture = { tag, depth: 1, finish: () => { ascii('<strong>'); emit(helper(options.videoError())); ascii('</strong>'); } };
            return;
        }
        if ((tag === 'object' || tag === 'embed') && options.mode === 'subject' && options.embedTransform) {
            const tokens: SubjectEmbedToken[] = [startToken()];
            const finish = () => {
                const value = helper(options.embedTransform!(tokens, { nocheck: 0, wmode: undefined }));
                if (value && scalarView(value) !== '0')
                    emit(value);
            };
            if (attrs.has('/'))
                finish();
            else
                capture = { tag, depth: 1, tokens, finish };
            return;
        }
        if (tag === 'span' && attrs.get('class')?.toLowerCase() === 'ljuser' && options.mode === 'subject') {
            userSpan = true;
            userText = '';
            return;
        }
        if (['input', 'select', 'option'].includes(tag)) {
            ascii('&lt;' + tag + ' ... &gt;');
            return;
        }
        if (eaten.has(tag) && !(tag === 'object' && options.mode === 'subject')) {
            eat = tag;
            return;
        }
        const fail = (bad: string) => { const localized = helper(options.markupError(viewChunk(escape(bad), parsedFlag))); extra = concatenate([viewChunk("<div class='ljparseerror'>"), localized, viewChunk('<br /><br /><div style="width: 95%; overflow: auto">'), viewChunk(escape(source), parsedFlag), viewChunk('</div></div>')]); stopped = true; };
        if (/@|:\/\//.test(tag)) {
            raw(escape('<' + tag + '>'));
            return;
        }
        const tagPoints = Array.from(tag);
        if (!tagPoints.length || !word(tagPoints[0]!) || !word(tagPoints.at(-1)!) ||
            !tagPoints.every(c => word(c) || '-:_'.includes(c))) {
            fail(tag);
            return;
        }
        // All remaining valid start tags reach the successful native eval,
        // including unknown methods and CLEAN methods returning false.
        clearsException = true;
        exceptionEffect = { kind: 'cleared' };
        const method = Array.from(tag.replace(/^.*:/s, '')).filter(c => word(c)).join('');
        if (method === 'meta') {
            const equiv = (attrs.get('http-equiv') ?? '').toLowerCase().replace(/[\x09-\x0d ]/, '');
            if (/refresh|content-type|link|set-cookie/.test(equiv))
                return;
        }
        if (method === 'link' && /\bstylesheet\b/i.test(attrs.get('rel') ?? '')) {
            const href = attrs.get('href') ?? '', match = /^https?:\/\/([^/]+?)(\/.*)$/.exec(href);
            if (!match)
                return;
            const decision = helper(options.validStylesheet(attributeChunk(href), attributeChunk(match[1]!), attributeChunk(match[2]!)));
            // The enclosing successful CLEAN eval clears a helper eval effect.
            exceptionEffect = { kind: 'cleared' };
            if (decision === undefined)
                return;
            if (typeof decision === 'number' && decision !== 0 && decision !== 1)
                throw new Error('Invalid stylesheet result');
            const value = typeof decision === 'number' ? String(decision) : scalarView(copyChunk(decision));
            if (!value || value === '0')
                return;
            if (!/^0*1$/.test(value)) {
                attrs.set('href', value);
                helperAttributeFlags.set('href', typeof decision === 'number' ? false : decision.utf8);
            }
        }
        if (tag === 'div' && attrs.get('class') === 'ljuser') {
            rteUser = true;
            rteText = '';
            rteB = true;
            rteSite = attrs.get('site');
            return;
        }
        if (tag === 'lj') {
            emit(user(attrs.has('name') ? attrs.get('name') : attrs.has('user') ? attrs.get('user') : attrs.get('comm'), attrs.get('site')));
            return;
        }
        if (tag === 'lj-raw')
            return;
        if (tag === 'lj-cut' || tag === 'div' && attrs.get('class')?.toLowerCase() === 'ljcut') {
            cutCount++;
            if (options.mode === 'subject') {
                ascii('<a name="cutid' + cutCount + '"></a>');
                if (tag === 'div') {
                    let value = attrs.get('text');
                    if (!value || value === '0')
                        value = 'Read more...';
                    if (Array.from(value).some(c => c.codePointAt(0)! > (parsedFlag ? 127 : 255)))
                        value = encodedEntityView(value);
                    raw('<div class="ljcut" text="' + angles(value) + '">');
                }
            }
            return;
        }
        // Attribute mutations occur once per stored key, before allow/deny output.
        // Duplicate source names subsequently repeat that first stored value.
        const cleaned = new Map(attrs);
        cleaned.delete('/');
        const flags = new Map([...attrs].map(([key, val]) => [key, helperAttributeFlags.get(key) ?? attributeChunk(val).utf8]));
        for (const [key, value] of cleaned) {
            if (/^(?:on|dynsrc)/.test(key) || key === 'id' && /^ljs_/i.test(value)) {
                cleaned.delete(key);
                continue;
            }
            if (key === 'data') {
                cleaned.delete(key);
                cleaned.delete('type');
                continue;
            }
            if (/(?:^=)|[\x0b\x0d]/.test(key)) {
                fail(tag + ' ' + key);
                return;
            }
            if (!key || !Array.from(key).every(c => word(c) || '_:-'.includes(c))) {
                fail(tag + ' ' + (cleaned.size > 1 ? '[...] ' : '') + key);
                return;
            }
            const val = value.replace(/[\t\n\0]/g, '');
            if (/(?:jscript|livescript|javascript|vbscript|^about|data):/i.test(withoutSpace(val, flags.get(key)!))) {
                cleaned.delete(key);
                continue;
            }
            cleaned.set(key, val);
        }
        if (cleaned.has('href')) {
            const rewritten = helper(options.rewriteBlockedHref(viewChunk(cleaned.get('href')!, flags.get('href')!)));
            const val = scalarView(rewritten);
            const site = /^(?:lj|site):(?:\/\/)?(.*)$/i.exec(val);
            const result = site ? helper(options.expandSiteUrl(viewChunk(site[1]!, rewritten.utf8)))
                : viewChunk(canonical(val, rewritten.utf8), rewritten.utf8);
            cleaned.set('href', scalarView(result));
            flags.set('href', result.utf8);
        }
        if (tag === 'img') {
            cleaned.set('src', scalarView(helper(options.normalizeImageUrl(attributeChunk(canonical(cleaned.get('src') ?? ''))))));
            if (cleaned.has('srcset'))
                {
                const value = cleaned.get('srcset')!, flag = attributeChunk(value).utf8;
                let rewritten = '', at = 0;
                while (at < value.length) {
                    const candidate = /http:\/\//ig; candidate.lastIndex = at;
                    const found = candidate.exec(value)?.index ?? -1;
                    if (found < 0) { rewritten += value.slice(at); break; }
                    rewritten += value.slice(at, found);
                    let end = found + 7;
                    while (end < value.length && !space(String.fromCodePoint(value.codePointAt(end)!), flag))
                        end += value.codePointAt(end)! > 0xffff ? 2 : 1;
                    if (end > found + 7 && boundary(value, found, flag))
                        rewritten += scalarView(helper(options.normalizeImageUrl(attributeChunk(canonical(value.slice(found, end))))));
                    else rewritten += value.slice(found, end);
                    at = end;
                }
                cleaned.set('srcset', rewritten);
            }
        }
        // The inherited alternate-output branch bypasses cleaned attributes and
        // text escaping. Apply the ordinary subject deny/text path instead,
        // retaining its native script-value consumption order.
        if (tag === 'xsl:attribute') {
            xsl = { value: '', stage: 'value' };
            return;
        }
        if (!allowed.has(tag) || removed.has(tag) || options.mode === 'all')
            return;
        const parts: PageChunk[] = [viewChunk('<' + tag, parsedFlag)];
        for (const key of seq) {
            if (!cleaned.has(key) || key === '/')
                continue;
            let val = cleaned.get(key)!;
            let flag = flags.get(key) ?? false;
            // Native removes the value flag only for non-ASCII attributes.
            if (/[^\x01-\x7f]/.test(val)) {
                if (flag)
                    val = encodedEntityView(val);
                flag = false;
            }
            parts.push(viewChunk(' ' + key + '="', parsedFlag), viewChunk(escape(val), flag), viewChunk('"'));
        }
        parts.push(viewChunk('>'));
        emit(concatenate(parts));
        count.set(tag, open(tag) + 1);
        stack.push(tag);
    };
    const flushText = () => {
        if (pendingText) {
            text(pendingText);
            pendingText = '';
        }
    };
    const startToken = (): SubjectEmbedToken => {
        const attributes: Record<string, PageChunk> = Object.create(null);
        for (const [key, val] of attrs)
            attributes[key] = attributeChunk(val);
        return ['S', parserLower(name), attributes, [...seq], viewChunk(currentRaw, parsedFlag)];
    };
    const callbacks: TokenizerCallbacks = {
        onopentagname: (a, b) => { flushText(); tagStart = tokenOffset + a - 1; name = slice(a, b); seq = []; attrs = new Map(); helperAttributeFlags = new Map(); },
        onattribname: (a, b) => { attrRawName = slice(a, b); attrName = parserLower(attrRawName); attrValue = ''; },
        onattribdata: (a, b) => { attrValue += slice(a, b); }, onattribentity: () => { throw new Error('Unexpected subject entity token'); },
        onattribend: quote => {
            seq.push(attrName);
            if (!attrs.has(attrName))
                attrs.set(attrName, decodeNativeEntities(quote === 0 ? attrRawName : attrValue));
        },
        onopentagend: end => {
            currentRaw = source.slice(tagStart, tokenOffset + end + 1);
            consumed = tokenOffset + end + 1;
            if (!/^[A-Za-z]/.test(name)) {
                if (!eat && !rteUser && !xsl)
                    raw(escape(currentRaw));
                return;
            }
            start();
            if (literal.has(parserLower(name)))
                literalTag = parserLower(name);
        },
        onselfclosingtag: end => {
            currentRaw = source.slice(tagStart, tokenOffset + end + 1);
            consumed = tokenOffset + end + 1;
            attrs.set('/', '/');
            seq.push('/');
            if (!/^[A-Za-z]/.test(name)) {
                if (!eat && !rteUser && !xsl)
                    raw(escape(currentRaw));
                return;
            }
            start();
            if (literal.has(parserLower(name)))
                literalTag = parserLower(name);
        },
        onclosetag: (a, b) => { flushText(); currentRaw = source.slice(tokenOffset + a - 2, sourceAt + 1); consumed = sourceAt + 1; end(slice(a, b).toLowerCase()); },
        ontext: (a, b) => { pendingText += slice(a, b); consumed = tokenOffset + b; }, ontextentity: () => { throw new Error('Unexpected subject text entity'); },
        oncomment: (a, b, offset) => { flushText(); consumed = tokenOffset + b + offset; }, onprocessinginstruction: (a, b) => {
            flushText();
            consumed = tokenOffset + b + 1;
            const token = slice(a, b);
            if (!eat && !rteUser && !xsl)
                raw('<?' + angles(token) + '>');
        },
        ondeclaration: (a, b) => {
            flushText();
            consumed = tokenOffset + b + 1;
            const token = '<!' + slice(a, b) + '>';
            if (!eat && !rteUser && !xsl)
                raw(token.replace(/>.+/s, '>').replace(/.</sg, ''));
        }, oncdata: (a, b) => text(slice(a, b)), onend: () => { },
    };
    let tokenizer = new Tokenizer({ xmlMode: true, decodeEntities: false }, callbacks);
    for (let at = 0; at < source.length && !stopped; at++) {
        if (at % 128 === 0 && Date.now() > deadline)
            throw new Error('Subject deadline');
        sourceAt = at;
        tokenizer.write(source[at]!);
        // Native marked_sections is off. A parser-identified marker consumes
        // through its first >, then ordinary tokenization resumes (GO parity).
        if (source.slice(consumed, at + 1) === '<![CDATA[') {
            flushText();
            const end = source.indexOf('>', at + 1);
            if (end < 0) {
                consumed = source.length;
                at = source.length;
                break;
            }
            at = end;
            consumed = end + 1;
            tokenOffset = end + 1;
            tokenizer = new Tokenizer({ xmlMode: true, decodeEntities: false }, callbacks);
            continue;
        }
        if (literalTag) {
            const tag = literalTag;
            literalTag = null;
            flushText();
            const remaining = source.slice(at + 1);
            // The native literal set ignores apparent attributes in its body.
            // Closing recognition is restricted to that measured delimiter.
            const close = tag === 'plaintext' ? null : new RegExp('</' + tag + '[\\x09-\\x0d ]*>', 'i').exec(remaining);
            literalText = true;
            text(close ? remaining.slice(0, close.index) : remaining);
            literalText = false;
            if (close) {
                consumed = at + 1 + close.index + close[0].length;
                currentRaw = close[0];
                end(tag);
                at += close.index + close[0].length;
                tokenOffset = at + 1;
                tokenizer = new Tokenizer({ xmlMode: true, decodeEntities: false }, callbacks);
            }
            else {
                consumed = source.length;
                at = source.length;
            }
        }
    }
    tokenizer.end();
    flushText();
    if (!stopped && consumed < source.length) {
        const tail = source.slice(consumed);
        if (/^<[^!\/]/.test(tail))
            raw(escape(tail));
        else
            text(tail);
    }
    if (xsl?.stage === 'value' && !/javascript|vbscript/i.test(withoutSpace(xsl.value, attributeChunk(xsl.value).utf8))) {
        emit(viewChunk(angles(xsl.value), attributeChunk(xsl.value).utf8));
    }
    for (const tag of stack.reverse())
        if (open(tag)) {
            ascii('</' + tag + '>');
            count.set(tag, open(tag) - 1);
        }
    const joined = concatenate(output);
    let clean = scalarView(joined), previous: string;
    do {
        previous = clean;
        clean = clean.replace(/<script/ig, (match, offset: number) =>
            boundary(clean, offset + match.length, joined.utf8) ? '' : match);
    } while (previous !== clean);
    const value = viewChunk(clean, joined.utf8);
    const complete = extra ? concatenate([value, extra]) : value;
    if (complete.bytes.length > options.limits.maxOutputBytes)
        throw new Error('Subject output bound');
    return { value: complete, clearsException, exceptionEffect };
}
