import crypto from "node:crypto";
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { importMedia, probeMedia } from "./media.js";
import { StoreError } from "./store.js";

const execFileAsync = promisify(execFile);
const REFERENCE_BYTES = 20 * 1024 * 1024;
const MEDIA_BYTES = 2 * 1024 * 1024 * 1024;
const URL_BYTES = 10 * 1024 * 1024;
const TEXT_CHARS = 200_000;
const VALID_CATEGORIES = new Set(["Reference", "B-roll", "Narration", "Graphics"]);

function safeName(value) {
  const name = path.basename(String(value || "upload")).replace(/[^\p{L}\p{N}._ -]+/gu, "_");
  return name.slice(0, 180) || "upload";
}
function category(value) {
  const result = String(value || "Reference");
  if (!VALID_CATEGORIES.has(result)) throw new StoreError("Unknown library category");
  return result;
}
function boundedText(text) {
  const value = String(text || "").replaceAll("\u0000", "");
  return { text: value.slice(0, TEXT_CHARS), truncated: value.length > TEXT_CHARS };
}
function isPrivate(address) {
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 192 && (b === 0 || b === 168 || (b === 2 && c === 0))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113);
  }
  const value = address.toLowerCase().split("%")[0];
  if (value.startsWith("::ffff:")) {
    const mapped = value.slice(7);
    if (net.isIPv4(mapped)) return isPrivate(mapped);
    const words = mapped.split(":");
    if (words.length === 2) {
      const high = Number.parseInt(words[0], 16), low = Number.parseInt(words[1], 16);
      if (Number.isInteger(high) && Number.isInteger(low))
        return isPrivate(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
  }
  return value === "::" || value === "::1" || value.startsWith("fe80:") || value.startsWith("fc") ||
    value.startsWith("fd") || value.startsWith("ff") || value.startsWith("2001:db8:") || value.startsWith("::ffff:127.");
}
async function validatePublicUrl(input, lookup = dns.lookup) {
  let url;
  try { url = new URL(input); } catch { throw new StoreError("Reference URL is invalid"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new StoreError("Reference URL must be public HTTP or HTTPS", 403);
  if (url.port && !["80", "443"].includes(url.port))
    throw new StoreError("Reference URL uses a forbidden port", 403);
  let addresses;
  try { addresses = await lookup(url.hostname, { all: true, verbatim: true }); }
  catch { throw new StoreError("Reference URL host could not be resolved", 422); }
  if (!addresses.length || addresses.some(({ address }) => isPrivate(address)))
    throw new StoreError("Reference URL resolves to a forbidden destination", 403);
  return { url, addresses };
}
function requestPublic(url, addresses, signal) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(url, {
      method: "GET",
      headers: { accept: "text/html,text/plain,application/pdf;q=0.9" },
      lookup(_hostname, options, callback) {
        if (options?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
      signal,
    }, (response) => resolve({
      status: response.statusCode || 0,
      ok: response.statusCode >= 200 && response.statusCode < 300,
      headers: { get: (name) => response.headers[String(name).toLowerCase()] || null },
      body: response,
    }));
    request.on("error", reject);
    request.end();
  });
}
function decodeUtf8(buffer) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { return null; }
}
async function discardResponse(response) {
  if (typeof response?.body?.destroy === "function") response.body.destroy();
  else if (typeof response?.body?.cancel === "function") await response.body.cancel().catch(() => {});
}
async function extractReference(file, name, contentType) {
  const extension = path.extname(name).toLowerCase();
  if (extension === ".pdf" || /^application\/pdf(?:;|$)/i.test(contentType || "")) {
    let info;
    try { ({ stdout: info } = await execFileAsync("pdfinfo", [file], { maxBuffer: 1024 * 1024 })); }
    catch (error) { return { text: "", truncated: false, status: "unavailable", format: "pdf", error: `PDF metadata unavailable: ${error.message}` }; }
    const pages = Number(/^Pages:\s+(\d+)/mi.exec(info)?.[1] || 0);
    if (pages > 100) throw new StoreError("PDF must contain at most 100 pages", 422);
    if (!pages) return { text: "", truncated: false, status: "unavailable", format: "pdf", error: "PDF page count unavailable" };
    let stdout;
    try { ({ stdout } = await execFileAsync("pdftotext", ["-layout", file, "-"], { maxBuffer: 2 * 1024 * 1024 })); }
    catch (error) { return { text: "", truncated: false, status: "unavailable", format: "pdf", pages, error: `PDF text unavailable: ${error.message}` }; }
    const extracted = boundedText(stdout);
    return { ...extracted, status: extracted.truncated ? "truncated" : extracted.text.trim() ? "complete" : "unavailable", format: "pdf", pages,
      ...(extracted.text.trim() ? {} : { error: "PDF contains no extractable text" }) };
  }
  if (extension === ".html" || extension === ".htm" || /text\/html/i.test(contentType || "")) {
    const html = decodeUtf8(await readFile(file));
    if (html == null) return { text: "", truncated: false, status: "unavailable", format: "html", error: "Reference is not valid UTF-8" };
    const dom = new JSDOM(html, { url: "https://storybench.invalid/reference" });
    const article = new Readability(dom.window.document).parse();
    const extracted = boundedText([article?.title, article?.textContent].filter(Boolean).join("\n\n"));
    return { ...extracted, status: extracted.truncated ? "truncated" : article ? "complete" : "unsupported", format: "html" };
  }
  if (extension === ".txt" || extension === ".md" || /^text\//i.test(contentType || "")) {
    const decoded = decodeUtf8(await readFile(file));
    if (decoded == null) return { text: "", truncated: false, status: "unavailable", format: extension.slice(1) || "text", error: "Reference is not valid UTF-8" };
    const extracted = boundedText(decoded);
    return { ...extracted, status: extracted.truncated ? "truncated" : "complete", format: extension.slice(1) || "text" };
  }
  return { text: "", truncated: false, status: "unsupported", format: extension.slice(1) || "binary" };
}

export function createLibraryService({ workspace, store, fetchImpl = null, dnsLookup = dns.lookup } = {}) {
  let importTail = Promise.resolve();
  const serialized = (fn) => {
    const result = importTail.catch(() => {}).then(fn);
    importTail = result.catch(() => {});
    return result;
  };
  async function writeIncoming(readable, destination, limit, signal) {
    let bytes = 0;
    const meter = new Transform({ transform(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > limit) callback(new StoreError(`Import exceeds the ${Math.floor(limit / 1024 / 1024)} MiB limit`, 413));
      else callback(null, chunk);
    }});
    await pipeline(readable, meter, createWriteStream(destination, { flags: "wx" }), { signal });
    return bytes;
  }
  // Imports register into the episode's owning channel; deduplication never crosses channels.
  function destination(episodeId) {
    const episode = store.getEpisode(episodeId);
    if (!episode) throw new StoreError("Episode not found", 404);
    store.ensureEpisodeDirectories(episodeId);
    return { episode, channelId: episode.channelId, mediaDirectory: store.channelMediaDirectory(episode.channelId), fileDirectory: store.episodeLibraryFileDirectory(episodeId) };
  }
  // A freshly published managed copy is redundant when the channel already registered the same bytes elsewhere.
  async function keepExisting(imported, asset) {
    if (imported.createdFile && asset.path !== imported.path) await rm(path.join(workspace, imported.path), { force: true });
  }
  async function registerFile({ episodeId, readable, fileName, label, sectionId, contentType, selectedCategory, signal }) {
    return serialized(async () => {
      const chosenCategory = category(selectedCategory);
      const target = destination(episodeId);
      const name = safeName(fileName);
      const temporaryDir = path.join(workspace, "imports");
      await mkdir(temporaryDir, { recursive: true });
      const temporary = path.join(temporaryDir, `.library-${crypto.randomUUID()}.tmp`);
      try {
        const bytes = await writeIncoming(readable, temporary, MEDIA_BYTES, signal);
        let extraction = { text: "", status: "not-applicable", truncated: false, format: null };
        let asset;
        let mediaProbe = null;
        try { mediaProbe = await probeMedia(temporary, { signal }); }
        catch (error) { if (error.name === "AbortError") throw error; }
        if (mediaProbe) {
          const imported = await importMedia({ workspace, sourcePath: temporary, mediaDirectory: target.mediaDirectory });
          imported.name = name;
          imported.channelId = target.channelId;
          imported.metadata = { ...imported.metadata, contentType, importedForCategory: chosenCategory };
          const existing = store.getAssetByHash(imported.hash, target.channelId);
          asset = existing?.kind === "reference"
            ? store.repairReferenceAssetAsMedia(existing.id, imported)
            : store.saveAsset(imported);
          if (existing?.kind !== "reference") await keepExisting(imported, asset);
          extraction.format = mediaProbe.kind;
        } else if (chosenCategory === "Reference") {
          if (bytes > REFERENCE_BYTES) throw new StoreError("Reference input exceeds the 20 MiB limit", 413);
          extraction = await extractReference(temporary, name, contentType);
          const hash = crypto.createHash("sha256").update(await readFile(temporary)).digest("hex");
          asset = store.getAssetByHash(hash, target.channelId);
          if (!asset) {
            const folder = target.fileDirectory;
            await mkdir(folder, { recursive: true });
            const registered = path.join(folder, `${hash.slice(0, 16)}-${name}`);
            try { await stat(registered); } catch { await rename(temporary, registered); }
            asset = store.saveAsset({ channelId: target.channelId, name, hash, kind: "reference", path: path.relative(workspace, registered), metadata: { contentType, bytes } });
          }
        } else throw new StoreError("File contains no supported audio, video, or image streams", 422);
        return store.attachLibraryItem(episodeId, asset.id, {
          category: chosenCategory, label: String(label || name), sectionId, sourceKind: "file",
          extractedText: extraction.text, extractionStatus: extraction.status,
          provenance: { fileName: name, contentType: contentType || null, bytes, format: extraction.format, truncated: extraction.truncated, pages: extraction.pages || null, extractionError: extraction.error || null },
        });
      } finally { await rm(temporary, { force: true }); }
    });
  }
  async function registerText({ episodeId, title, text, sectionId }) {
    return serialized(async () => {
      const target = destination(episodeId);
      const name = safeName(title || "Pasted reference.txt");
      const extracted = boundedText(text);
      const content = String(text || "");
      if (Buffer.byteLength(content) > REFERENCE_BYTES) throw new StoreError("Reference text exceeds the 20 MiB limit", 413);
      const hash = crypto.createHash("sha256").update(content).digest("hex");
      let asset = store.getAssetByHash(hash, target.channelId);
      if (!asset) {
        await mkdir(target.fileDirectory, { recursive: true });
        const file = path.join(target.fileDirectory, `${hash.slice(0, 16)}-${name.endsWith(".txt") ? name : `${name}.txt`}`);
        try { await stat(file); } catch { await writeFile(file, content, { flag: "wx" }); }
        asset = store.saveAsset({ channelId: target.channelId, name, hash, kind: "reference", path: path.relative(workspace, file), metadata: { contentType: "text/plain", bytes: Buffer.byteLength(content) } });
      }
      return store.attachLibraryItem(episodeId, asset.id, { category: "Reference", label: name, sectionId, sourceKind: "text", extractedText: extracted.text, extractionStatus: extracted.truncated ? "truncated" : "complete", provenance: { format: "text", truncated: extracted.truncated } });
    });
  }
  async function registerUrl({ episodeId, url: input, sectionId, signal }) {
    return serialized(async () => {
      const target = destination(episodeId);
      let validated = await validatePublicUrl(input, dnsLookup);
      let current = validated.url;
      let response;
      for (let redirects = 0; redirects <= 5; redirects++) {
        response = fetchImpl
          ? await fetchImpl(current, { redirect: "manual", signal, headers: { accept: "text/html,text/plain,application/pdf;q=0.9" }, validatedAddresses: validated.addresses })
          : await requestPublic(current, validated.addresses, signal);
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        await discardResponse(response);
        if (redirects === 5) throw new StoreError("Reference URL redirected too many times", 422);
        const location = response.headers.get("location");
        if (!location) throw new StoreError("Reference URL redirect has no destination", 422);
        validated = await validatePublicUrl(new URL(location, current).href, dnsLookup);
        current = validated.url;
      }
      if (!response.ok) {
        await discardResponse(response);
        throw new StoreError(`Reference URL returned HTTP ${response.status}`, 422);
      }
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > URL_BYTES) {
        await discardResponse(response);
        throw new StoreError("Reference URL response exceeds the 10 MiB limit", 413);
      }
      const name = safeName(path.basename(current.pathname) || `${current.hostname}.html`);
      const temporary = path.join(workspace, "imports", `.url-${crypto.randomUUID()}.tmp`);
      try {
        await writeIncoming(response.body, temporary, URL_BYTES, signal);
        const contentType = response.headers.get("content-type") || "application/octet-stream";
        const extraction = await extractReference(temporary, name, contentType);
        const bytes = (await stat(temporary)).size;
        const hash = crypto.createHash("sha256").update(await readFile(temporary)).digest("hex");
        let asset = store.getAssetByHash(hash, target.channelId);
        if (!asset) {
          await mkdir(target.fileDirectory, { recursive: true });
          const registered = path.join(target.fileDirectory, `${hash.slice(0, 16)}-${name}`);
          try { await stat(registered); } catch { await copyFile(temporary, registered); }
          asset = store.saveAsset({ channelId: target.channelId, name, hash, kind: "reference", path: path.relative(workspace, registered), metadata: { contentType, bytes, sourceUrl: current.href } });
        }
        return store.attachLibraryItem(episodeId, asset.id, { category: "Reference", label: name, sectionId, sourceKind: "url", sourceUrl: current.href, extractedText: extraction.text, extractionStatus: extraction.status, provenance: { requestedUrl: String(input), finalUrl: current.href, retrievedAt: new Date().toISOString(), contentType, bytes, format: extraction.format, truncated: extraction.truncated, pages: extraction.pages || null, extractionError: extraction.error || null } });
      } finally { await rm(temporary, { force: true }); }
    });
  }
  async function sourceFile(asset) {
    const root = await realpath(workspace);
    const candidate = path.resolve(workspace, asset.path);
    const actual = await realpath(candidate).catch(() => null);
    if (!actual || (actual !== root && !actual.startsWith(root + path.sep)))
      throw new StoreError("Source asset file is missing or escapes the data root", 409);
    const info = await stat(actual);
    if (!info.isFile()) throw new StoreError("Source asset is not a regular file", 409);
    return actual;
  }
  async function sha256(file) {
    return crypto.createHash("sha256").update(await readFile(file)).digest("hex");
  }
  // User-directed reuse of one registered item into an explicit destination episode, possibly in another channel.
  // The source item, asset row and bytes are never modified. Across channels the destination gets its own asset
  // (deduplicated by content within that channel); provenance records the exact origin. An optional card
  // assignment is revision-checked; if it conflicts the reused item stays in the destination library.
  async function reuseItem({ source = {}, destination: target = {}, category: requestedCategory = null, label = null, requestId = null, actor = "human" } = {}) {
    for (const [field, value] of [["source.episodeId", source.episodeId], ["source.itemId", source.itemId], ["destination.episodeId", target.episodeId]])
      if (typeof value !== "string" || !value.trim()) throw new StoreError(`${field} is required`, 400);
    return serialized(async () => {
      const sourceEpisode = store.getEpisode(source.episodeId);
      if (!sourceEpisode) throw new StoreError("Source episode not found", 404);
      if (source.channelId && source.channelId !== sourceEpisode.channelId) throw new StoreError("Source episode belongs to another channel", 409);
      const item = store.getLibraryItem(source.episodeId, source.itemId);
      if (!item?.asset) throw new StoreError("Source library item not found in that episode", 404);
      const destinationEpisode = store.getEpisode(target.episodeId);
      if (!destinationEpisode) throw new StoreError("Destination episode not found", 404);
      if (target.channelId && target.channelId !== destinationEpisode.channelId) throw new StoreError("Destination episode belongs to another channel", 409);
      if (destinationEpisode.id === sourceEpisode.id) throw new StoreError("The item is already in this episode", 409);
      const chosenCategory = category(requestedCategory || item.category);
      const channelId = destinationEpisode.channelId;
      const sourceChannel = store.getChannel(sourceEpisode.channelId);
      const origin = { channelId: sourceEpisode.channelId, channelName: sourceChannel?.name ?? null, episodeId: sourceEpisode.id,
        episodeTitle: sourceEpisode.title, itemId: item.id, assetId: item.assetId, hash: item.asset.hash, category: item.category, label: item.label };
      const already = store.listEpisodeLibrary(destinationEpisode.id).find((candidate) => candidate.provenance?.reusedFrom?.itemId === item.id);
      let reused = already, copied = false;
      if (!reused) {
        store.ensureEpisodeDirectories(destinationEpisode.id);
        let asset = item.asset.channelId === channelId ? item.asset : store.getAssetByHash(item.asset.hash, channelId);
        if (!asset) {
          const file = await sourceFile(item.asset);
          const mediaDirectory = store.channelMediaDirectory(channelId);
          if (["video", "audio", "image"].includes(item.asset.kind)) {
            const imported = await importMedia({ workspace, sourcePath: file, mediaDirectory });
            if (imported.hash !== item.asset.hash) {
              if (imported.createdFile) await rm(path.join(workspace, imported.path), { force: true });
              throw new StoreError("Source bytes no longer match the registered asset; it was not reused", 409);
            }
            asset = store.saveAsset({ ...imported, channelId, name: item.asset.name,
              metadata: { ...item.asset.metadata, ...imported.metadata, reusedFromAssetId: item.asset.id } });
          } else {
            if ((await sha256(file)) !== item.asset.hash) throw new StoreError("Source bytes no longer match the registered asset; it was not reused", 409);
            await mkdir(mediaDirectory, { recursive: true });
            const registered = path.join(mediaDirectory, `${item.asset.hash.slice(0, 16)}-${safeName(path.basename(item.asset.path))}`);
            try { await stat(registered); } catch { await copyFile(file, registered); }
            if ((await sha256(registered)) !== item.asset.hash) throw new StoreError("Managed copy does not match the source bytes", 409);
            asset = store.saveAsset({ channelId, name: item.asset.name, hash: item.asset.hash, kind: item.asset.kind,
              path: path.relative(workspace, registered), duration: item.asset.duration, width: item.asset.width, height: item.asset.height,
              metadata: { ...item.asset.metadata, reusedFromAssetId: item.asset.id } });
          }
          copied = true;
        }
        reused = store.attachLibraryItem(destinationEpisode.id, asset.id, {
          category: chosenCategory, label: String(label || item.label), sourceKind: "reuse", sourceUrl: item.sourceUrl,
          extractedText: item.extractedText, extractionStatus: item.extractionStatus,
          provenance: { reusedFrom: origin, reusedAt: new Date().toISOString(), copiedBytes: copied, requestId, actor },
        });
      }
      let appliedToCard = false, applyNote = null;
      if (target.cardId) {
        const current = store.getEpisode(destinationEpisode.id);
        const card = current.cards.find((value) => value.id === target.cardId);
        const field = target.assign === "reference" ? "reference" : "item";
        if (!Number.isInteger(target.expectedRevision) || target.expectedRevision !== current.revision)
          applyNote = "Reused into the library; the episode changed since the request, so the card was not updated";
        else if (!card) applyNote = "Reused into the library; the target card no longer exists";
        else {
          const cards = current.cards.map((value) => value.id !== card.id ? value : field === "reference"
            ? { ...value, referenceItemIds: [...new Set([...(value.referenceItemIds || []), reused.id])] }
            : { ...value, itemId: reused.id });
          try {
            store.updateEpisode(current.id, current.revision, { cards }, actor === "agent" ? "agent" : "human");
            appliedToCard = true;
          } catch (error) {
            if (!(error instanceof StoreError)) throw error;
            applyNote = `Reused into the library; the card was not updated: ${error.message}`;
          }
        }
      }
      return { item: store.getLibraryItem(destinationEpisode.id, reused.id), copied, deduplicated: !copied && !already && item.asset.channelId !== channelId,
        alreadyPresent: Boolean(already), appliedToCard, applyNote };
    });
  }
  return { registerFile, registerText, registerUrl, reuseItem };
}
