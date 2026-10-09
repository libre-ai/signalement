export const popupRdpScript = `
// Marionette chrome-context async body; no network debugger or permission grants.
// Run only AFTER native action popup is open on the unchanged synthetic tab.
const done = arguments[arguments.length - 1];
(async () => {
  const addonId = 'signalement@libre-ai.invalid';
  const popupBrowser = document.querySelector('browser[webextension-view-type="popup"]');
  if (!popupBrowser || popupBrowser.closest('panel')?.state !== 'open') throw new Error('Popup not open');
  const expectedURL = popupBrowser.currentURI.spec;
  const expectedContext = String(popupBrowser.browsingContext.id);
  if (!expectedURL.startsWith('moz-extension:') || !expectedURL.endsWith('/popup.html')) throw new Error('Wrong popup');
  const { require } = ChromeUtils.importESModule('resource://devtools/shared/loader/Loader.sys.mjs');
  const { CommandsFactory } = require('resource://devtools/shared/commands/commands-factory.js');
  const commands = await CommandsFactory.forAddon(addonId);
  try {
    await commands.targetCommand.startListening();
    const target = commands.targetCommand.getAllTargets(['frame']).find(item =>
      item.url === expectedURL && String(item.browsingContextID) === expectedContext);
    if (!target) throw new Error('Exact popup target absent');
    const probe = await commands.scriptCommand.execute(
      "Boolean(document.getElementById('capture') && location.pathname === '/popup.html')",
      { selectedTargetFront: target });
    if (probe.exception || probe.result !== true) throw new Error('Popup DOM mismatch');
    // Delay dispatch to allow the console result to cross RDP before window.close destroys its actor.
    const result = await commands.scriptCommand.execute(
      "setTimeout(() => document.getElementById('capture').click(), 100); 'scheduled'",
      { selectedTargetFront: target });
    if (result.exception || result.result !== 'scheduled') throw new Error('DOM click scheduling failed');
    return { stage: 'popup-dom-click-scheduled', qualified: false };
  } finally {
    await commands.destroy();
  }
})().then(done, error => done({ error: String(error), qualified: false }));
`;
