const normalize = (text) => String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
const words = (text) => normalize(text).match(/[\p{L}\p{N}]+/gu) || [];

// Adjacent transpositions count as one typo, alongside insertions, deletions and substitutions.
function distance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  }
  return rows[a.length][b.length];
}

export function searchProductions(productions, query) {
  const terms = words(query);
  if (!terms.length) return productions;
  return productions.map((production) => {
    const title = normalize(production.title), text = `${title} ${normalize(production.channelName)} ${normalize(production.stage)}`;
    const candidates = words(text);
    let score = 0;
    for (const term of terms) {
      if (title.includes(term)) continue;
      if (text.includes(term)) { score += 1; continue; }
      const allowance = term.length < 3 ? 0 : Math.min(2, Math.floor(term.length / 4) || 1);
      const nearest = Math.min(...candidates.filter((word) => Math.abs(word.length - term.length) <= allowance).map((word) => distance(term, word)));
      if (nearest > allowance) return null;
      score += 2 + nearest;
    }
    return { production, score };
  }).filter(Boolean).sort((a, b) => a.score - b.score || b.production.updatedAt.localeCompare(a.production.updatedAt))
    .map(({ production }) => production);
}

export function installProductionSearch({ api, esc, navigate, onOpen }) {
  const root = document.querySelector('#productionSearch'), input = root.querySelector('input');
  const toggle = root.querySelector('button'), dropdown = root.querySelector('.search-dropdown');
  const list = root.querySelector('[role=listbox]'), status = root.querySelector('[role=status]');
  let productions = [], matches = [], active = -1, open = false, loading = false, error = '', generation = 0;
  const dateFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  function position() {
    const rect = toggle.getBoundingClientRect();
    root.style.setProperty('--search-field-width', `${Math.max(0, Math.min(240, rect.left - 18))}px`);
    dropdown.style.right = `${Math.max(14, Math.min(innerWidth - rect.right, innerWidth - Math.min(560, innerWidth - 28) - 14))}px`;
    dropdown.style.top = `${rect.bottom + 8}px`;
    dropdown.style.maxHeight = `${Math.max(100, innerHeight - rect.bottom - 22)}px`;
  }
  function select(index) {
    active = index;
    list.querySelectorAll('[role=option]').forEach((option, i) => option.setAttribute('aria-selected', String(i === index)));
    if (index < 0) { input.removeAttribute('aria-activedescendant'); return; }
    input.setAttribute('aria-activedescendant', `production-search-${index}`);
    list.children[index]?.scrollIntoView({ block: 'nearest' });
  }
  function paint() {
    if (!open) return;
    matches = loading || error ? [] : searchProductions(productions, input.value);
    list.innerHTML = matches.map((production, index) => {
      const date = new Date(production.updatedAt);
      return `<div role="option" id="production-search-${index}" aria-selected="false" data-search-index="${index}" aria-label="${esc(`${production.channelName}: ${production.title} — ${production.stage}`)}"><strong title="${esc(production.title)}">${esc(production.title)}</strong><div class="search-result-meta"><span>${esc(production.channelName)} | ${esc(production.stage)}</span><time datetime="${esc(production.updatedAt)}" title="Last edited">${Number.isNaN(date.getTime()) ? '' : esc(dateFormat.format(date))}</time></div></div>`;
    }).join('');
    status.textContent = loading ? 'Loading productions…' : error || (matches.length ? `${matches.length} production${matches.length === 1 ? '' : 's'}` : 'No matching productions');
    // Announce counts without taking a ninth row in the results window.
    status.classList.toggle('search-count', matches.length > 0);
    dropdown.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    select(-1); list.scrollTop = 0; position();
  }
  function close({ focus = false } = {}) {
    open = false; generation++;
    root.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
    input.inert = true; input.tabIndex = -1; dropdown.hidden = true;
    if (focus) toggle.focus();
  }
  async function expand() {
    onOpen();
    open = true; loading = true; error = ''; productions = []; input.value = '';
    const request = ++generation;
    root.classList.add('open'); toggle.setAttribute('aria-expanded', 'true');
    input.inert = false; input.tabIndex = 0; input.focus(); paint();
    try { const data = await api('/api/production-search'); if (request === generation) productions = data; }
    catch (cause) { if (request === generation) error = `Search unavailable: ${cause.message}`; }
    finally { if (request === generation) { loading = false; paint(); } }
  }
  async function activate(index) {
    const production = matches[index];
    if (!production) return;
    const target = new URL('/episodes', location.href);
    target.searchParams.set('channel', production.channelId); target.searchParams.set('episode', production.id);
    close();
    if (await navigate(target.href)) document.querySelector('#episodeTitle').focus();
    else toggle.focus();
  }
  toggle.addEventListener('click', () => open ? close({ focus: true }) : expand());
  input.addEventListener('input', paint);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close({ focus: true }); return; }
    if (event.key === 'Enter') { event.preventDefault(); activate(active < 0 ? 0 : active); return; }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key) || !matches.length) return;
    event.preventDefault();
    select((active + (event.key === 'ArrowDown' ? 1 : active < 0 ? 0 : -1) + matches.length) % matches.length);
  });
  list.addEventListener('pointerdown', (event) => { if (event.target.closest('[role=option]')) event.preventDefault(); });
  list.addEventListener('click', (event) => {
    const option = event.target.closest('[data-search-index]');
    if (option) activate(Number(option.dataset.searchIndex));
  });
  document.addEventListener('pointerdown', (event) => { if (open && !root.contains(event.target)) close(); });
  root.addEventListener('focusout', (event) => { if (open && !root.contains(event.relatedTarget)) close(); });
  window.addEventListener('resize', position);
}
