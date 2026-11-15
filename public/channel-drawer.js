export function installChannelDrawer({ api, currentChannel, canLeave, navigateChannel, afterDelete, afterRename, esc }) {
  const $ = (selector) => document.querySelector(selector);
  let channels = [], selected = new Set(), mode = 'browse', nameTarget = null, preview = null, pending = null, busy = false;
  const setError = (selector, error) => { $(selector).textContent = error?.message || String(error); };
  function paint() {
    $('#channelBrowseActions').hidden = mode !== 'browse';
    $('#channelSelectionActions').hidden = mode !== 'select';
    $('#channelNameForm').hidden = mode !== 'name';
    $('#channelDeleteConfirm').hidden = mode !== 'confirm';
    $('#channelDeletePending').hidden = !pending;
    $('#channelSelectionCount').textContent = `${selected.size} selected`;
    $('#renameChannel').disabled = selected.size !== 1 || busy;
    $('#deleteChannels').disabled = !selected.size || busy;
    $('#channelCards').hidden = mode === 'confirm';
    $('#channelCards').innerHTML = channels.map((channel) => {
      const current = channel.id === currentChannel(), checked = selected.has(channel.id);
      return `<button type="button" class="channel-card ${current ? 'current' : ''} ${checked ? 'selected' : ''}" data-channel-id="${esc(channel.id)}" aria-label="${mode === 'select' ? 'Select' : 'Open'} ${esc(channel.name)}" ${mode === 'select' ? `aria-pressed="${checked}"` : ''}>${mode === 'select' ? `<input type="checkbox" tabindex="-1" ${checked ? 'checked' : ''} aria-hidden="true">` : ''}<span><strong>${esc(channel.name)}</strong><small>${current ? 'Current channel' : channel.isDefault ? 'Default channel' : 'Channel'}</small></span></button>`;
    }).join('') || '<p>No channels yet. Create one to start.</p>';
  }
  async function refresh() {
    $('#channelCards').textContent = 'Loading channels…';
    channels = (await api('/api/channels')).channels;
    selected = new Set([...selected].filter((id) => channels.some((channel) => channel.id === id)));
    const operations = await api('/api/channel-deletions');
    pending = operations[0] || null;
    if (pending) showPending();
    paint();
  }
  function reset() { mode = 'browse'; selected.clear(); preview = null; nameTarget = null; $('#channelActionError').textContent = ''; paint(); }
  function showPending() {
    if (!pending) return;
    $('#channelDeletePendingMessage').textContent = pending.error ? `Deletion is pending: ${pending.error}` : 'Deletion is in progress. Retry if it does not finish.';
  }
  function cancelTransient() {
    if (mode === 'name') { mode = nameTarget ? 'select' : 'browse'; paint(); return true; }
    if (mode === 'confirm') { mode = 'select'; preview = null; paint(); return true; }
    return false;
  }
  $('#channelCards').addEventListener('click', async (event) => {
    const id = event.target.closest('[data-channel-id]')?.dataset.channelId;
    if (!id || busy) return;
    if (mode === 'select') {
      selected.has(id) ? selected.delete(id) : selected.add(id);
      paint();
      $('#channelCards').querySelector(`[data-channel-id="${CSS.escape(id)}"]`)?.focus();
      return;
    }
    try { busy = true; await navigateChannel(id); }
    catch (error) { setError('#channelActionError', error); }
    finally { busy = false; }
  });
  $('#selectChannels').onclick = () => { mode = 'select'; selected.clear(); paint(); };
  $('#doneChannels').onclick = reset;
  $('#newChannel').onclick = () => {
    nameTarget = null; mode = 'name'; $('#channelNamePrompt').textContent = 'New channel name';
    $('#channelNameInput').value = ''; $('#channelNameError').textContent = ''; paint(); $('#channelNameInput').focus();
  };
  $('#renameChannel').onclick = () => {
    if (selected.size !== 1) return;
    nameTarget = channels.find((channel) => channel.id === [...selected][0]);
    if (!nameTarget) return;
    mode = 'name'; $('#channelNamePrompt').textContent = 'Rename channel';
    $('#channelNameInput').value = nameTarget.name; $('#channelNameError').textContent = ''; paint(); $('#channelNameInput').focus();
  };
  $('#cancelChannelName').onclick = cancelTransient;
  $('#channelNameForm').onsubmit = async (event) => {
    event.preventDefault(); if (busy) return;
    const name = $('#channelNameInput').value;
    busy = true;
    try {
      if (nameTarget) {
        const updated = await api(`/api/channels/${nameTarget.id}`, { method: 'PUT', body: JSON.stringify({ name, expectedRevision: nameTarget.revision }) });
        await refresh(); afterRename(updated); mode = 'select';
      } else {
        if (!(await canLeave())) return;
        const created = await api('/api/channels', { method: 'POST', body: JSON.stringify({ name }) });
        await navigateChannel(created.id, { prepared: true });
        await refresh(); mode = 'browse';
      }
      $('#channelNameError').textContent = ''; paint();
    } catch (error) { setError('#channelNameError', error); }
    finally { busy = false; }
  };
  $('#deleteChannels').onclick = async () => {
    if (!selected.size || busy) return;
    busy = true;
    try {
      const ids = [...selected];
      if (ids.includes(currentChannel()) && !(await canLeave())) return;
      preview = await api('/api/channel-deletions/preview', { method: 'POST', body: JSON.stringify({ channelIds: ids }) });
      $('#channelDeleteSummary').textContent = `${preview.channels.length} channel${preview.channels.length === 1 ? '' : 's'}, ${preview.productionCount} production${preview.productionCount === 1 ? '' : 's'}. ${preview.fallbackChannelId ? `Next channel: ${channels.find((item) => item.id === preview.fallbackChannelId)?.name || 'another channel'}.` : 'No channels will remain.'}`;
      $('#channelDeleteNames').innerHTML = preview.channels.map((channel) => `<div>${esc(channel.name)}${channel.id === currentChannel() ? ' · current' : ''}${channel.id === preview.currentDefaultId ? ' · default' : ''}</div>`).join('');
      $('#confirmChannelDelete').textContent = `Delete ${preview.channels.length} channel${preview.channels.length === 1 ? '' : 's'}`;
      $('#channelDeleteError').textContent = ''; mode = 'confirm'; paint(); $('#cancelChannelDelete').focus();
    } catch (error) { setError('#channelActionError', error); }
    finally { busy = false; }
  };
  $('#cancelChannelDelete').onclick = cancelTransient;
  $('#confirmChannelDelete').onclick = async () => {
    if (!preview || busy) return;
    busy = true; $('#confirmChannelDelete').disabled = true;
    const operationId = `delete_${crypto.randomUUID()}`;
    try {
      const result = await api('/api/channel-deletions', { method: 'POST', body: JSON.stringify({ channelIds: preview.channelIds, token: preview.token, operationId }) });
      if (result.state === 'completed') {
        await afterDelete(result); selected.clear(); preview = null; mode = 'browse'; await refresh();
      } else { pending = result; await afterDelete(result); mode = 'browse'; await refresh(); }
    } catch (error) {
      const known = await api(`/api/channel-deletions/${operationId}`).catch(() => null);
      if (known) {
        if (known.state === 'completed') { await afterDelete(known); selected.clear(); preview = null; mode = 'browse'; await refresh(); }
        else { pending = known; await afterDelete(known); mode = 'browse'; await refresh(); }
      } else {
        setError('#channelDeleteError', error);
        if (error.status === 409) { preview = null; mode = 'select'; await refresh(); setError('#channelActionError', error); }
      }
    }
    finally { busy = false; $('#confirmChannelDelete').disabled = false; }
  };
  $('#retryChannelDelete').onclick = async () => {
    if (!pending || busy) return;
    busy = true; $('#retryChannelDelete').disabled = true;
    try {
      const result = await api(`/api/channel-deletions/${pending.id}/retry`, { method: 'POST', body: '{}' });
      if (result.state === 'completed') {
        await afterDelete(result); pending = null; selected.clear(); mode = 'browse'; await refresh();
      } else { pending = result; showPending(); }
    } catch (error) { setError('#channelDeletePendingMessage', error); }
    finally { busy = false; $('#retryChannelDelete').disabled = false; }
  };
  paint();
  return { refresh, reset, cancelTransient, currentMode: () => mode };
}
