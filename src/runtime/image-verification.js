// Host-side invocation of the check shipped in each exact app/worker image.
export const IMAGE_CHECK = "/opt/storybench/app/src/runtime/image-check.js";
export const REQUIRED_TOOLS = Object.freeze({
  app: ["node", "ffmpeg", "ffprobe", "python", "pillow", "resvg", "pdftotext", "pdfinfo", "pdftoppm", "fontdejaVu", "fontnoto", "fontliberation", "pkgFfmpeg", "pkgPoppler", "pkgPillow", "pkgResvg", "pkgFontDejaVu", "pkgFontNoto", "pkgFontLiberation"],
  worker: ["node", "ffmpeg", "ffprobe", "python", "pillow", "resvg", "pdftotext", "pdfinfo", "pdftoppm", "fontdejaVu", "fontnoto", "fontliberation", "pkgFfmpeg", "pkgPoppler", "pkgPillow", "pkgResvg", "pkgFontDejaVu", "pkgFontNoto", "pkgFontLiberation", "codex", "claude", "git", "rg", "bash"],
});

export async function checkImage(run, image, role, operation = "probe", options = {}) {
  if (!REQUIRED_TOOLS[role] || !["probe", "smoke"].includes(operation)) throw new Error("Invalid image check");
  const args = ["run", "--rm", "--network", "none", image, "node", IMAGE_CHECK, operation, ...(operation === "probe" ? [role] : [])];
  const result = await run("docker", args, { ...options, timeoutMs: operation === "smoke" ? 120_000 : 30_000 });
  if (result.code !== 0) throw new Error(`${role} image ${operation} failed: ${String(result.stderr || "").trim().split("\n")[0] || `exit ${result.code}`}`);
  let evidence;
  try { evidence = JSON.parse(result.stdout.trim()); }
  catch { throw new Error(`${role} image ${operation} returned invalid evidence`); }
  const required = operation === "probe" ? REQUIRED_TOOLS[role] : ["pillowPng", "svgPng", "pdfPng", "aacAudio", "h264AacAnimation", "decodedPng"];
  for (const key of required) if (operation === "probe" ? typeof evidence[key] !== "string" || !evidence[key].trim() : evidence[key] !== true)
    throw new Error(`${role} image ${operation} is missing ${key} evidence`);
  if (operation === "probe" && !/^v(2[4-9]|[3-9]\d)\./.test(evidence.node)) throw new Error(`${role} image has an unsupported Node version`);
  if (operation === "probe" && role === "worker") for (const name of ["codex", "claude"])
    if (!/^\d+\.\d+\.\d+$/.test(evidence[name])) throw new Error(`${role} image has invalid ${name} version evidence`);
  return evidence;
}
