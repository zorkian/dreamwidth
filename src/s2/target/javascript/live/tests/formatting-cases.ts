// formatting-cases.ts
//
// Raw retained-Perl formatting outputs and explicitly classified representation cases.
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

export interface FormattingCase {
    readonly id: string;
    readonly raw: string;
    readonly perl: string;
    readonly classification: "exact" | "serialization" | "unsupported";
    readonly html?: string;
    readonly reason?: string;
    readonly emptyParagraphDifference?: boolean;
}

export const formattingCases: readonly FormattingCase[] = [
    {
        "id": "a/across-p",
        "raw": "<p><a href=\"https://example.test/\">inner</p><p>after</p>",
        "perl": "<p><a href=\"https://example.test/\">inner</a></p><p>after</p>",
        "classification": "exact",
        "html": "<p><a href=\"https://example.test/\">inner</a></p><p>after</p>"
    },
    {
        "id": "a/tail",
        "raw": "<p>lead <a href=\"https://example.test/\">inner</p>tail",
        "perl": "<p>lead <a href=\"https://example.test/\">inner</a></p>tail",
        "classification": "exact",
        "html": "<p>lead <a href=\"https://example.test/\">inner</a></p>tail"
    },
    {
        "id": "a/outer-unclosed",
        "raw": "<a href=\"https://example.test/\">outer<p>inside</p><p>after</p>",
        "perl": "<a href=\"https://example.test/\">outer<p>inside</p><p>after</p></a>",
        "classification": "exact",
        "html": "<a href=\"https://example.test/\">outer<p>inside</p><p>after</p></a>"
    },
    {
        "id": "a/outer-closed",
        "raw": "<a href=\"https://example.test/\">outer<p>inside</p><p>after</p></a>",
        "perl": "<a href=\"https://example.test/\">outer<p>inside</p><p>after</p></a>",
        "classification": "exact",
        "html": "<a href=\"https://example.test/\">outer<p>inside</p><p>after</p></a>"
    },
    {
        "id": "a/nested-cross-p",
        "raw": "<p><a href=\"https://example.test/\">outer<i>inner</p>tail",
        "perl": "<p><a href=\"https://example.test/\">outer<i>inner</i></a></p>tail",
        "classification": "exact",
        "html": "<p><a href=\"https://example.test/\">outer<i>inner</i></a></p>tail"
    },
    {
        "id": "a/misnested",
        "raw": "<p><a href=\"https://example.test/\"><b>one</a>two</b></p><p>after</p>",
        "perl": "<p><a href=\"https://example.test/\"><b>one</b></a>two</p><p>after</p>",
        "classification": "exact",
        "html": "<p><a href=\"https://example.test/\"><b>one</b></a>two</p><p>after</p>"
    },
    {
        "id": "a/span-cross-p",
        "raw": "<p><a href=\"https://example.test/\">one<span>two</p><p>three</p>four",
        "perl": "<p><a href=\"https://example.test/\">one<span>two</span></a></p><p>three</p>four",
        "classification": "exact",
        "html": "<p><a href=\"https://example.test/\">one<span>two</span></a></p><p>three</p>four"
    },
    {
        "id": "a/same-tag",
        "raw": "<p><a href=\"https://example.test/\">one<a href=\"https://example.test/\">two</p><p>after</p>",
        "perl": "<p><a href=\"https://example.test/\">one<a href=\"https://example.test/\">two</a></a></p><p>after</p>",
        "classification": "serialization",
        "html": "<p><a href=\"https://example.test/\">one</a><a href=\"https://example.test/\">two</a></p><p>after</p>"
    },
    {
        "id": "a/implicit-p",
        "raw": "<p><a href=\"https://example.test/\">first<p>second</p>tail",
        "perl": "<p><a href=\"https://example.test/\">first<p>second</p>tail</a></p>",
        "classification": "unsupported",
        "reason": "unproved implicit closure or adoption/source rearrangement"
    },
    {
        "id": "a/misnested-inline",
        "raw": "<a href=\"https://example.test/\">one<b>two</a>three</b>four",
        "perl": "<a href=\"https://example.test/\">one<b>two</b></a>threefour",
        "classification": "exact",
        "html": "<a href=\"https://example.test/\">one<b>two</b></a>threefour"
    },
    {
        "id": "b/across-p",
        "raw": "<p><b>inner</p><p>after</p>",
        "perl": "<p><b>inner</b></p><p>after</p>",
        "classification": "exact",
        "html": "<p><b>inner</b></p><p>after</p>"
    },
    {
        "id": "b/tail",
        "raw": "<p>lead <b>inner</p>tail",
        "perl": "<p>lead <b>inner</b></p>tail",
        "classification": "exact",
        "html": "<p>lead <b>inner</b></p>tail"
    },
    {
        "id": "b/outer-unclosed",
        "raw": "<b>outer<p>inside</p><p>after</p>",
        "perl": "<b>outer<p>inside</p><p>after</p></b>",
        "classification": "exact",
        "html": "<b>outer<p>inside</p><p>after</p></b>"
    },
    {
        "id": "b/outer-closed",
        "raw": "<b>outer<p>inside</p><p>after</p></b>",
        "perl": "<b>outer<p>inside</p><p>after</p></b>",
        "classification": "exact",
        "html": "<b>outer<p>inside</p><p>after</p></b>"
    },
    {
        "id": "b/nested-cross-p",
        "raw": "<p><b>outer<i>inner</p>tail",
        "perl": "<p><b>outer<i>inner</i></b></p>tail",
        "classification": "exact",
        "html": "<p><b>outer<i>inner</i></b></p>tail"
    },
    {
        "id": "b/misnested",
        "raw": "<p><b><b>one</b>two</b></p><p>after</p>",
        "perl": "<p><b><b>one</b>two</b></p><p>after</p>",
        "classification": "exact",
        "html": "<p><b><b>one</b>two</b></p><p>after</p>"
    },
    {
        "id": "b/span-cross-p",
        "raw": "<p><b>one<span>two</p><p>three</p>four",
        "perl": "<p><b>one<span>two</span></b></p><p>three</p>four",
        "classification": "exact",
        "html": "<p><b>one<span>two</span></b></p><p>three</p>four"
    },
    {
        "id": "b/same-tag",
        "raw": "<p><b>one<b>two</p><p>after</p>",
        "perl": "<p><b>one<b>two</b></b></p><p>after</p>",
        "classification": "exact",
        "html": "<p><b>one<b>two</b></b></p><p>after</p>"
    },
    {
        "id": "b/implicit-p",
        "raw": "<p><b>first<p>second</p>tail",
        "perl": "<p><b>first<p>second</p>tail</b></p>",
        "classification": "unsupported",
        "reason": "unproved implicit closure or adoption/source rearrangement"
    },
    {
        "id": "b/misnested-inline",
        "raw": "<b>one<b>two</b>three</b>four",
        "perl": "<b>one<b>two</b>three</b>four",
        "classification": "exact",
        "html": "<b>one<b>two</b>three</b>four"
    },
    {
        "id": "code/across-p",
        "raw": "<p><code>inner</p><p>after</p>",
        "perl": "<p><code>inner</code></p><p>after</p>",
        "classification": "exact",
        "html": "<p><code>inner</code></p><p>after</p>"
    },
    {
        "id": "code/tail",
        "raw": "<p>lead <code>inner</p>tail",
        "perl": "<p>lead <code>inner</code></p>tail",
        "classification": "exact",
        "html": "<p>lead <code>inner</code></p>tail"
    },
    {
        "id": "code/outer-unclosed",
        "raw": "<code>outer<p>inside</p><p>after</p>",
        "perl": "<code>outer<p>inside</p><p>after</p></code>",
        "classification": "exact",
        "html": "<code>outer<p>inside</p><p>after</p></code>"
    },
    {
        "id": "code/outer-closed",
        "raw": "<code>outer<p>inside</p><p>after</p></code>",
        "perl": "<code>outer<p>inside</p><p>after</p></code>",
        "classification": "exact",
        "html": "<code>outer<p>inside</p><p>after</p></code>"
    },
    {
        "id": "code/nested-cross-p",
        "raw": "<p><code>outer<i>inner</p>tail",
        "perl": "<p><code>outer<i>inner</i></code></p>tail",
        "classification": "exact",
        "html": "<p><code>outer<i>inner</i></code></p>tail"
    },
    {
        "id": "code/misnested",
        "raw": "<p><code><b>one</code>two</b></p><p>after</p>",
        "perl": "<p><code><b>one</b></code>two</p><p>after</p>",
        "classification": "exact",
        "html": "<p><code><b>one</b></code>two</p><p>after</p>"
    },
    {
        "id": "code/span-cross-p",
        "raw": "<p><code>one<span>two</p><p>three</p>four",
        "perl": "<p><code>one<span>two</span></code></p><p>three</p>four",
        "classification": "exact",
        "html": "<p><code>one<span>two</span></code></p><p>three</p>four"
    },
    {
        "id": "code/same-tag",
        "raw": "<p><code>one<code>two</p><p>after</p>",
        "perl": "<p><code>one<code>two</code></code></p><p>after</p>",
        "classification": "exact",
        "html": "<p><code>one<code>two</code></code></p><p>after</p>"
    },
    {
        "id": "code/implicit-p",
        "raw": "<p><code>first<p>second</p>tail",
        "perl": "<p><code>first<p>second</p>tail</code></p>",
        "classification": "unsupported",
        "reason": "unproved implicit closure or adoption/source rearrangement"
    },
    {
        "id": "code/misnested-inline",
        "raw": "<code>one<b>two</code>three</b>four",
        "perl": "<code>one<b>two</b></code>threefour",
        "classification": "exact",
        "html": "<code>one<b>two</b></code>threefour"
    },
    {
        "id": "em/across-p",
        "raw": "<p><em>inner</p><p>after</p>",
        "perl": "<p><em>inner</em></p><p>after</p>",
        "classification": "exact",
        "html": "<p><em>inner</em></p><p>after</p>"
    },
    {
        "id": "em/tail",
        "raw": "<p>lead <em>inner</p>tail",
        "perl": "<p>lead <em>inner</em></p>tail",
        "classification": "exact",
        "html": "<p>lead <em>inner</em></p>tail"
    },
    {
        "id": "em/outer-unclosed",
        "raw": "<em>outer<p>inside</p><p>after</p>",
        "perl": "<em>outer<p>inside</p><p>after</p></em>",
        "classification": "exact",
        "html": "<em>outer<p>inside</p><p>after</p></em>"
    },
    {
        "id": "em/outer-closed",
        "raw": "<em>outer<p>inside</p><p>after</p></em>",
        "perl": "<em>outer<p>inside</p><p>after</p></em>",
        "classification": "exact",
        "html": "<em>outer<p>inside</p><p>after</p></em>"
    },
    {
        "id": "em/nested-cross-p",
        "raw": "<p><em>outer<i>inner</p>tail",
        "perl": "<p><em>outer<i>inner</i></em></p>tail",
        "classification": "exact",
        "html": "<p><em>outer<i>inner</i></em></p>tail"
    },
    {
        "id": "em/misnested",
        "raw": "<p><em><b>one</em>two</b></p><p>after</p>",
        "perl": "<p><em><b>one</b></em>two</p><p>after</p>",
        "classification": "exact",
        "html": "<p><em><b>one</b></em>two</p><p>after</p>"
    },
    {
        "id": "em/span-cross-p",
        "raw": "<p><em>one<span>two</p><p>three</p>four",
        "perl": "<p><em>one<span>two</span></em></p><p>three</p>four",
        "classification": "exact",
        "html": "<p><em>one<span>two</span></em></p><p>three</p>four"
    },
    {
        "id": "em/same-tag",
        "raw": "<p><em>one<em>two</p><p>after</p>",
        "perl": "<p><em>one<em>two</em></em></p><p>after</p>",
        "classification": "exact",
        "html": "<p><em>one<em>two</em></em></p><p>after</p>"
    },
    {
        "id": "em/implicit-p",
        "raw": "<p><em>first<p>second</p>tail",
        "perl": "<p><em>first<p>second</p>tail</em></p>",
        "classification": "unsupported",
        "reason": "unproved implicit closure or adoption/source rearrangement"
    },
    {
        "id": "em/misnested-inline",
        "raw": "<em>one<b>two</em>three</b>four",
        "perl": "<em>one<b>two</b></em>threefour",
        "classification": "exact",
        "html": "<em>one<b>two</b></em>threefour"
    },
    {
        "id": "font/across-p",
        "raw": "<p><font color=\"red\">inner</p><p>after</p>",
        "perl": "<p><font color=\"red\">inner</font></p><p>after</p>",
        "classification": "exact",
        "html": "<p><font color=\"red\">inner</font></p><p>after</p>"
    },
    {
        "id": "font/tail",
        "raw": "<p>lead <font color=\"red\">inner</p>tail",
        "perl": "<p>lead <font color=\"red\">inner</font></p>tail",
        "classification": "exact",
        "html": "<p>lead <font color=\"red\">inner</font></p>tail"
    },
    {
        "id": "font/outer-unclosed",
        "raw": "<font color=\"red\">outer<p>inside</p><p>after</p>",
        "perl": "<font color=\"red\">outer<p>inside</p><p>after</p></font>",
        "classification": "exact",
        "html": "<font color=\"red\">outer<p>inside</p><p>after</p></font>"
    },
    {
        "id": "font/outer-closed",
        "raw": "<font color=\"red\">outer<p>inside</p><p>after</p></font>",
        "perl": "<font color=\"red\">outer<p>inside</p><p>after</p></font>",
        "classification": "exact",
        "html": "<font color=\"red\">outer<p>inside</p><p>after</p></font>"
    },
    {
        "id": "font/nested-cross-p",
        "raw": "<p><font color=\"red\">outer<i>inner</p>tail",
        "perl": "<p><font color=\"red\">outer<i>inner</i></font></p>tail",
        "classification": "exact",
        "html": "<p><font color=\"red\">outer<i>inner</i></font></p>tail"
    },
    {
        "id": "font/misnested",
        "raw": "<p><font color=\"red\"><b>one</font>two</b></p><p>after</p>",
        "perl": "<p><font color=\"red\"><b>one</b></font>two</p><p>after</p>",
        "classification": "exact",
        "html": "<p><font color=\"red\"><b>one</b></font>two</p><p>after</p>"
    },
    {
        "id": "font/span-cross-p",
        "raw": "<p><font color=\"red\">one<span>two</p><p>three</p>four",
        "perl": "<p><font color=\"red\">one<span>two</span></font></p><p>three</p>four",
        "classification": "exact",
        "html": "<p><font color=\"red\">one<span>two</span></font></p><p>three</p>four"
    },
    {
        "id": "font/same-tag",
        "raw": "<p><font color=\"red\">one<font color=\"red\">two</p><p>after</p>",
        "perl": "<p><font color=\"red\">one<font color=\"red\">two</font></font></p><p>after</p>",
        "classification": "exact",
        "html": "<p><font color=\"red\">one<font color=\"red\">two</font></font></p><p>after</p>"
    },
    {
        "id": "font/implicit-p",
        "raw": "<p><font color=\"red\">first<p>second</p>tail",
        "perl": "<p><font color=\"red\">first<p>second</p>tail</font></p>",
        "classification": "unsupported",
        "reason": "unproved implicit closure or adoption/source rearrangement"
    },
    {
        "id": "font/misnested-inline",
        "raw": "<font color=\"red\">one<b>two</font>three</b>four",
        "perl": "<font color=\"red\">one<b>two</b></font>threefour",
        "classification": "exact",
        "html": "<font color=\"red\">one<b>two</b></font>threefour"
    },
    {
        "id": "i/across-p",
        "raw": "<p><i>inner</p><p>after</p>",
        "perl": "<p><i>inner</i></p><p>after</p>",
        "classification": "exact",
        "html": "<p><i>inner</i></p><p>after</p>"
    },
    {
        "id": "i/tail",
        "raw": "<p>lead <i>inner</p>tail",
        "perl": "<p>lead <i>inner</i></p>tail",
        "classification": "exact",
        "html": "<p>lead <i>inner</i></p>tail"
    },
    {
        "id": "i/outer-unclosed",
        "raw": "<i>outer<p>inside</p><p>after</p>",
        "perl": "<i>outer<p>inside</p><p>after</p></i>",
        "classification": "exact",
        "html": "<i>outer<p>inside</p><p>after</p></i>"
    },
    {
        "id": "i/outer-closed",
        "raw": "<i>outer<p>inside</p><p>after</p></i>",
        "perl": "<i>outer<p>inside</p><p>after</p></i>",
        "classification": "exact",
        "html": "<i>outer<p>inside</p><p>after</p></i>"
    },
    {
        "id": "i/nested-cross-p",
        "raw": "<p><i>outer<i>inner</p>tail",
        "perl": "<p><i>outer<i>inner</i></i></p>tail",
        "classification": "exact",
        "html": "<p><i>outer<i>inner</i></i></p>tail"
    },
    {
        "id": "i/misnested",
        "raw": "<p><i><b>one</i>two</b></p><p>after</p>",
        "perl": "<p><i><b>one</b></i>two</p><p>after</p>",
        "classification": "exact",
        "html": "<p><i><b>one</b></i>two</p><p>after</p>"
    },
    {
        "id": "i/span-cross-p",
        "raw": "<p><i>one<span>two</p><p>three</p>four",
        "perl": "<p><i>one<span>two</span></i></p><p>three</p>four",
        "classification": "exact",
        "html": "<p><i>one<span>two</span></i></p><p>three</p>four"
    },
    {
        "id": "i/same-tag",
        "raw": "<p><i>one<i>two</p><p>after</p>",
        "perl": "<p><i>one<i>two</i></i></p><p>after</p>",
        "classification": "exact",
        "html": "<p><i>one<i>two</i></i></p><p>after</p>"
    },
    {
        "id": "i/implicit-p",
        "raw": "<p><i>first<p>second</p>tail",
        "perl": "<p><i>first<p>second</p>tail</i></p>",
        "classification": "unsupported",
        "reason": "unproved implicit closure or adoption/source rearrangement"
    },
    {
        "id": "i/misnested-inline",
        "raw": "<i>one<b>two</i>three</b>four",
        "perl": "<i>one<b>two</b></i>threefour",
        "classification": "exact",
        "html": "<i>one<b>two</b></i>threefour"
    },
    {
        "id": "strong/across-p",
        "raw": "<p><strong>inner</p><p>after</p>",
        "perl": "<p><strong>inner</strong></p><p>after</p>",
        "classification": "exact",
        "html": "<p><strong>inner</strong></p><p>after</p>"
    },
    {
        "id": "strong/tail",
        "raw": "<p>lead <strong>inner</p>tail",
        "perl": "<p>lead <strong>inner</strong></p>tail",
        "classification": "exact",
        "html": "<p>lead <strong>inner</strong></p>tail"
    },
    {
        "id": "strong/outer-unclosed",
        "raw": "<strong>outer<p>inside</p><p>after</p>",
        "perl": "<strong>outer<p>inside</p><p>after</p></strong>",
        "classification": "exact",
        "html": "<strong>outer<p>inside</p><p>after</p></strong>"
    },
    {
        "id": "strong/outer-closed",
        "raw": "<strong>outer<p>inside</p><p>after</p></strong>",
        "perl": "<strong>outer<p>inside</p><p>after</p></strong>",
        "classification": "exact",
        "html": "<strong>outer<p>inside</p><p>after</p></strong>"
    },
    {
        "id": "strong/nested-cross-p",
        "raw": "<p><strong>outer<i>inner</p>tail",
        "perl": "<p><strong>outer<i>inner</i></strong></p>tail",
        "classification": "exact",
        "html": "<p><strong>outer<i>inner</i></strong></p>tail"
    },
    {
        "id": "strong/misnested",
        "raw": "<p><strong><b>one</strong>two</b></p><p>after</p>",
        "perl": "<p><strong><b>one</b></strong>two</p><p>after</p>",
        "classification": "exact",
        "html": "<p><strong><b>one</b></strong>two</p><p>after</p>"
    },
    {
        "id": "strong/span-cross-p",
        "raw": "<p><strong>one<span>two</p><p>three</p>four",
        "perl": "<p><strong>one<span>two</span></strong></p><p>three</p>four",
        "classification": "exact",
        "html": "<p><strong>one<span>two</span></strong></p><p>three</p>four"
    },
    {
        "id": "strong/same-tag",
        "raw": "<p><strong>one<strong>two</p><p>after</p>",
        "perl": "<p><strong>one<strong>two</strong></strong></p><p>after</p>",
        "classification": "exact",
        "html": "<p><strong>one<strong>two</strong></strong></p><p>after</p>"
    },
    {
        "id": "strong/implicit-p",
        "raw": "<p><strong>first<p>second</p>tail",
        "perl": "<p><strong>first<p>second</p>tail</strong></p>",
        "classification": "unsupported",
        "reason": "unproved implicit closure or adoption/source rearrangement"
    },
    {
        "id": "strong/misnested-inline",
        "raw": "<strong>one<b>two</strong>three</b>four",
        "perl": "<strong>one<b>two</b></strong>threefour",
        "classification": "exact",
        "html": "<strong>one<b>two</b></strong>threefour"
    },
    {
        "id": "u/across-p",
        "raw": "<p><u>inner</p><p>after</p>",
        "perl": "<p><u>inner</u></p><p>after</p>",
        "classification": "exact",
        "html": "<p><u>inner</u></p><p>after</p>"
    },
    {
        "id": "u/tail",
        "raw": "<p>lead <u>inner</p>tail",
        "perl": "<p>lead <u>inner</u></p>tail",
        "classification": "exact",
        "html": "<p>lead <u>inner</u></p>tail"
    },
    {
        "id": "u/outer-unclosed",
        "raw": "<u>outer<p>inside</p><p>after</p>",
        "perl": "<u>outer<p>inside</p><p>after</p></u>",
        "classification": "exact",
        "html": "<u>outer<p>inside</p><p>after</p></u>"
    },
    {
        "id": "u/outer-closed",
        "raw": "<u>outer<p>inside</p><p>after</p></u>",
        "perl": "<u>outer<p>inside</p><p>after</p></u>",
        "classification": "exact",
        "html": "<u>outer<p>inside</p><p>after</p></u>"
    },
    {
        "id": "u/nested-cross-p",
        "raw": "<p><u>outer<i>inner</p>tail",
        "perl": "<p><u>outer<i>inner</i></u></p>tail",
        "classification": "exact",
        "html": "<p><u>outer<i>inner</i></u></p>tail"
    },
    {
        "id": "u/misnested",
        "raw": "<p><u><b>one</u>two</b></p><p>after</p>",
        "perl": "<p><u><b>one</b></u>two</p><p>after</p>",
        "classification": "exact",
        "html": "<p><u><b>one</b></u>two</p><p>after</p>"
    },
    {
        "id": "u/span-cross-p",
        "raw": "<p><u>one<span>two</p><p>three</p>four",
        "perl": "<p><u>one<span>two</span></u></p><p>three</p>four",
        "classification": "exact",
        "html": "<p><u>one<span>two</span></u></p><p>three</p>four"
    },
    {
        "id": "u/same-tag",
        "raw": "<p><u>one<u>two</p><p>after</p>",
        "perl": "<p><u>one<u>two</u></u></p><p>after</p>",
        "classification": "exact",
        "html": "<p><u>one<u>two</u></u></p><p>after</p>"
    },
    {
        "id": "u/implicit-p",
        "raw": "<p><u>first<p>second</p>tail",
        "perl": "<p><u>first<p>second</p>tail</u></p>",
        "classification": "unsupported",
        "reason": "unproved implicit closure or adoption/source rearrangement"
    },
    {
        "id": "u/misnested-inline",
        "raw": "<u>one<b>two</u>three</b>four",
        "perl": "<u>one<b>two</b></u>threefour",
        "classification": "exact",
        "html": "<u>one<b>two</b></u>threefour"
    },
    {
        "id": "plain",
        "raw": "plain text",
        "perl": "plain text",
        "classification": "exact",
        "html": "plain text"
    },
    {
        "id": "plain-paragraph",
        "raw": "<p>one</p>plain<p>two",
        "perl": "<p>one</p>plain<p>two</p>",
        "classification": "exact",
        "html": "<p>one</p>plain<p>two</p>"
    },
    {
        "id": "extra/block-adoption",
        "raw": "<b><p>one</b>two",
        "perl": "<b><p>one</p></b>two",
        "classification": "unsupported",
        "reason": "unproved implicit closure or adoption/source rearrangement"
    },
    {
        "id": "extra/block-adoption-tail",
        "raw": "<b><p>one</b>two</p>tail",
        "perl": "<b><p>one</p></b>twotail",
        "classification": "unsupported",
        "reason": "unproved implicit closure or adoption/source rearrangement"
    },
    {
        "id": "extra/nested-block-adoption",
        "raw": "<b><div>one</b>two</div>tail",
        "perl": "<b><div>one</div></b>twotail",
        "classification": "unsupported",
        "reason": "unproved implicit closure or adoption/source rearrangement"
    },
    {
        "id": "extra/mixed-adoption",
        "raw": "<b><p>one<i>two</b>three</i>four",
        "perl": "<b><p>one<i>two</i></p></b>threefour",
        "classification": "unsupported",
        "reason": "unproved implicit closure or adoption/source rearrangement"
    },
    {
        "id": "extra/anchor-block-adoption",
        "raw": "<a href=\"https://example.test/\"><p>one</a>two",
        "perl": "<a href=\"https://example.test/\"><p>one</p></a>two",
        "classification": "unsupported",
        "reason": "unproved implicit closure or adoption/source rearrangement"
    },
    {
        "id": "extra/font-block-adoption",
        "raw": "<font color=\"red\"><p>one</font>two",
        "perl": "<font color=\"red\"><p>one</p></font>two",
        "classification": "unsupported",
        "reason": "unproved implicit closure or adoption/source rearrangement"
    },
    {
        "id": "extra/table-format-outside",
        "raw": "<b>before<table><tr><td>cell</td></tr></table>after</b>",
        "perl": "<b>before<table><tr><td>cell</td></tr></table>after</b>",
        "classification": "serialization",
        "html": "<b>before<table><tbody><tr><td>cell</td></tr></tbody></table>after</b>"
    },
    {
        "id": "extra/table-close-inline",
        "raw": "<table><tr><td><b>one</td><td>two</td></tr></table>tail",
        "perl": "<table><tr><td><b>one</td><td>two</td></tr></table>tail",
        "classification": "serialization",
        "html": "<table><tbody><tr><td><b>one</b></td><td>two</td></tr></tbody></table>tail"
    },
    {
        "id": "extra/table-explicit-p",
        "raw": "<table><tr><td><p><b>one</p><p>two</p></td></tr></table>tail",
        "perl": "<table><tr><td><p><b>one</p><p>two</p></td></tr></table>tail",
        "classification": "serialization",
        "html": "<table><tbody><tr><td><p><b>one</b></p><p><b>two</b></p></td></tr></tbody></table>tail"
    },
    {
        "id": "extra/table-implicit-p",
        "raw": "<table><tr><td><p><b>one<p>two</p>tail</td></tr></table>",
        "perl": "<table><tr><td><p><b>one<p>two</p>tail</td></tr></table>",
        "classification": "serialization",
        "html": "<table><tbody><tr><td><p><b>one</b></p><p><b>two</b></p><b>tail</b></td></tr></tbody></table>"
    },
    {
        "id": "extra/table-foster-format",
        "raw": "<table><b>one<tr><td>two</td></tr></table>three",
        "perl": "<table><b>one<tr><td>two</td></tr></table>three",
        "classification": "unsupported",
        "reason": "unproved implicit closure or adoption/source rearrangement"
    },
    {
        "id": "extra/table-adoption",
        "raw": "<b><table><tr><td>one</b>two</td></tr></table>three",
        "perl": "<b><table><tr><td>onetwo</td></tr></table>three</b>",
        "classification": "serialization",
        "html": "<b><table><tbody><tr><td>onetwo</td></tr></tbody></table>three</b>"
    },
    {
        "id": "extra/list-explicit-close",
        "raw": "<ul><li><b>one</li><li>two</li></ul>tail",
        "perl": "<ul><li><b>one</b></li><li>two</li></ul>tail",
        "classification": "exact",
        "html": "<ul><li><b>one</b></li><li>two</li></ul>tail"
    },
    {
        "id": "extra/list-implicit-close",
        "raw": "<ul><li><b>one<li>two</ul>tail",
        "perl": "<ul><li><b>one<li>two</li></b></li></ul>tail",
        "classification": "unsupported",
        "reason": "unproved implicit closure or adoption/source rearrangement"
    },
    {
        "id": "extra/div-explicit-close",
        "raw": "<div><b>one</div><div>two</div>tail",
        "perl": "<div><b>one</b></div><div>two</div>tail",
        "classification": "exact",
        "html": "<div><b>one</b></div><div>two</div>tail"
    },
    {
        "id": "extra/paragraph-explicit-format-close",
        "raw": "<p><b>one</b><p>two</p>tail",
        "perl": "<p><b>one</b><p>two</p>tail</p>",
        "classification": "serialization",
        "html": "<p><b>one</b></p><p>two</p>tail",
        "emptyParagraphDifference": true
    }
];
