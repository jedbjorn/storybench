// Synthetic artwork and deck input shared by the deck motion tests.
// `track` and `frame` hold stroked geometry; `dot`, `plain` and `spare` do not.
export const motionSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><style>.line{fill:none;stroke:#294b60;stroke-width:4}</style>
<rect width="400" height="200" fill="#ffffff"/>
<g id="track"><path class="line" d="M20 100H380"/></g>
<g id="dot"><circle cx="20" cy="100" r="10" fill="#c0392b"/></g>
<g id="frame"><rect x="40" y="20" width="60" height="40" fill="#eeeeee" stroke="#111111" stroke-width="2"/></g>
<g id="plain" stroke="#111111"><rect x="300" y="150" width="10" height="10" style="stroke:none"/></g>
<g id="spare"><circle cx="300" cy="50" r="5"/></g></svg>`);

// Builder input for one vector slide with the given stages, plus a closing slide to navigate to.
export const motionDeck = (stages, extra = []) => ({ title: 'Motion', slides: [
  { id: 'moving', title: 'Moving', layout: 'full-media', vector: { type: 'image', src: 'assets/art.svg', alt: 'A track and a dot' }, stages },
  ...extra, { id: 'end', title: 'End', layout: 'statement' }] });
export const motionAssets = { 'assets/art.svg': motionSvg };
