import crypto from "node:crypto";
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { importMedia } from "./media.js";
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
  async function registerFile({ episodeId, readable, fileName, label, sectionId, contentType, selectedCategory, signal }) {
    return serialized(async () => {
      const chosenCategory = category(selectedCategory);
      if (!store.getEpisode(episodeId)) throw new StoreError("Episode not found", 404);
      store.ensureEpisodeDirectories(episodeId);
      const name = safeName(fileName);
      const temporaryDir = path.join(workspace, "imports");
      await mkdir(temporaryDir, { recursive: true });
      const temporary = path.join(temporaryDir, `.library-${crypto.randomUUID()}.tmp`);
      try {
        const limit = chosenCategory === "Reference" ? REFERENCE_BYTES : MEDIA_BYTES;
        const bytes = await writeIncoming(readable, temporary, limit, signal);
        let extraction = { text: "", status: "not-applicable", truncated: false, format: null };
        let asset;
        if (chosenCategory === "Reference") {
          extraction = await extractReference(temporary, name, contentType);
          const hash = crypto.createHash("sha256").update(await readFile(temporary)).digest("hex");
          asset = store.getAssetByHash(hash);
          if (!asset) {
            const folder = path.join(store.episodeDirectory(episodeId), "reference");
            await mkdir(folder, { recursive: true });
            const registered = path.join(folder, `${hash.slice(0, 16)}-${name}`);
            try { await stat(registered); } catch { await rename(temporary, registered); }
            asset = store.saveAsset({ name, hash, kind: "reference", path: path.relative(workspace, registered), metadata: { contentType, bytes } });
          }
        } else {
          const imported = await importMedia({ workspace, sourcePath: temporary });
          imported.name = name;
          imported.metadata = { ...imported.metadata, contentType, importedForCategory: chosenCategory };
          asset = store.saveAsset(imported);
        }
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
      if (!store.getEpisode(episodeId)) throw new StoreError("Episode not found", 404);
      store.ensureEpisodeDirectories(episodeId);
      const name = safeName(title || "Pasted reference.txt");
      const extracted = boundedText(text);
      const content = String(text || "");
      if (Buffer.byteLength(content) > REFERENCE_BYTES) throw new StoreError("Reference text exceeds the 20 MiB limit", 413);
      const hash = crypto.createHash("sha256").update(content).digest("hex");
      let asset = store.getAssetByHash(hash);
      if (!asset) {
        const file = path.join(store.episodeDirectory(episodeId), "reference", `${hash.slice(0, 16)}-${name.endsWith(".txt") ? name : `${name}.txt`}`);
        try { await stat(file); } catch { await writeFile(file, content, { flag: "wx" }); }
        asset = store.saveAsset({ name, hash, kind: "reference", path: path.relative(workspace, file), metadata: { contentType: "text/plain", bytes: Buffer.byteLength(content) } });
      }
      return store.attachLibraryItem(episodeId, asset.id, { category: "Reference", label: name, sectionId, sourceKind: "text", extractedText: extracted.text, extractionStatus: extracted.truncated ? "truncated" : "complete", provenance: { format: "text", truncated: extracted.truncated } });
    });
  }
  async function registerUrl({ episodeId, url: input, sectionId, signal }) {
    return serialized(async () => {
      if (!store.getEpisode(episodeId)) throw new StoreError("Episode not found", 404);
      store.ensureEpisodeDirectories(episodeId);
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
        let asset = store.getAssetByHash(hash);
        if (!asset) {
          const registered = path.join(store.episodeDirectory(episodeId), "reference", `${hash.slice(0, 16)}-${name}`);
          try { await stat(registered); } catch { await copyFile(temporary, registered); }
          asset = store.saveAsset({ name, hash, kind: "reference", path: path.relative(workspace, registered), metadata: { contentType, bytes, sourceUrl: current.href } });
        }
        return store.attachLibraryItem(episodeId, asset.id, { category: "Reference", label: name, sectionId, sourceKind: "url", sourceUrl: current.href, extractedText: extraction.text, extractionStatus: extraction.status, provenance: { requestedUrl: String(input), finalUrl: current.href, retrievedAt: new Date().toISOString(), contentType, bytes, format: extraction.format, truncated: extraction.truncated, pages: extraction.pages || null, extractionError: extraction.error || null } });
      } finally { await rm(temporary, { force: true }); }
    });
  }
  return { registerFile, registerText, registerUrl };
}
