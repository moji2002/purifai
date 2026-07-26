// Shared attack corpus. Single source of truth for every suite in test/.
// Generated from the original comprehensive-test.js array — do not fork this list.

/** 64 attack vectors from OWASP, PortSwigger, and published security research. */
export const ATTACK_VECTORS = [
  "<script>alert(\"xss\")</script>",
  "<img src=x onerror=alert(1)>",
  "<svg onload=alert(1)>",
  "<body onload=alert(1)>",
  "<iframe src=\"javascript:alert(1)\">",
  "<object data=\"javascript:alert(1)\">",
  "<embed src=\"javascript:alert(1)\">",
  "<link href=\"javascript:alert(1)\">",
  "<meta http-equiv=\"refresh\" content=\"0;url=javascript:alert(1)\">",
  "<form action=\"javascript:alert(1)\">",
  "<div onclick=\"alert(1)\">",
  "<a href=\"javascript:alert(1)\">",
  "<input type=\"text\" autofocus onfocus=\"alert(1)\">",
  "<select autofocus onfocus=\"alert(1)\">",
  "<textarea autofocus onfocus=\"alert(1)\">",
  "<keygen autofocus onfocus=\"alert(1)\">",
  "<video><source onerror=\"alert(1)\">",
  "<audio src=x onerror=alert(1)>",
  "<details open ontoggle=alert(1)>",
  "<marquee onstart=alert(1)>",
  "javascript:alert(1)",
  "vbscript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "data:image/svg+xml,<svg onload=alert(1)>",
  "<div style=\"background:url(javascript:alert(1))\">",
  "<div style=\"expression(alert(1))\">",
  "<style>@import \"javascript:alert(1)\";</style>",
  "<style>body{background:url(\"javascript:alert(1)\")}</style>",
  "{{constructor.constructor(\"alert(1)\")()}}",
  "<%- alert(1) %>",
  "<?= alert(1) ?>",
  "${alert(1)}",
  "#{alert(1)}",
  "jaVasCript:/*-/*`/*\\`/*'/*\"/**/(/* */oNcliCk=alert() )//%0D%0A%0d%0a//</stYle/</titLe/</teXtarEa/</scRipt/--!>\\x3csVg/<sVg/oNloAd=alert()///>\\x3e",
  "javascript:/*--></title></style></textarea></script></xmp><svg/onload='+/\"/+/onmouseover=1/+/[*/[]/+alert(1)//'>",
  "<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>",
  "&#60;script&#62;alert(1)&#60;/script&#62;",
  "%3Cscript%3Ealert(1)%3C/script%3E",
  "\\u003cscript\\u003ealert(1)\\u003c/script\\u003e",
  "\\x3cscript\\x3ealert(1)\\x3c/script\\x3e",
  "\"><script>alert(1)</script>",
  "';alert(1);//",
  "</title><script>alert(1)</script>",
  "</textarea><script>alert(1)</script>",
  "</style><script>alert(1)</script>",
  "<svg><foreignObject><iframe src=\"javascript:alert(1)\"></foreignObject></svg>",
  "<math><mtext><option><FAKEFAKE><option></option><mglyph><svg><mtext><textarea><path d=\"M0,0\" style=\"fill:url(#a)\"><animate attributeName=\"fill\" values=\"#fff;#000\" dur=\"1s\" repeatCount=\"indefinite\"/></path></textarea></mtext></svg></mglyph></mtext></math>",
  "<svg><use href=\"data:image/svg+xml,&lt;svg id='x' xmlns='http://www.w3.org/2000/svg' &gt;&lt;image href='1' onerror='alert(1)' /&gt;&lt;/svg&gt;#x\" />",
  "<form id=\"test\"><input name=\"action\"><input name=\"submit\">",
  "<img name=\"implementation\" src=\"1\">",
  "<iframe name=\"constructor\" src=\"1\">",
  "<base href=\"javascript:alert(1)//\">",
  "<meta name=\"referrer\" content=\"unsafe-url\">",
  "<link rel=\"prefetch\" href=\"javascript:alert(1)\">",
  "<input type=\"image\" src=\"1\" formaction=\"javascript:alert(1)\">",
  "<button formaction=\"javascript:alert(1)\">",
  "<input type=\"submit\" formaction=\"javascript:alert(1)\">",
  "<datalist><option value=\"javascript:alert(1)\">",
  "<output for=\"x\" form=\"y\">",
  "<x onclick=\"alert(1)\">",
  "<script src=\"data:,alert(1)\">",
  "<iframe srcdoc=\"<script>alert(1)</script>\">",
  "<object type=\"text/html\" data=\"data:text/html,<script>alert(1)</script>\">",
  "<embed type=\"text/html\" src=\"data:text/html,<script>alert(1)</script>\">"
];

