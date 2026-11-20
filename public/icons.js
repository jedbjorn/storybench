// Line icons for icon buttons, drawn in the header search icon's style. Each button carrying one still
// names its action with aria-label and title.
const svg = (paths) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const icons = {
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  edit: svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4"/>'),
  grip: svg('<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>'),
  left: svg('<path d="M15 6l-6 6 6 6"/>'),
  play: svg('<path d="M8 5.5v13l10.5-6.5z"/>'),
  preview: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="m3 3 18 18M10.6 5.1 12 5c6.4 0 10 7 10 7a21 21 0 0 1-3.1 3.9M6.2 6.2A22 22 0 0 0 2 12s3.6 7 10 7c1.8 0 3.5-.6 5-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  right: svg('<path d="M9 6l6 6-6 6"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
};
