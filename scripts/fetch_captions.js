import fs from "fs";
import path from "path";
import { XMLParser } from "fast-xml-parser";

const CAPTIONS_DIR = path.resolve("captions");

// CONFIG: poné tus idiomas preferidos en orden
const LANGS = ["vi", "en", "es"]; // si hay vi, usa vi. si no, en, etc.

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// Convierte (muy simple) XML timedtext a VTT
function timedTextXmlToVtt(xmlText) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
  const data = parser.parse(xmlText);

  const texts = data?.transcript?.text;
  if (!texts) return null;

  const arr = Array.isArray(texts) ? texts : [texts];

  let vtt = "WEBVTT\n\n";
  for (let i = 0; i < arr.length; i++) {
    const t = arr[i];
    const start = parseFloat(t.start ?? "0");
    const dur = parseFloat(t.dur ?? "0");
    const end = start + dur;

    const line = (t["#text"] ?? "")
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replace(/\s+/g, " ")
      .trim();

    if (!line) continue;

    vtt += `${i + 1}\n${secToTimestamp(start)} --> ${secToTimestamp(end)}\n${line}\n\n`;
  }
  return vtt;
}

function secToTimestamp(sec) {
  const s = Math.max(0, sec);
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);

  const hh = String(hours).padStart(2, "0");
  const mm = String(mins).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  const mmm = String(ms).padStart(3, "0");

  return `${hh}:${mm}:${ss}.${mmm}`;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.text();
}

// Intenta bajar timedtext público.
// OJO: esto funciona SI el subtítulo del video es accesible públicamente.
async function tryDownloadTimedText(videoId, lang) {
  const url = `https://www.youtube.com/api/timedtext?lang=${encodeURIComponent(lang)}&v=${encodeURIComponent(videoId)}`;
  const xml = await fetchText(url);
  if (!xml || !xml.includes("<transcript")) return null;
  const vtt = timedTextXmlToVtt(xml);
  return vtt;
}

async function main() {
  ensureDir(CAPTIONS_DIR);

  const inputPath = path.resolve("videos.json");
  if (!fs.existsSync(inputPath)) {
    console.log("❌ Falta videos.json en la raíz del repo (lista de videos).");
    process.exit(1);
  }

  const videos = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (!Array.isArray(videos)) {
    console.log("❌ videos.json debe ser un array: [{id,title}, ...]");
    process.exit(1);
  }

  let downloaded = 0;

  for (const vid of videos) {
    const videoId = vid.id;
    if (!videoId) continue;

    const outFile = path.join(CAPTIONS_DIR, `${videoId}.vtt`);
    if (fs.existsSync(outFile)) continue; // ya existe, no lo re-baja

    let vtt = null;
    for (const lang of LANGS) {
      try {
        vtt = await tryDownloadTimedText(videoId, lang);
        if (vtt) {
          console.log(`✅ ${videoId} -> ${lang}`);
          break;
        }
      } catch (e) {
        // seguimos probando otros idiomas
      }
    }

    if (vtt) {
      fs.writeFileSync(outFile, vtt, "utf8");
      downloaded++;
    } else {
      console.log(`⚠️ No captions públicos para: ${videoId}`);
    }
  }

  console.log(`\nDone. Nuevos archivos: ${downloaded}`);
}

main().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});

