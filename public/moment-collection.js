import { momentRequest, momentUrl, mountMomentEditor } from './moment-editor.js';

export function installMomentCollection(dialog, opener) {
  const $ = selector => dialog.querySelector(selector);
  const search = $('[data-search]'), results = $('[data-results]'), more = $('[data-more]');
  const detail = $('[data-detail]'), browse = $('[data-browse]'), status = $('[data-status]');
  const player = $('[data-player]');
  let generation = 0, nextOffset = null, query;
  function clearDetail() {
    player.querySelector('video')?.pause();
    player.replaceChildren();
    $('[data-editor]').replaceChildren();
    detail.hidden = true;
    browse.hidden = false;
  }
  function row(summary) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.id = summary.id;
    for (const [tag, text] of [['strong', summary.sourceLabel],
      ['span', summary.channelName + ' / ' + summary.episodeTitle],
      ['span', summary.startSeconds + '–' + summary.endSeconds + ' s'], ['span', summary.noteExcerpt]]) {
      if (!text) continue;
      const line = document.createElement(tag);
      line.textContent = text;
      button.append(line);
    }
    button.onclick = () => openDetail(summary);
    return button;
  }
  async function list(offset = 0) {
    const turn = ++generation;
    clearDetail();
    if (!offset) {
      results.replaceChildren();
      query = new URLSearchParams({ channel: search.elements.channel.value, q: search.elements.query.value.trim() });
    }
    more.hidden = true;
    status.textContent = 'Loading moments…';
    try {
      const page = await momentRequest('/api/moments?' + query + '&offset=' + offset);
      if (generation !== turn) return;
      results.append(...page.moments.map(row));
      nextOffset = page.nextOffset;
      more.hidden = nextOffset === null;
      status.textContent = results.childElementCount ? '' : 'No saved moments found.';
    } catch (error) {
      if (generation === turn) { status.textContent = error.message; more.hidden = !offset; }
    }
  }
  async function openDetail(summary) {
    const turn = ++generation;
    status.textContent = 'Opening moment…';
    try {
      const saved = await momentRequest(momentUrl(summary));
      if (generation !== turn) return;
      browse.hidden = true;
      detail.hidden = false;
      $('h3').textContent = saved.sourceLabel;
      $('[data-origin]').textContent = summary.channelName + ' / ' + summary.episodeTitle;
      let video;
      if (saved.available) {
        video = document.createElement('video');
        video.controls = true;
        video.onloadedmetadata = () => { video.currentTime = saved.startSeconds; };
        video.onerror = () => {
          if (generation !== turn) return;
          status.textContent = 'Playback unavailable.';
          for (const button of detail.querySelectorAll('[data-mark], [data-replay]')) button.disabled = true;
        };
        video.src = saved.mediaUrl;
        player.replaceChildren(video);
      }
      status.textContent = saved.available ? '' : 'Source unavailable. The saved range and note are still editable.';
      mountMomentEditor($('[data-editor]'), { video, saved, duration: saved.duration, onChange(result) {
        if (generation === turn && result.removed) void list();
      } });
      $('[data-back]').focus();
    } catch (error) { if (generation === turn) status.textContent = error.message; }
  }
  search.onsubmit = event => { event.preventDefault(); void list(); };
  more.onclick = () => list(nextOffset);
  $('[data-back]').onclick = () => list();
  $('[data-close]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { ++generation; clearDetail(); });
  opener.onclick = async () => {
    const turn = ++generation;
    search.reset();
    results.replaceChildren();
    search.elements.channel.length = 1;
    more.hidden = true;
    status.textContent = 'Loading channels…';
    dialog.showModal();
    try {
      const { channels } = await momentRequest('/api/channels');
      if (generation !== turn) return;
      for (const channel of channels) search.elements.channel.add(new Option(channel.name, channel.id));
      status.textContent = '';
    } catch (error) { if (generation === turn) status.textContent = error.message; }
  };
}
