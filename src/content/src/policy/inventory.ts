// inventory.ts
//
// Explicit body-context coverage of the retained entry cleaner's allow-mode policy.
//
// Policy adapted from LJ::CleanHTML, forked from the LiveJournal project owned
// and operated by Live Journal, Inc., and modified and expanded by Dreamwidth
// Studios, LLC. The original license is available at:
// http://code.livejournal.org/trac/livejournal/browser/trunk/LICENSE-LiveJournal.txt
// In accordance with that license, this code and its modifications are provided
// under the GNU General Public License. See LICENSE in this distribution.
//
// Authors:
//      Dreamwidth contributors
//
// Copyright (c) 2026 by Dreamwidth Studios, LLC.
//

// clean_event supplies allow mode, event_eat/event_remove and cleancss, not a
// positive tag list. Enumerate the ordinary modern/legacy HTML survivors that
// this finite body policy handles. Anything else is explicitly unsupported;
// DOMPurify's changing defaults must not silently define compatibility coverage.
export const entryTags = new Set((
    "a abbr acronym address area article aside b basefont bdi bdo big blink blockquote br button " +
    "canvas caption center cite code col colgroup data datalist dd del details dfn dialog dir div " +
    "dl dt em fieldset figcaption figure font footer form h1 h2 h3 h4 h5 h6 header hgroup hr i img " +
    "input ins kbd label legend li main map mark marquee menu menuitem meter nav nobr ol optgroup " +
    "option output p picture pre progress q rb rp rt rtc ruby s samp search section select small " +
    "spacer span strike strong sub summary sup table tbody td textarea tfoot th thead time tr tt u " +
    "ul var wbr"
).split(" "));

// Ordinary global, text, table, image, list and form attributes retained by the
// source's ATTR loop (CleanHTML.pm714-934). URL-bearing members are validated by
// element/context separately. Include presentation-era attributes deliberately.
export const entryAttributes = new Set((
    "abbr accept accept-charset accesskey align allowpaymentrequest alt as async autocapitalize " +
    "autocomplete autocorrect autofocus axis background bgcolor bgproperties border bordercolor " +
    "bordercolordark bordercolorlight cellpadding cellspacing char charoff charset checked cite " +
    "class clear color cols colspan compact contenteditable coords datetime decoding default dir " +
    "direction disabled download draggable enctype enterkeyhint face fgcolor for formaction " +
    "formenctype formmethod formnovalidate formtarget frame headers height hidden high href hreflang " +
    "hspace id inert inputmode ismap itemid itemprop itemref itemscope itemtype kind label lang language " +
    "list loading loop low marginheight marginwidth max maxlength media method min minlength multiple " +
    "muted name noshade novalidate nowrap open optimum pattern placeholder playsinline preload " +
    "radiogroup readonly referrerpolicy rel required rev reversed role rows rowspan rules scope " +
    "scrollamount scrolldelay selected shape size sizes span spellcheck src srcset start step style " +
    "summary tabindex target text title translate truespeed type usemap valign value vspace width wrap " +
    "action behavior longdesc"
).split(" "));

// Source eat/remove rules. These are intentional transformations, not a default
// sanitizer allowlist. Rawtext and application/foreign contexts are handled
// separately before removal so their content cannot disappear accidentally.
export const eatenTags = new Set([
    "head", "title", "style", "layer", "iframe", "applet", "object", "xml", "param", "base", "script",
]);
export const removedTags = new Set([
    "bgsound", "embed", "link", "body", "meta", "noscript",
]);
export const unsupportedRawtext = new Set(["xmp", "listing", "plaintext", "noframes"]);

// These may be hoisted out of an entry body by the HTML parser. Each is already
// an unconditional source eat/remove rule. Other head contexts, notably template
// and noframes, must not evade body inventory by disappearing into the head.
export const discardedHeadTags = new Set(["base", "link", "meta", "style", "title", "script", "noscript"]);

export function ordinaryAttribute(name: string): boolean {
    // Match the maintained DOMPurify DATA_ATTR/ARIA_ATTR name domains; accepting
    // a broader namespace here would silently lose attributes in the final pass.
    return entryAttributes.has(name) || /^data-[\-\w.\u00B7-\uFFFF]+$/.test(name) ||
        /^aria-[\-\w]+$/.test(name);
}

// Modern form-owner/command/shadow capabilities can target trusted surrounding
// controls; source IDs are stripped, so association cannot be confined to this
// fragment. Refuse them explicitly, never silently drop an unknown attribute.
export const externalControlAttributes = new Set([
    "form", "command", "commandfor", "popovertarget", "popovertargetaction", "popover",
    "is", "slot", "shadowrootmode", "shadowrootdelegatesfocus", "shadowrootclonable", "shadowrootserializable",
]);
