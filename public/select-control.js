// Shared select/combobox chrome. The original field still owns form values and events.
export function installSelectControls(doc = document) {
  const win = doc.defaultView, controls = new Map();
  let current = null, nextId = 0;
  const set = (node, name, value) => { if (node.getAttribute(name) !== String(value)) node.setAttribute(name, value); };
  const close = () => {
    if (!current) return;
    current.menu.remove();
    current.trigger.setAttribute('aria-expanded', 'false');
    current.trigger.removeAttribute('aria-activedescendant');
    current = null;
  };
  function enhance(field) {
    const editable = field.tagName === 'INPUT';
    const listId = field.getAttribute('list');
    const wrapper = doc.createElement('span'); wrapper.className = 'sb-select';
    field.before(wrapper); wrapper.append(field);
    const trigger = editable ? field : doc.createElement('button');
    if (!editable) {
      trigger.type = 'button'; wrapper.append(trigger);
      field.classList.add('sb-select-native'); field.tabIndex = -1; field.setAttribute('aria-hidden', 'true');
    } else { field.removeAttribute('list'); field.dataset.selectList = listId; }
    trigger.classList.add('sb-select-trigger');
    const menu = doc.createElement('div'); menu.className = 'sb-select-menu'; menu.id = `sb-options-${++nextId}`;
    menu.setAttribute('role', 'listbox');
    trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-controls', menu.id); trigger.setAttribute('aria-expanded', 'false');
    if (editable) trigger.setAttribute('aria-autocomplete', 'list');
    const control = { field, wrapper, trigger, menu, editable, active: -1, options: [] };
    controls.set(field, control);
    function sync() {
      const disabled = field.matches(':disabled');
      if (!editable) {
        trigger.disabled = disabled;
        const label = field.selectedOptions[0]?.label || 'Choose…';
        if (trigger.textContent !== label) trigger.textContent = label;
      }
      const labelledBy = field.getAttribute('aria-labelledby');
      const label = field.getAttribute('aria-label') || [...(field.labels || [])].map((item) => [...item.childNodes]
        .filter((node) => node !== wrapper && node !== field && node.nodeName !== 'SELECT')
        .map((node) => node.textContent).join(' ').trim()).filter(Boolean).join(' ')
        || field.getAttribute('title') || field.dataset.key || field.name || 'Choose';
      if (labelledBy) set(trigger, 'aria-labelledby', labelledBy);
      else set(trigger, 'aria-label', label);
      if (current === control && (disabled || field.closest('[hidden], dialog:not([open])'))) close();
    }
    function position() {
      const box = trigger.getBoundingClientRect(), gap = 5, margin = 8;
      const width = Math.min(Math.max(box.width, 180), win.innerWidth - margin * 2);
      const below = win.innerHeight - box.bottom - gap - margin, above = box.top - gap - margin;
      const upward = below < 180 && above > below;
      menu.style.width = `${width}px`;
      menu.style.left = `${Math.max(margin, Math.min(box.left, win.innerWidth - width - margin))}px`;
      menu.style.maxHeight = `${Math.max(60, Math.min(300, upward ? above : below))}px`;
      menu.style.top = upward ? 'auto' : `${box.bottom + gap}px`;
      menu.style.bottom = upward ? `${win.innerHeight - box.top + gap}px` : 'auto';
    }
    function activate(index) {
      control.active = index;
      [...menu.children].forEach((node, i) => node.classList.toggle('active', i === index));
      const node = menu.children[index];
      if (node) { trigger.setAttribute('aria-activedescendant', node.id); node.scrollIntoView?.({ block: 'nearest' }); }
      else trigger.removeAttribute('aria-activedescendant');
    }
    function paint() {
      const options = editable ? doc.getElementById(listId)?.options ?? [] : field.options;
      const query = editable ? field.value.toLowerCase() : '';
      control.options = [...options].filter((option) => !option.hidden && (!editable || `${option.label} ${option.value}`.toLowerCase().includes(query)));
      menu.replaceChildren(...control.options.map((option, i) => {
        const node = doc.createElement('div'); node.id = `${menu.id}-${i}`; node.setAttribute('role', 'option');
        node.setAttribute('aria-selected', String(option.value === field.value));
        node.setAttribute('aria-disabled', String(option.disabled || option.parentElement?.disabled || false));
        node.textContent = editable ? `${option.label}${option.label !== option.value ? ` · ${option.value}` : ''}` : option.label;
        node.dataset.index = i; return node;
      }));
      if (!control.options.length) { const empty = doc.createElement('div'); empty.className = 'sb-select-empty'; empty.textContent = editable ? 'Use the model ID you entered' : 'No options'; menu.append(empty); }
      position();
      activate(control.options.findIndex((option) => option.value === field.value && !option.disabled && !option.parentElement?.disabled));
    }
    function open() {
      if (field.matches(':disabled')) return;
      if (current !== control) { close(); current = control; (field.closest('dialog') || doc.body).append(menu); trigger.setAttribute('aria-expanded', 'true'); }
      paint();
    }
    function choose(index) {
      const option = control.options[index];
      if (!option) { if (editable) close(); return; }
      if (option.disabled || option.parentElement?.disabled) return;
      field.value = option.value; close(); sync(); trigger.focus();
      field.dispatchEvent(new win.Event('input', { bubbles: true }));
      field.dispatchEvent(new win.Event('change', { bubbles: true }));
      close();
    }
    trigger.addEventListener('click', () => current === control && !editable ? close() : open());
    field.addEventListener('change', sync);
    if (!editable) {
      field.addEventListener('focus', () => trigger.focus());
      field.addEventListener('click', (event) => { event.preventDefault(); trigger.focus(); open(); });
    }
    field.addEventListener('invalid', (event) => { if (!editable) { event.preventDefault(); trigger.focus(); open(); } });
    if (editable) field.addEventListener('input', open);
    menu.addEventListener('pointerdown', (event) => event.preventDefault());
    menu.addEventListener('click', (event) => {
      const node = event.target.closest('[data-index]'); if (node) choose(Number(node.dataset.index));
    });
    let typed = '', typedAt = 0;
    trigger.addEventListener('keydown', (event) => {
      const key = event.key;
      if (key === 'Tab') return close();
      if (key === 'Escape' && current === control) { event.preventDefault(); event.stopPropagation(); return close(); }
      if ((key === 'Enter' || (!editable && key === ' ')) && current === control) { event.preventDefault(); return choose(control.active); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key) && (!editable || current === control || key.startsWith('Arrow'))) {
        event.preventDefault(); if (current !== control) open();
        const available = control.options.map((option, i) => !option.disabled && !option.parentElement?.disabled ? i : -1).filter((i) => i >= 0);
        let index = available.indexOf(control.active);
        if (key === 'Home') index = 0;
        else if (key === 'End') index = available.length - 1;
        else index = (index + (key === 'ArrowDown' ? 1 : -1) + available.length) % available.length;
        activate(available[index] ?? -1); return;
      }
      if (editable || key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault(); if (current !== control) open();
      typed = Date.now() - typedAt > 700 ? key : typed + key; typedAt = Date.now();
      const index = control.options.findIndex((option) => !option.disabled && !option.parentElement?.disabled && option.label.toLowerCase().startsWith(typed.toLowerCase()));
      if (index >= 0) activate(index);
    });
    control.sync = sync; control.paint = paint; control.position = position; sync();
  }
  function refresh() {
    for (const [field, control] of controls) {
      if (!field.isConnected) { if (current === control) close(); controls.delete(field); }
      else control.sync();
    }
    doc.querySelectorAll('select:not([multiple]):not([size]), input[list]').forEach((field) => { if (!controls.has(field)) enhance(field); });
  }
  const observer = new win.MutationObserver((records) => {
    // Ignore our rendered chrome; observe native options, forms, and dynamically mounted UI.
    if (!records.some((record) => !record.target.closest?.('.sb-select-menu, .sb-select-trigger'))) return;
    refresh();
    if (current && records.some((record) => current.field.contains(record.target) || record.target.closest?.('datalist'))) current.paint();
  });
  refresh(); observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'selected', 'label', 'hidden', 'value', 'open'] });
  const outside = (event) => { if (current && !current.wrapper.contains(event.target) && !current.menu.contains(event.target)) close(); };
  const reposition = () => current?.position();
  doc.addEventListener('pointerdown', outside); doc.addEventListener('focusin', outside);
  doc.addEventListener('scroll', reposition, true); win.addEventListener('resize', reposition);
  doc.addEventListener('reset', () => win.setTimeout(refresh, 0));
  return { refresh, close, destroy() { close(); observer.disconnect(); doc.removeEventListener('pointerdown', outside); doc.removeEventListener('focusin', outside); doc.removeEventListener('scroll', reposition, true); win.removeEventListener('resize', reposition); } };
}
