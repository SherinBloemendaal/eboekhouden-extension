// A folder change in the Digitaal archief always ends in rows, an empty
// folder or an error, never in an endless skeleton. e-Boekhouden's answer to
// a folder click can come before the view is there, while the screen still
// loads, late, out of order or never; and e-Boekhouden's file header skips a
// folder change while its own GET still runs (archive-mock.mjs does the
// same), so it can keep the name of the folder before.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeAll } from './dom.mjs';
import { archivePage, click, folderButton, hold, nativeLog, rowNames, settleAll, trusted, wait } from './archive-page.mjs';

after(closeAll);

// archive.js: LOAD_TIMEOUT and ROWS_GRACE.
const LOAD_TIMEOUT = 6000;
const ROWS_GRACE = 1500;

const state = (p) => p.$('.ebs-ar').dataset.state;
const frame = (p) => new Promise((resolve) => p.window.requestAnimationFrame(resolve));

// GETs whose answer waits: by path, the n-th time it is asked (1 = the first).
function gates(rules) {
  const seen = new Map();
  return (path) => {
    for (const [pattern, nth, held] of rules) {
      if (!pattern.test(path)) continue;
      const count = (seen.get(pattern) ?? 0) + 1;
      seen.set(pattern, count);
      if (count === nth) return held;
    }
    return null;
  };
}

