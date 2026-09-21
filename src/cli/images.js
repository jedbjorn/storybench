// Conservative exact-image cleanup shared by release retention and uninstall.
// An image is removed only when no retained manifest and no Docker container refers to it.
export async function installationLabeledImages(run, installId, env) {
  if (!installId) return new Set();
  const result = await run("docker", ["image", "ls", "--no-trunc", "--quiet", "--filter", `label=io.storybench.install=${installId}`], { timeoutMs: 30_000, env });
  return result.code === 0 ? new Set(result.stdout.trim().split("\n").filter(Boolean)) : new Set();
}

async function imageInstallLabel(run, image, env) {
  const result = await run("docker", ["image", "inspect", image, "--format", "{{index .Config.Labels \"io.storybench.install\"}}"], { timeoutMs: 30_000, env });
  const value = result.code === 0 ? result.stdout.trim() : null;
  return value === "<no value>" ? "" : value;
}

export async function removeImagesIfUnused(run, candidates, { retained = new Set(), installId = null, env } = {}) {
  let removed = 0;
  for (const image of new Set(candidates)) {
    if (!image || retained.has(image)) continue;
    const used = await run("docker", ["ps", "-a", "--no-trunc", "--filter", `ancestor=${image}`, "--format", "{{.ID}}"], { timeoutMs: 30_000, env });
    if (used.code !== 0 || used.stdout.trim()) continue;
    const label = await imageInstallLabel(run, image, env);
    if (label === null) continue;
    // Unlabeled pre-ownership images may be shared by another installation. Only an
    // exact ownership label authorizes removal.
    if (!label || !installId || label !== installId) continue;
    const result = await run("docker", ["image", "rm", image], { timeoutMs: 120_000, env });
    if (result.code === 0) removed++;
  }
  return removed;
}
