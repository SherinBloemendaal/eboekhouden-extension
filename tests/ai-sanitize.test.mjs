// The model's HTML is cleaned twice: in the offscreen document
// (src/offscreen/sanitize.js) and in the content script right before the
// editor (EBS.ai.sanitizeHtml in src/features/ai.js). Both must give the
// same answer, and neither may let anything active through.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHtml } from '../src/offscreen/sanitize.js';
import { closeAll, page } from './dom.mjs';

after(closeAll);

const ORIGINAL = '<p>Met vriendelijke groet,</p><p><img src="https://secure20.e-boekhouden.nl/logo/123.png" alt="Logo"></p>';
const CASES = [
  ['plain paragraphs stay', '<p>[RELAANHEF],</p><p>Bijgaand treft u factuur <strong>[FACTNUMMER]</strong> aan.</p>', '<p>[RELAANHEF],</p><p>Bijgaand treft u factuur <strong>[FACTNUMMER]</strong> aan.</p>'],
  ['scripts go with their content', '<p>a</p><script>alert(1)</script><style>p{}</style>', '<p>a</p>'],
  ['event handlers go', '<p onclick="steal()" onmouseover="x">a</p>', '<p>a</p>'],
  ['javascript links lose their href', '<a href="javascript:alert(1)">klik</a> <a href=" JaVaScRiPt:alert(1)">b</a>', '<a>klik</a> <a>b</a>'],
  ['safe links and variable links stay', '<a href="https://example.test/betalen" title="Betalen">betaal</a> <a href="mailto:[ABEMAIL]">mail</a> <a href="[ABWEBSITE]">site</a>', '<a href="https://example.test/betalen" title="Betalen">betaal</a> <a href="mailto:[ABEMAIL]">mail</a> <a href="[ABWEBSITE]">site</a>'],
  ['styles stay unless they load something', '<span style="color:#b42318">rood</span><span style="background:url(https://track.test/p.gif)">x</span>', '<span style="color:#b42318">rood</span><span>x</span>'],
  ['new images go, images from the text stay', '<p><img src="https://track.test/pixel.gif"></p><p><img src="https://secure20.e-boekhouden.nl/logo/123.png" alt="Logo" onerror="x()"></p>', '<p></p><p><img src="https://secure20.e-boekhouden.nl/logo/123.png" alt="Logo"></p>'],
  ['iframes, forms and svg go', '<iframe src="https://x.test"></iframe><form action="/x"><input name="a"></form><svg><script>1</script></svg>ok', 'ok'],
  ['unknown tags are unwrapped', '<section><article><p>tekst</p></article></section><custom-tag>los</custom-tag>', '<p>tekst</p>los'],
  ['comments and ids go', '<!-- weg --><p id="x" class="y" data-a="b">a</p>', '<p>a</p>'],
  ['tables keep their structure', '<table border="0" onload="x"><tbody><tr><td colspan="2" style="width:50%">[FACTUURREGELS]</td></tr></tbody></table>', '<table border="0"><tbody><tr><td colspan="2" style="width:50%">[FACTUURREGELS]</td></tr></tbody></table>'],
  ['text is escaped, not parsed twice', '<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; 5 &gt; 3</p>', '<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; 5 &gt; 3</p>'],
  ['a broken tag cannot break out', '<p title="a"><img src=x onerror=alert(1)//"></p>', '<p></p>'],
];

test('both sanitizers agree and let nothing active through', async () => {
  const p = page('<!doctype html><html><head></head><body></body></html>', { url: 'https://secure20.e-boekhouden.nl/beheer/sjabloon/email/1' });
  p.load('main-world.js', 'shared.js', 'icons.js', 'bridge.js', 'features/ai.js');
  const content = p.window.EBS.ai.sanitizeHtml;
  for (const [label, input, expected] of CASES) {
    const offscreen = sanitizeHtml(input, { DOMParser: p.window.DOMParser, original: ORIGINAL });
    assert.equal(offscreen, expected, `offscreen: ${label}`);
    assert.equal(content(input, { original: ORIGINAL }), expected, `content script: ${label}`);
    assert.doesNotMatch(offscreen, /<script|onerror|onclick|javascript:/i, label);
  }
  p.close();
});