/**
 * Modern attack classes: mutation XSS, namespace confusion, rawtext breakout,
 * depth flattening, DOM clobbering, template reassembly.
 * Sources: cure53/DOMPurify attack-class wiki, PortSwigger mXSS research.
 */
export const MODERN_VECTORS = [
  '<svg></p><style><a id="</style><img src=x onerror=alert(1)>"></svg>',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  '<svg><p><style><img src=x onerror=alert(1)></style></p></svg>',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  '<form><math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  '<form><input name=nodeName></form>',
  '<div>{<foo></foo>{constructor.constructor("alert(1)")()}<foo></foo>}</div>',
  '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;">',
  '<math><mtext><table><mglyph><style><![CDATA[</style><img title="]]&gt;&lt;/mglyph&gt;&lt;img&Tab;src=1&Tab;onerror=alert(1)&gt;">',
  '<div>'.repeat(600) + '<style><img src=x onerror=alert(1)>',
  '<!--><script>alert(1)</script>-->',
  '<![CDATA[<script>alert(1)</script>]]>',
  '<img src=x onerror=&#97;lert(1)>',
  '<img\tsrc=x\tonerror=alert(1)>',
  '<svg><animate onbegin=alert(1) attributeName=x dur=1s>',
  '<svg><set attributeName=href to="javascript:alert(1)">',
  '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;">',
  '<base href="javascript:alert(1)//">',
  '<meta http-equiv=refresh content="0;url=javascript:alert(1)">',
  '<div style="width:expression(alert(1))">'
];

/**
 * Benign content that a sanitizer SHOULD preserve. This is the fidelity axis:
 * a sanitizer that deletes everything is perfectly secure and useless, so
 * security cannot be scored without measuring what survives alongside it.
 *
 * `text` is the reader-visible content that must survive in every case.
 * `tags` are safe elements a preserving sanitizer is expected to keep.
 */
export const BENIGN_CORPUS = [
  { html: '<p>Hello <b>world</b></p>', text: 'Hello world', tags: ['p', 'b'] },
  { html: '<a href="https://example.com">link</a>', text: 'link', tags: ['a'] },
  { html: '<ul><li>one</li><li>two</li></ul>', text: 'onetwo', tags: ['ul', 'li'] },
  { html: '<em>emphasis</em> and <strong>strong</strong>', text: 'emphasis and strong', tags: ['em', 'strong'] },
  { html: '<blockquote>quoted text</blockquote>', text: 'quoted text', tags: ['blockquote'] },
  { html: '<code>const x = 1;</code>', text: 'const x = 1;', tags: ['code'] },
  { html: '<p>Line one<br>Line two</p>', text: 'Line oneLine two', tags: ['p', 'br'] },
  { html: '<h2>Heading</h2><p>Body copy.</p>', text: 'HeadingBody copy.', tags: ['h2', 'p'] },
  { html: 'Plain text, no markup at all.', text: 'Plain text, no markup at all.', tags: [] },
  { html: 'Price is 100% of $5 (five dollars).', text: 'Price is 100% of $5 (five dollars).', tags: [] },
  { html: 'Email me at someone@example.com', text: 'Email me at someone@example.com', tags: [] },
  { html: 'Visit https://example.com/path?a=1&b=2 today', text: 'Visit https://example.com/path?a=1&b=2 today', tags: [] },
  { html: '5 < 6 and 7 > 3', text: '5 < 6 and 7 > 3', tags: [] },
  { html: 'Résumé — naïve café 日本語 🎉', text: 'Résumé — naïve café 日本語 🎉', tags: [] },
  { html: '<p>Multi<br>line<br>text</p>', text: 'Multilinetext', tags: ['p', 'br'] }
];
