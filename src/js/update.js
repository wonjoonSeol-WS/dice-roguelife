/* ============ update check ============ */
import { $, esc, noteIgnored, toast } from './util.js';
import { app, APP_VERSION, RELEASES_URL } from './app.js';
import { saveSettings } from './settings.js';
import { openSheet } from './sheet.js';
import { T } from './i18n.js';

// The artifact's CSP blocks GitHub, so the player pastes a request into a new Claude chat. It must overwrite this same
// artifact (saves live in its database) and fetch with curl (GitHub blocks Claude's web reader).
const GUIDE_URL = 'https://wonjoonseol.github.io/dice-roguelife/#install';
function updateRequestText(link) {
  return [
    T('Use your computer tool (bash) to download the file with the command below. Do not use web fetch.'),
    `curl -L -o dice-roguelife.html ${RELEASES_URL}/latest/download/dice-roguelife.html`,
    T(
      'Check that the file is an HTML file of a few hundred KB, then overwrite my artifact at the link below instead of creating a new one.',
    ),
    T('Set its capabilities to db, sample, user, assets, downloads, artifact.'),
    T('My artifact: {link}', { link: link || T('(my artifact link here)') }),
  ].join('\n');
}

export function openUpdateSheet() {
  openSheet(`<h3>${T('Check for updates')}</h3>
    <p class="upd-p">${T('You are on <b>v{version}</b>. See new versions and what changed on the <a href="{url}" target="_blank" rel="noopener">GitHub releases page</a>.', { version: esc(APP_VERSION), url: RELEASES_URL })}</p>
    <p class="upd-p muted">${T('To update, copy the request below and paste it into a <b>new Claude chat</b>. This artifact\'s link has to go with it, so the same link is overwritten and your saves stay. Claude can only download the file with <b>Allow network egress</b> turned on in its settings. If you get stuck, see "If you get stuck" in the <a href="{guide}" target="_blank" rel="noopener">install guide</a>.', { guide: GUIDE_URL })}</p>
    <div class="field"><label for="updLink">${T('My artifact link')}</label><input id="updLink" type="url" placeholder="https://claude.ai/artifact/..." value="${esc(app.settings.artifactLink || '')}"></div>
    <textarea id="updText" class="upd-text" readonly aria-label="${T('Update request text')}"></textarea>
    <div class="row upd-actions"><button class="btn primary" id="updCopy" type="button">${T('Copy text')}</button><button class="btn ghost" type="button" data-close>${T('Close')}</button></div>`);
  const link = $('#updLink');
  const text = $('#updText');
  const refresh = () => (text.value = updateRequestText(link.value.trim()));
  refresh();
  link.oninput = refresh;
  link.onchange = async () => {
    app.settings.artifactLink = link.value.trim();
    await saveSettings().catch(e => noteIgnored('update: save the artifact link', e));
  };
  $('#updCopy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(text.value);
      toast(T('Copied'));
    } catch {
      text.select(); // clipboard blocked in this frame: leave the text selected for a manual copy
      toast(T('Copying is blocked here. Copy the selected text yourself'));
    }
  };
}
