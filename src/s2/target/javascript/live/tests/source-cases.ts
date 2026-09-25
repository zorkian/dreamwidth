// source-cases.ts
//
// Raw native source-consumption probes and explicit finite representation decisions.
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

export const sourceCases: readonly {raw: string; perl: string; supported: boolean}[] = [
    {
        "raw": "<p>x</p><body title=\"> <td>decoy</td>\"><p>kept</p>",
        "perl": "<p>x</p><p>kept</p>",
        "supported": true
    },
    {
        "raw": "<p>x</p><body title=\"> <td>\"><td>lost</td>",
        "perl": "<p>x</p>&lt;td&gt;lost&lt;/td&gt;",
        "supported": false
    },
    {
        "raw": "<p>x</p><html title=\"> <td>\"><td>lost</td>",
        "perl": "<p>x</p><html title=\"&gt; &lt;td&gt;\">&lt;td&gt;lost&lt;/td&gt;</html>",
        "supported": false
    },
    {
        "raw": "<p>x</p><head title=\"> <td>\"></head><p>kept</p>",
        "perl": "<p>x</p><p>kept</p>",
        "supported": false
    },
    {
        "raw": "<p>x</p><body title=\"<td>incomplete",
        "perl": "<p>x</p>&lt;body title=&quot;&lt;td&gt;incomplete",
        "supported": false
    },
    {
        "raw": "<p>intro</p><body title=\"<td>decoy</td>\"><p>kept</p></body>",
        "perl": "<p>intro</p><p>kept</p>",
        "supported": true
    },
    {
        "raw": "<p>intro</p><html title=\"<td>\"><body><p>kept</p></body></html>",
        "perl": "<p>intro</p><html title=\"&lt;td&gt;\"><p>kept</p></html>",
        "supported": true
    },
    {
        "raw": "<body title=\"<td>decoy</td>\"><p>kept</p></body>",
        "perl": "<p>kept</p>",
        "supported": true
    },
    {
        "raw": "<html title=\"<td>\"><body><p>kept</p></body></html>",
        "perl": "<html title=\"&lt;td&gt;\"><p>kept</p></html>",
        "supported": true
    },
    {
        "raw": "<body title=\"<td>\"><td>lost</td></body>",
        "perl": "&lt;td&gt;lost&lt;/td&gt;",
        "supported": false
    },
    {
        "raw": "plain <table",
        "perl": "plain &lt;table",
        "supported": false
    },
    {
        "raw": "plain <b",
        "perl": "plain &lt;b",
        "supported": false
    },
    {
        "raw": "plain </table",
        "perl": "plain &lt;/table",
        "supported": false
    },
    {
        "raw": "plain <hello world",
        "perl": "plain &lt;hello world",
        "supported": false
    },
    {
        "raw": "<tr><td>hello</td><td>bye</td></tr>",
        "perl": "&lt;tr&gt;&lt;td&gt;hello&lt;/td&gt;&lt;td&gt;bye&lt;/td&gt;&lt;/tr&gt;",
        "supported": false
    },
    {
        "raw": "<td></td>",
        "perl": "&lt;td&gt;&lt;/td&gt;",
        "supported": false
    },
    {
        "raw": "<tr></tr>",
        "perl": "&lt;tr&gt;&lt;/tr&gt;",
        "supported": false
    },
    {
        "raw": "<td></td></table>",
        "perl": "&lt;td&gt;&lt;/td&gt;&lt;/table&gt;",
        "supported": false
    },
    {
        "raw": "<tr></tr></table>",
        "perl": "&lt;tr&gt;&lt;/tr&gt;&lt;/table&gt;",
        "supported": false
    },
    {
        "raw": "<div><td>c</td></div>",
        "perl": "<div>&lt;td&gt;c&lt;/td&gt;</div>",
        "supported": false
    },
    {
        "raw": "<caption>c</caption>",
        "perl": "&lt;caption&gt;c&lt;/caption&gt;",
        "supported": false
    },
    {
        "raw": "<col span=2>x",
        "perl": "&lt;col span=\"2\"&gt;x",
        "supported": false
    },
    {
        "raw": "x</table>y",
        "perl": "x&lt;/table&gt;y",
        "supported": false
    },
    {
        "raw": "x</td>y",
        "perl": "x&lt;/td&gt;y",
        "supported": false
    },
    {
        "raw": "x</tr>y",
        "perl": "x&lt;/tr&gt;y",
        "supported": false
    },
    {
        "raw": "<table><td>c</td></table>",
        "perl": "<table>&lt;td&gt;c&lt;/td&gt;</table>",
        "supported": false
    },
    {
        "raw": "<table><tr><td>a</td></tr><td>b</td></table>",
        "perl": "<table><tr><td>a</td></tr>&lt;td&gt;b&lt;/td&gt;</table>",
        "supported": false
    },
    {
        "raw": "<form action=\"https://app.test/f\"><b>x</form>y",
        "perl": "<form action=\"https://app.test/f\"><b>x</b></form>y",
        "supported": false
    },
    {
        "raw": "<p>a</p><noscript><b>x</noscript>y",
        "perl": "<p>a</p><b>xy</b>",
        "supported": false
    },
    {
        "raw": "a < b and a<3",
        "perl": "a &lt; b and a&lt;3",
        "supported": true
    },
    {
        "raw": "a &lt;table&gt; b",
        "perl": "a &lt;table&gt; b",
        "supported": true
    },
    {
        "raw": "a &lt;/table&gt; b",
        "perl": "a &lt;/table&gt; b",
        "supported": true
    },
    {
        "raw": "<textarea><b>t</b></textarea>",
        "perl": "<textarea>&lt;b&gt;t&lt;/b&gt;</textarea>",
        "supported": true
    },
    {
        "raw": "<title><b>t</b></title><p>visible</p>",
        "perl": "<p>visible</p>",
        "supported": true
    },
    {
        "raw": "<!-- <td>not markup</td> -->x",
        "perl": "x",
        "supported": true
    },
    {
        "raw": "<script>var s=\"<td>not markup</td>\";</script>x",
        "perl": "x",
        "supported": true
    },
    {
        "raw": "<iframe><td>ignored</td></iframe>x",
        "perl": "x",
        "supported": true
    },
    {
        "raw": "<svg><![CDATA[<b>]]></svg>x",
        "perl": "<svg>]]&gt;</svg>x",
        "supported": true
    },
    {
        "raw": "<math><![CDATA[<b>]]></math>x",
        "perl": "<math>]]&gt;</math>x",
        "supported": true
    },
    {
        "raw": "x</b>y",
        "perl": "xy",
        "supported": true
    },
    {
        "raw": "x</div>y",
        "perl": "xy",
        "supported": true
    },
    {
        "raw": "x</span>y",
        "perl": "xy",
        "supported": true
    },
    {
        "raw": "x</ul>y",
        "perl": "xy",
        "supported": true
    },
    {
        "raw": "<table><tr><td>hello</td><td>bye</td></tr></table>",
        "perl": "<table><tr><td>hello</td><td>bye</td></tr></table>",
        "supported": true
    },
    {
        "raw": "<table><col span=\"2\"><tr><td>c</td></tr></table>",
        "perl": "<table><col span=\"2\"><tr><td>c</td></tr></table>",
        "supported": true
    },
    {
        "raw": "<ul><li>one<li>two</ul>",
        "perl": "<ul><li>one<li>two</li></li></ul>",
        "supported": true
    },
    {
        "raw": "<ol><li>a<li>b<li>c</ol><p>after</p>",
        "perl": "<ol><li>a<li>b<li>c</li></li></li></ol><p>after</p>",
        "supported": true
    },
    {
        "raw": "<p>one<p>two",
        "perl": "<p>one<p>two</p></p>",
        "supported": true
    },
    {
        "raw": "<form><select><option>hello</option><option>bye</option></select></form>",
        "perl": "<form><select><option>hello</option><option>bye</option></select></form>",
        "supported": true
    },
    {
        "raw": "<select><option>hello</option><option>bye</option></select>",
        "perl": "&lt;select ... &gt;&lt;option ... &gt;hello&lt;/option&gt;&lt;option ... &gt;bye&lt;/option&gt;&lt;/select&gt;",
        "supported": true
    },
    {
        "raw": "x</br>y",
        "perl": "xy",
        "supported": false
    },
    {
        "raw": "<p>x</p></p>y",
        "perl": "<p>x</p>y",
        "supported": false
    },
    {
        "raw": "<body class=\"k\" onload=\"alert(1)\"><p>x</p></body>",
        "perl": "<p>x</p>",
        "supported": true
    },
    {
        "raw": "<p>intro</p><html><body class=\"k\"><p>x</p></body></html>",
        "perl": "<p>intro</p><html><p>x</p></html>",
        "supported": true
    },
    {
        "raw": "<!DOCTYPE html><html><head><title>T</title></head><body><p>x</p></body></html>",
        "perl": "<!DOCTYPE html><html><p>x</p></html>",
        "supported": true
    },
    {
        "raw": "<p>a</p></body><p>after body</p>",
        "perl": "<p>a</p><p>after body</p>",
        "supported": true
    },
    {
        "raw": "<p title=\"<td>decoy\">ordinary</p>",
        "perl": "<p title=\"&lt;td&gt;decoy\">ordinary</p>",
        "supported": true
    },
    {
        "raw": "<div><!-- </div><td> --><p>safe</p></div>",
        "perl": "<div><p>safe</p></div>",
        "supported": true
    },
    {
        "raw": "x</TaBlE >y",
        "perl": "x&lt;/table&gt;y",
        "supported": false
    },
    {
        "raw": "x</table\ny>z",
        "perl": "x&lt;/table&gt;z",
        "supported": false
    },
    {
        "raw": "<script><!-- <table> --> </script><p>x</p>",
        "perl": "<p>x</p>",
        "supported": true
    },
    {
        "raw": "<p>literal &amp;lt;table&amp;gt;</p>",
        "perl": "<p>literal &amp;lt;table&amp;gt;</p>",
        "supported": true
    }
];
