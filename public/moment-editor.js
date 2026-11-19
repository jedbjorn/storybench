// Mutations always target the selected bookmark's origin, including from another brief.
export function momentUrl({ channelId, episodeId, id }) {
  const collection = '/api/episodes/' + encodeURIComponent(episodeId) + '/moments';
  return collection + (id ? '/' + encodeURIComponent(id) : '') + '?channel=' + encodeURIComponent(channelId);
}

export async function momentRequest(url, method = 'GET', body) {
  const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Could not load moment'), { current: data.current });
  return data;
}

// The native controls still allow scrubbing the whole video to choose new marks.
function rangePlayback(video) {
  let end = null, timer;
  function stop() {
    clearTimeout(timer);
    end = null;
  }
  function check() {
    clearTimeout(timer);
    if (end === null || video.paused || video.seeking) return;
    const remaining = end - video.currentTime;
    if (remaining <= 0) {
      const boundary = end;
      stop();
      video.pause();
      video.currentTime = boundary;
    } else {
      timer = setTimeout(check, Math.max(12, remaining * 1000 / video.playbackRate));
    }
  }
  for (const event of ['playing', 'seeked', 'timeupdate', 'ratechange']) video.addEventListener(event, check);
  video.addEventListener('pause', stop);
  return async (start, boundary) => {
    video.currentTime = start;
    end = boundary;
    await video.play();
    check();
  };
}

export function mountMomentEditor(host, { video, origin, source, saved, duration, onChange }) {
  host.innerHTML = `<form class="moment-editor"><fieldset>
    <div class="moment-range">
      <label>In (seconds)<input name="start" type="number" step="any" min="0" required></label>
      <button type="button" data-mark="start">Mark in</button>
      <label>Out (seconds)<input name="end" type="number" step="any" min="0" required></label>
      <button type="button" data-mark="end">Mark out</button>
      <button type="button" data-replay>Replay range</button>
    </div>
    <label>Creator note (optional)<textarea name="note" rows="2"></textarea></label>
    <div class="moment-actions"><button type="submit"></button><button type="button" data-remove>Remove moment</button></div>
    </fieldset><p role="status"></p></form>`;
  const form = host.querySelector('form');
  const { start, end, note } = form.elements;
  const status = form.querySelector('[role=status]');
  const submit = form.querySelector('[type=submit]');
  const remove = form.querySelector('[data-remove]');
  const replay = form.querySelector('[data-replay]');
  const play = video && rangePlayback(video);
  start.max = end.max = duration;
  start.value = saved?.startSeconds ?? 0;
  end.value = saved?.endSeconds ?? duration;
  note.value = saved?.note ?? '';
  submit.textContent = saved ? 'Save changes' : 'Save moment';
  remove.hidden = !saved;
  function enableMedia(available) {
    if (video && !available) { video.pause(); video.hidden = true; }
    for (const control of form.querySelectorAll('[data-mark], [data-replay]')) control.disabled = !available;
  }
  enableMedia(!!video);
  for (const mark of form.querySelectorAll('[data-mark]')) mark.onclick = () => {
    form.elements[mark.dataset.mark].value = Math.min(duration, video.currentTime);
    form.dispatchEvent(new Event('input'));
  };
  function validRange() {
    end.setCustomValidity(end.valueAsNumber <= start.valueAsNumber ? 'Set the out point after the in point.' : '');
    return form.reportValidity();
  }
  form.oninput = () => { end.setCustomValidity(''); submit.disabled = false; status.textContent = ''; };
  replay.onclick = async () => {
    if (!validRange()) return;
    try { await play(start.valueAsNumber, end.valueAsNumber); }
    catch { status.textContent = 'Could not play this range.'; }
  };
  let pending, revision = saved?.revision;
  async function write(deleting) {
    const fields = { startSeconds: start.valueAsNumber, endSeconds: end.valueAsNumber, note: note.value };
    let body = deleting ? { expectedRevision: revision } : { ...fields, expectedRevision: revision };
    if (!saved) {
      // Retain the request ID across ambiguous responses with the same submitted values.
      const fingerprint = JSON.stringify(fields);
      if (pending?.fingerprint !== fingerprint) pending = { fingerprint, id: crypto.getRandomValues(new Uint32Array(4)).join('-') };
      body = { ...fields, source, requestId: pending.id };
    }
    const group = form.querySelector('fieldset');
    group.disabled = true;
    try {
      const result = await momentRequest(momentUrl(saved || origin), deleting ? 'DELETE' : saved ? 'PUT' : 'POST', body);
      revision = result.revision;
      submit.disabled = true;
      status.textContent = saved ? 'Changes saved.' : 'Moment saved.';
      if (!deleting && !result.available) {
        enableMedia(false);
        status.textContent += ' Source unavailable.';
      }
      onChange?.(result);
    } catch (error) {
      if (error.current) {
        const current = error.current;
        revision = current.revision;
        if (!current.available) enableMedia(false);
        status.textContent = `This moment changed. Latest saved range: ${current.startSeconds}–${current.endSeconds} s. Latest note: ${current.note || '(empty)'}. Your edits are still here. Review them and retry.${current.available ? '' : ' Source unavailable.'}`;
      } else status.textContent = error.message;
    } finally { group.disabled = false; }
  }
  form.onsubmit = event => { event.preventDefault(); if (validRange() && !submit.disabled) void write(false); };
  remove.onclick = () => { if (window.confirm('Remove this saved moment?')) void write(true); };
}
