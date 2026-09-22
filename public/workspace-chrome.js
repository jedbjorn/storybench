export function installWorkspaceChrome(doc = document) {
  const page = doc.querySelector('#episodesPage'), toggle = doc.querySelector('#episodeRailToggle');
  const key = 'storybench.episodesCollapsed';
  let collapsed = doc.defaultView.matchMedia?.('(max-width: 700px)').matches ?? false;
  try { const saved = doc.defaultView.localStorage.getItem(key); if (saved !== null) collapsed = saved === 'true'; } catch { /* Storage may be disabled. */ }
  const paint = () => {
    page.classList.toggle('episodes-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Expand Episodes' : 'Collapse Episodes');
    toggle.title = collapsed ? 'Expand Episodes' : 'Collapse Episodes';
    toggle.textContent = collapsed ? '›' : '‹';
  };
  toggle.addEventListener('click', () => {
    collapsed = !collapsed; paint();
    try { doc.defaultView.localStorage.setItem(key, String(collapsed)); } catch { /* Preference is optional. */ }
  });
  paint();
}
