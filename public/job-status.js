export async function refreshJobStatus(api, getCurrentState) {
  const incoming = await api("/api/state");
  return { ...getCurrentState(), jobs: incoming.jobs };
}
