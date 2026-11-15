export function installWorkspaceChrome(doc = document, { onOpenChannels = () => {}, onCloseChannels = () => {}, onEscape = () => false } = {}) {
  const drawers = { channels: doc.querySelector('#channelsDrawer'), productions: doc.querySelector('#episodeRail') };
  const toggles = { channels: doc.querySelector('#channelsToggle'), productions: doc.querySelector('#episodeRailToggle') };
  const backdrop = doc.querySelector('#drawerBackdrop');
  const covered = ['#episodesPage', '#brandingPage', '#providersPage', '#modelsPage', '.page-nav']
    .map((selector) => doc.querySelector(selector)).filter(Boolean);
  let current = null, previous = null, opener = null, suspended = false;
  const focusables = () => [...drawers[current].querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')]
    .filter((element) => !element.closest('[hidden]') && element.getClientRects().length);
  function paint() {
    for (const [name, drawer] of Object.entries(drawers)) {
      const open = name === current;
      drawer.classList.toggle('is-open', open && !suspended);
      drawer.inert = !open || suspended;
      drawer.setAttribute('aria-hidden', String(!open || suspended));
      toggles[name].setAttribute('aria-expanded', String(open));
      toggles[name].setAttribute('aria-label', `${open ? 'Close' : 'Open'} ${name === 'channels' ? 'Channels' : 'Productions'}`);
    }
    backdrop.hidden = !current || suspended;
    for (const element of covered) element.inert = !!current && !suspended;
    doc.querySelector('#channelsBack').hidden = previous !== 'productions' || current !== 'channels';
  }
  function close({ focus = true } = {}) {
    if (!current) return;
    if (current === 'channels') onCloseChannels();
    current = null; previous = null; suspended = false;
    paint();
    if (focus) (opener || toggles.productions).focus();
    opener = null;
  }
  function open(name, { fromBack = false } = {}) {
    if (current === name) { close(); return; }
    if (!current) opener = doc.activeElement?.closest?.('button') || toggles[name];
    if (name === 'channels') {
      previous = current === 'productions' ? 'productions' : null;
      onOpenChannels();
    } else if (!fromBack) previous = null;
    current = name;
    paint();
    (focusables()[0] || drawers[name]).focus();
  }
  function suspend() {
    if (!current) return () => {};
    const active = current, priorFocus = doc.activeElement;
    suspended = true; paint();
    return () => {
      if (current !== active) return;
      suspended = false; paint();
      if (drawers[active].contains(priorFocus) && priorFocus.isConnected) priorFocus.focus();
      else (focusables()[0] || drawers[active]).focus();
    };
  }
  toggles.channels.addEventListener('click', () => open('channels'));
  toggles.productions.addEventListener('click', () => open('productions'));
  doc.querySelector('#channelsBack').addEventListener('click', () => open('productions', { fromBack: true }));
  backdrop.addEventListener('click', () => close());
  for (const button of doc.querySelectorAll('[data-drawer-close]')) button.addEventListener('click', () => close());
  doc.addEventListener('keydown', (event) => {
    if (!current || suspended) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!onEscape()) close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && (doc.activeElement === first || !drawers[current].contains(doc.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (doc.activeElement === last || !drawers[current].contains(doc.activeElement))) {
      event.preventDefault(); first.focus();
    }
  });
  paint();
  return { open, close, suspend, current: () => current };
}
