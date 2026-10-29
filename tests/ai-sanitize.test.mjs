// The model's HTML is cleaned twice: in the offscreen document
// (src/offscreen/sanitize.js) and in the content script right before the
// editor (EBS.ai.sanitizeHtml in src/features/ai.js). Both must give the
// same answer, and neither may let anything active through.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHtml } from '../src/offscreen/sanitize.js';
import { closeAll, page } from './dom.mjs';

after(closeAll);

const ORIGINAL = '<p>Betaal <a href="https://example.test/betalen">hier</a>.</p><div style="display:none;max-height:0">Voorbeeldregel</div><p>Met vriendelijke groet,</p><p><img src="https://secure20.e-boekhouden.nl/logo/123.png" alt="Logo"></p>';
const INSTRUCTION = 'Voeg een link naar vraag.test/offerte toe';
const CASES = [
  ['plain paragraphs stay', '<p>[RELAANHEF],</p><p>Bijgaand treft u factuur <strong>[FACTNUMMER]</strong> aan.</p>', '<p>[RELAANHEF],</p><p>Bijgaand treft u factuur <strong>[FACTNUMMER]</strong> aan.</p>'],
  ['scripts go with their content', '<p>a</p><script>alert(1)</script><style>p{}</style>', '<p>a</p>'],
  ['event handlers go', '<p onclick="steal()" onmouseover="x">a</p>', '<p>a</p>'],
  ['javascript links lose their href', '<a href="javascript:alert(1)">klik</a> <a href=" JaVaScRiPt:alert(1)">b</a>', '<a>klik</a> <a>b</a>'],
  ['links from the text and variable links stay', '<a href="https://example.test/betalen" title="Betalen">betaal</a> <a href="mailto:[ABEMAIL]">mail</a> <a href="[ABWEBSITE]">site</a>', '<a href="https://example.test/betalen" title="Betalen">betaal</a> <a href="mailto:[ABEMAIL]">mail</a> <a href="[ABWEBSITE]">site</a>'],
  ['a new link stays only when it shows its address', '<a href="https://www.mijnzaak.test/">mijnzaak.test</a> <a href="mailto:info@mijnzaak.test">info@mijnzaak.test</a> <a href="https://other.test">hier</a>', '<a href="https://www.mijnzaak.test/">mijnzaak.test</a> <a href="mailto:info@mijnzaak.test">info@mijnzaak.test</a> <a>hier</a>'],
  ['a new link the user asked for in the instruction stays', '<a href="https://www.vraag.test/offerte">offerte</a>', '<a href="https://www.vraag.test/offerte">offerte</a>'],
  ['styles stay unless they load something', '<span style="color:#b42318">rood</span><span style="background:url(https://track.test/p.gif)">x</span>', '<span style="color:#b42318">rood</span><span>x</span>'],
  ['new images go, images from the text stay', '<p><img src="https://track.test/pixel.gif"></p><p><img src="https://secure20.e-boekhouden.nl/logo/123.png" alt="Logo" onerror="x()"></p>', '<p></p><p><img src="https://secure20.e-boekhouden.nl/logo/123.png" alt="Logo"></p>'],
  ['iframes, forms and svg go', '<iframe src="https://x.test"></iframe><form action="/x"><input name="a"></form><svg><script>1</script></svg>ok', 'ok'],
  ['unknown tags are unwrapped', '<section><article><p>tekst</p></article></section><custom-tag>los</custom-tag>', '<p>tekst</p>los'],
  ['comments and ids go', '<!-- weg --><p id="x" class="y" data-a="b">a</p>', '<p>a</p>'],
  ['tables keep their structure', '<table border="0" onload="x"><tbody><tr><td colspan="2" style="width:50%">[FACTUURREGELS]</td></tr></tbody></table>', '<table border="0"><tbody><tr><td colspan="2" style="width:50%">[FACTUURREGELS]</td></tr></tbody></table>'],
  ['text is escaped, not parsed twice', '<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; 5 &gt; 3</p>', '<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; 5 &gt; 3</p>'],
  ['a broken tag cannot break out', '<p title="a"><img src=x onerror=alert(1)//"></p>', '<p></p>'],
  // What a text that talks to the model (prompt injection) could make it write.
  ['injected: a hidden link goes', '<p>Bijgaand factuur [FACTNUMMER].<a href="https://evil.test/c"></a><a href="https://evil.test/c"><span style="font-size:0">x</span></a></p>', '<p>Bijgaand factuur [FACTNUMMER].<a></a><a><span>x</span></a></p>'],
  ['injected: a link that sends customer data goes', '<a href="https://evil.test/?iban=[RELIBAN]">https://evil.test/?iban=[RELIBAN]</a>', '<a>https://evil.test/?iban=[RELIBAN]</a>'],
  ['injected: text hidden by style loses the style', '<p style="display:none">x</p><p style="color: transparent">y</p><p style="position:absolute;left:-9999px">z</p><p style="opacity:0">o</p><p style="height:0;overflow:hidden">h</p><p style="font-size:0.9em">klein</p>', '<p>x</p><p>y</p><p>z</p><p>o</p><p>h</p><p style="font-size:0.9em">klein</p>'],
  ['a hiding style the text already had stays', '<div style="display:none;max-height:0">Voorbeeldregel</div>', '<div style="display:none;max-height:0">Voorbeeldregel</div>'],
  ['injected: script by any route goes', '<p>a<scr<script>ipt>alert(1)</script></p><a href="data:text/html,<script>1</script>">d</a><a href="vbscript:x">v</a>', '<p>aipt&gt;alert(1)</p><a>d</a><a>v</a>'],
];

test('both sanitizers agree and let nothing active through', async () => {
  const p = page('<!doctype html><html><head></head><body></body></html>', { url: 'https://secure20.e-boekhouden.nl/beheer/sjabloon/email/1' });
  p.load('main-world.js', 'shared.js', 'icons.js', 'bridge.js', 'features/ai.js');
  const content = p.window.EBS.ai.sanitizeHtml;
  for (const [label, input, expected] of CASES) {
    const offscreen = sanitizeHtml(input, { DOMParser: p.window.DOMParser, original: ORIGINAL, instruction: INSTRUCTION });
    assert.equal(offscreen, expected, `offscreen: ${label}`);
    assert.equal(content(input, { original: ORIGINAL, instruction: INSTRUCTION }), expected, `content script: ${label}`);
    assert.doesNotMatch(offscreen, /<script|onerror|onclick|javascript:|href="(?:[^"]*evil|data:|vbscript:)/i, label);
  }
  p.close();
});