describe('a folder change always ends', { concurrency: true }, () => {
  test('answered before the view is there: the rows show at once, and the next folder loads', async () => {
    const p = await archivePage({ nativeFirst: true });
    assert.equal(state(p), 'rows');
    click(p, folderButton(p, 'Inbox'));
    await settleAll(p, 6);
    assert.equal(state(p), 'rows');
    assert.deepEqual(rowNames(p), ['Bonnetje tankstation.jpg', 'Scan 0043.pdf']);
  });

  test('the next folder click after e-Boekhouden rebuilt its tree (the live hang)', async () => {
    // e-Boekhouden asks folder/directory again after each folder change and
    // then draws its whole tree anew. Here that answer comes after the view
    // has drawn the new selection, as it mostly does on the live site.
    const tree = hold();
    const p = await archivePage({ gate: gates([[/\/folder\/directory$/, 2, tree.held]]) });
    click(p, folderButton(p, 'Inbox'));
    await settleAll(p, 6);
    assert.equal(state(p), 'rows');
    const before = p.$('app-digitaal-archief-folder-list .dirLabel');
    tree.open();
    await settleAll(p);
    assert.equal(before.isConnected, false, 'e-Boekhouden\'s tree has new elements');
    click(p, folderButton(p, 'Leeg'));
    await settleAll(p, 6);
    assert.ok(p.calls.some((href) => href.endsWith('/folder/14/filelist')), 'the click reached e-Boekhouden');
    await wait(300);
    await settleAll(p);
    assert.equal(state(p), 'empty');
    assert.equal(p.$('.ebs-ar-folder.current').textContent, 'Leeg');
    click(p, folderButton(p, 'Inkoopfacturen 2026'));
    await settleAll(p, 6);
    await wait(300);
    await settleAll(p);
    assert.equal(state(p), 'rows', 'and the one after');
    assert.equal(rowNames(p).length, 8);
  });

  test('the first click while the screen still loads its header: the header lags, the view does not', async () => {
    // e-Boekhouden loaded before the extension saw anything, and its first
    // header GET still runs when the user opens Leeg: the header skips Leeg
    // and then shows the folder before.
    const first = hold();
    const p = await archivePage({ nativeFirst: true, gate: gates([[/\/header$/, 1, first.held]]) });
    click(p, folderButton(p, 'Leeg'));
    await wait(40);
    first.open();
    await settleAll(p, 6);
    await wait(500);
    await settleAll(p);
    assert.equal(p.$('app-digitaal-archief-file-header .dirLabel span').textContent, 'Inkoopfacturen 2026', 'e-Boekhouden\'s header lags a folder behind');
    assert.equal(state(p), 'empty', 'the folder is in, not the skeleton');
    assert.equal(p.$('.ebs-ar-folder.current').textContent, 'Leeg');
    assert.match(p.$('.ebs-ar-subtitle').textContent, /^0 bestanden in Leeg/, 'the name from the tree, not from the lagging header');
    await wait(LOAD_TIMEOUT);
    await settleAll(p);
    assert.equal(state(p), 'empty', 'and it stays so');
  });

  test('the answer comes after the view is drawn: skeleton, then the rows', async () => {
    const p = await archivePage({ slow: 700 });
    click(p, folderButton(p, 'Inbox'));
    await frame(p);
    await frame(p);
    assert.equal(state(p), 'loading');
    await wait(900);
    await settleAll(p);
    assert.equal(state(p), 'rows');
    assert.deepEqual(rowNames(p), ['Bonnetje tankstation.jpg', 'Scan 0043.pdf']);
  });

  test('a click before the screen\'s first list is in: that folder, not an error about another one', async () => {
    // The screen's own first list (Inkoopfacturen 2026) and Inbox's both
    // still run; the screen's comes in first.
    const first = hold();
    const inbox = hold();
    const p = await archivePage({ gate: gates([[/\/folder\/12\/filelist$/, 1, first.held], [/\/folder\/11\/filelist$/, 1, inbox.held]]) });
    assert.equal(state(p), 'loading');
    click(p, folderButton(p, 'Inbox'));
    await settleAll(p, 6);
    first.open();
    const seen = new Set();
    for (let i = 0; i < 10; i += 1) {
      await frame(p);
      await wait(20);
      seen.add(state(p));
    }
    assert.deepEqual([...seen], ['loading'], 'no "andere map" and no other folder\'s rows while Inbox is still to come');
    inbox.open();
    await settleAll(p, 6);
    await wait(200);
    await settleAll(p);
    assert.equal(state(p), 'rows');
    assert.deepEqual(rowNames(p), ['Bonnetje tankstation.jpg', 'Scan 0043.pdf']);
  });

  test('two quick clicks, the later folder answered last: that folder, without the other one in between', async () => {
    const leeg = hold();
    const p = await archivePage({ gate: gates([[/\/folder\/14\/filelist$/, 1, leeg.held]]) });
    click(p, folderButton(p, 'Inbox'));
    click(p, folderButton(p, 'Leeg'));
    await settleAll(p, 6);
    assert.equal(state(p), 'loading', 'the answer for Inbox does not end the wait for Leeg');
    assert.equal(p.$('.ebs-ar-body').hidden, true, 'Inbox\'s rows never show under Leeg');
    assert.equal(p.$('.ebs-ar-skeleton').hidden, false);
    leeg.open();
    await settleAll(p, 6);
    await wait(400);
    await settleAll(p);
    assert.equal(state(p), 'empty');
    assert.equal(p.$('.ebs-ar-folder.current').textContent, 'Leeg');
  });

  test('two quick clicks, the earlier folder answered last: an error, not the wrong rows; Opnieuw proberen fixes it', async () => {
    const inbox = hold();
    const p = await archivePage({ gate: gates([[/\/folder\/11\/filelist$/, 1, inbox.held]]) });
    click(p, folderButton(p, 'Inbox'));
    click(p, folderButton(p, 'Leeg'));
    await settleAll(p, 6);
    inbox.open();
    await settleAll(p, 6);
    await wait(100);
    await settleAll(p);
    // e-Boekhouden itself now shows Inbox's files while Leeg is chosen.
    assert.equal(p.$$('app-digitaal-archief-file-list .row').length, 2);
    assert.equal(state(p), 'mismatch');
    assert.equal(p.$('.ebs-ar-error-title').textContent, 'Kon de map niet laden');
    assert.equal(p.$('.ebs-ar-error-text').textContent, 'e-Boekhouden toont de lijst van een andere map dan die je koos. Je bestanden zijn niet weg.');
    const retry = p.$('.ebs-ar-error .ebs-ar-button');
    assert.equal(retry.textContent, 'Opnieuw proberen');
    trusted(p, retry);
    assert.deepEqual(nativeLog(p), ['Lijst vernieuwen']);
    await settleAll(p, 6);
    await wait(400);
    await settleAll(p);
    assert.equal(state(p), 'empty', 'e-Boekhouden reloaded the chosen folder');
  });

  test('an answer that never comes: "Kon de map niet laden", and Opnieuw proberen clicks e-Boekhouden\'s refresh', async () => {
    const never = new Promise(() => {});
    const p = await archivePage({ gate: gates([[/\/folder\/14\/filelist$/, 1, never]]) });
    click(p, folderButton(p, 'Leeg'));
    await settleAll(p);
    assert.equal(state(p), 'loading');
    await wait(LOAD_TIMEOUT + 200);
    await settleAll(p);
    assert.equal(state(p), 'failed', 'no endless skeleton');
    assert.equal(p.$('.ebs-ar-skeleton').hidden, true);
    assert.equal(p.$('.ebs-ar-error-title').textContent, 'Kon de map niet laden');
    assert.equal(p.$('.ebs-ar-error-text').textContent, 'e-Boekhouden gaf de lijst van deze map niet door. Je bestanden zijn niet weg.');
    const retry = p.$('.ebs-ar-error .ebs-ar-button');
    assert.equal(retry.textContent, 'Opnieuw proberen');
    click(p, retry);
    await settleAll(p);
    assert.deepEqual(nativeLog(p), [], 'a script click does nothing');
    trusted(p, retry);
    assert.deepEqual(nativeLog(p), ['Lijst vernieuwen'], 'e-Boekhouden\'s own refresh, in the click');
    await settleAll(p, 6);
    await wait(300);
    await settleAll(p);
    assert.equal(state(p), 'empty');
  });

  test('an answer that comes after the time-out still brings the folder', async () => {
    const late = hold();
    const p = await archivePage({ gate: gates([[/\/folder\/11\/filelist$/, 1, late.held]]) });
    click(p, folderButton(p, 'Inbox'));
    await wait(LOAD_TIMEOUT + 200);
    await settleAll(p);
    assert.equal(state(p), 'failed');
    late.open();
    await settleAll(p, 6);
    await wait(300);
    await settleAll(p);
    assert.equal(state(p), 'rows');
    assert.deepEqual(rowNames(p), ['Bonnetje tankstation.jpg', 'Scan 0043.pdf']);
  });

  test('an answer with files that e-Boekhouden never draws ends in the error too', async () => {
    const p = await archivePage();
    click(p, folderButton(p, 'Inbox'));
    // The answer is in; take its rows away again before they settle, as a
    // list that does not draw them.
    const body = () => p.$('app-digitaal-archief-file-list .body');
    const inboxRows = () => [...(body()?.querySelectorAll('.row') ?? [])].some((row) => row.textContent.includes('Scan 0043.pdf'));
    for (let i = 0; i < 80 && !inboxRows(); i += 1) await wait(5);
    assert.ok(inboxRows());
    for (const row of body().querySelectorAll('.row')) row.remove();
    await settleAll(p);
    assert.notEqual(state(p), 'empty', 'not an empty folder: its answer has files');
    await wait(ROWS_GRACE + 300);
    await settleAll(p);
    assert.equal(state(p), 'failed');
  });

  test('the screen\'s own first list that never comes ends in the error', async () => {
    const never = new Promise(() => {});
    const p = await archivePage({ gate: gates([[/\/folder\/12\/filelist$/, 1, never]]) });
    assert.equal(state(p), 'loading');
    await wait(LOAD_TIMEOUT + 200);
    await settleAll(p);
    assert.equal(state(p), 'failed');
  });
});
