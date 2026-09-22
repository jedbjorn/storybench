// Runs inside an exact release image. A failed command names the tool or media step.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const first = (value) => String(value || "").trim().split("\n")[0];

export function runChecked(name, args, runner = spawnSync) {
  const result = runner(name, args, { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0)
    throw new Error(`${name}: ${first(result.stderr) || result.error?.message || `exit ${result.status}`}`);
  return first(result.stdout || result.stderr);
}

export function probeTools(role, runner = spawnSync) {
  if (!["app", "worker"].includes(role)) throw new Error(`invalid image role: ${role}`);
  const check = (name, args) => runChecked(name, args, runner);
  const tools = {
    node: check("node", ["--version"]),
    ffmpeg: check("ffmpeg", ["-version"]),
    ffprobe: check("ffprobe", ["-version"]),
    python: check("python3", ["--version"]),
    pillow: check("python3", ["-c", "import PIL; print(PIL.__version__)"]),
    resvg: check("resvg", ["--version"]),
    pdftotext: check("pdftotext", ["-v"]),
    pdfinfo: check("pdfinfo", ["-v"]),
    pdftoppm: check("pdftoppm", ["-v"]),
  };
  if (!/^v(2[4-9]|[3-9]\d)\./.test(tools.node)) throw new Error(`node: version ${tools.node} is below 24`);
  for (const [label, family] of Object.entries({ dejaVu: "DejaVu Sans", noto: "Noto Sans", liberation: "Liberation Sans" })) {
    const found = check("fc-match", ["-f", "%{family}", family]);
    if (!found.includes(family)) throw new Error(`font ${family}: resolved to ${found || "nothing"}`);
    tools[`font${label}`] = found;
  }
  for (const [label, pkg] of Object.entries({ ffmpeg: "ffmpeg", poppler: "poppler-utils", pillow: "python3-pil", resvg: "resvg", fontDejaVu: "fonts-dejavu-core", fontNoto: "fonts-noto-core", fontLiberation: "fonts-liberation2" }))
    tools[`pkg${label[0].toUpperCase()}${label.slice(1)}`] = check("dpkg-query", ["-W", "-f=${Version}", pkg]);
  if (role === "worker") {
    for (const [name, args] of Object.entries({ codex: ["--version"], claude: ["--version"], git: ["--version"], rg: ["--version"], bash: ["--version"] }))
      tools[name] = check(name, args);
    for (const name of ["codex", "claude"]) {
      const version = /\b\d+\.\d+\.\d+\b/.exec(tools[name])?.[0];
      if (!version) throw new Error(`${name}: invalid version output ${tools[name]}`);
      tools[name] = version;
    }
  }
  for (const [name, value] of Object.entries(tools)) if (!value) throw new Error(`${name}: empty version output`);
  return tools;
}

export function smokeMedia() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "storybench-image-smoke-"));
  const at = (name) => path.join(dir, name);
  const step = (label, name, args) => {
    try { return runChecked(name, args); }
    catch (error) { throw new Error(`${label}: ${error.message}`); }
  };
  try {
    step("Pillow still/PDF", "python3", ["-c", "from PIL import Image; import sys; image=Image.new('RGB',(64,48),'red'); image.save(sys.argv[1]); image.save(sys.argv[2])", at("still.png"), at("page.pdf")]);
    writeFileSync(at("vector.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="blue"/></svg>');
    step("SVG still", "resvg", [at("vector.svg"), at("vector.png")]);
    step("PDF metadata", "pdfinfo", [at("page.pdf")]);
    step("PDF raster", "pdftoppm", ["-f", "1", "-singlefile", "-png", at("page.pdf"), at("page")]);
    step("PDF text extraction", "pdftotext", [at("page.pdf"), at("page.txt")]);
    step("audio encode", "ffmpeg", ["-v", "error", "-nostdin", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac", at("tone.m4a")]);
    step("audio decode", "ffmpeg", ["-v", "error", "-nostdin", "-i", at("tone.m4a"), "-c:a", "pcm_s16le", at("tone.wav")]);
    step("animated video encode", "ffmpeg", ["-v", "error", "-nostdin", "-loop", "1", "-framerate", "12", "-i", at("still.png"), "-i", at("tone.m4a"), "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", at("animation.mp4")]);
    const result = spawnSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", at("animation.mp4")], { encoding: "utf8", timeout: 30_000 });
    if (result.status !== 0) throw new Error(`output metadata: ffprobe: ${first(result.stderr) || result.error?.message}`);
    const streams = JSON.parse(result.stdout).streams;
    if (!streams.some((stream) => stream.codec_type === "video" && stream.codec_name === "h264") || !streams.some((stream) => stream.codec_type === "audio" && stream.codec_name === "aac"))
      throw new Error("output metadata: expected H.264 video and AAC audio streams");
    step("output decode", "ffmpeg", ["-v", "error", "-nostdin", "-i", at("animation.mp4"), "-frames:v", "1", at("decoded.png")]);
    step("decoded still", "python3", ["-c", "from PIL import Image; import sys; assert Image.open(sys.argv[1]).size == (64,48)", at("decoded.png")]);
    if (!readFileSync(at("page.png")).length || !readFileSync(at("vector.png")).length || !readFileSync(at("tone.wav")).length) throw new Error("decoded output is empty");
    return { pillowPng: true, svgPng: true, pdfPng: true, aacAudio: true, h264AacAnimation: true, decodedPng: true };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = process.argv[2] === "probe" ? probeTools(process.argv[3]) : process.argv[2] === "smoke" ? smokeMedia() : null;
    if (!result) throw new Error("usage: image-check.js probe ROLE | smoke");
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
