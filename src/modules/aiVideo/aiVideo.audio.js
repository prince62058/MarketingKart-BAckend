const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { httpError } = require("./aiVideo.errors");
const logger = require("../../utils/logger");

// A video is priced for up to 30 seconds of speech, and the provider bills by the second of audio,
// so a voice note longer than that would cost more than it earns.
const MAX_SECONDS = 30;
// Recorders round: a note the phone calls "30 s" can decode to 30.04 s.
const MAX_SECONDS_WITH_SLACK = 30.5;
const MIN_SECONDS = 1;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const CONVERT_TIMEOUT_MS = 30000;

// WhatsApp voice notes are Opus in an Ogg file; phone recorders give m4a/aac/amr/3gp. Whatever the
// phone sends is turned into plain mono WAV, which the provider accepts, so nothing depends on
// which codec it was.
const ALLOWED_EXTENSIONS = new Set([".opus", ".ogg", ".oga", ".m4a", ".aac", ".mp3", ".wav", ".amr", ".3gp", ".mp4", ".webm", ".caf", ".flac"]);

function looksLikeAudio({ mimetype, filename }) {
  const type = String(mimetype || "").toLowerCase();
  if (type.startsWith("audio/")) return true;
  // Phones label voice recordings as video/mp4, video/3gpp or application/ogg; some pickers give
  // application/octet-stream. The file extension settles those.
  const generic = ["application/ogg", "application/octet-stream", "video/mp4", "video/3gpp", "video/webm"].includes(type);
  return generic && ALLOWED_EXTENSIONS.has(path.extname(String(filename || "")).toLowerCase());
}

function ffmpegPath() {
  // Resolved lazily so requiring this module never needs the binary (tests inject their own).
  return process.env.FFMPEG_PATH || require("@ffmpeg-installer/ffmpeg").path;
}

// "time=00:00:07.52" is printed as ffmpeg works; the last one is how much audio it decoded.
function decodedSeconds(log) {
  const stamps = [...String(log).matchAll(/time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g)];
  if (!stamps.length) return null;
  const [, h, m, s] = stamps[stamps.length - 1];
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(ffmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"] });
    } catch (error) {
      return reject(error);
    }
    let log = "";
    child.stderr.on("data", chunk => {
      // Only the tail matters (the final time= line and any error), so keep it bounded.
      log = (log + chunk).slice(-8000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), CONVERT_TIMEOUT_MS);
    child.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", code => {
      clearTimeout(timer);
      resolve({ code, log });
    });
  });
}

/**
 * Checks a customer's voice note and converts it to a WAV the video provider accepts.
 * Resolves to { buffer, seconds, mimetype, filename }; throws a 400 the customer can act on.
 */
async function prepareVoiceNote({ buffer, filename, mimetype }) {
  if (!buffer || !buffer.length) throw httpError(400, "The voice note is empty. Record it again and try once more.");
  if (buffer.length > MAX_UPLOAD_BYTES) throw httpError(400, "That voice note is too large. Use one under 10 MB (30 seconds is plenty).");
  if (!looksLikeAudio({ mimetype, filename })) throw httpError(400, "Use an audio file, such as a WhatsApp voice note, m4a, mp3 or wav.");

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "voice-note-"));
  const input = path.join(dir, "input");
  const output = path.join(dir, "voice.wav");
  try {
    await fs.promises.writeFile(input, buffer);
    // -t stops decoding shortly after the limit, so a very long file cannot tie the server up.
    // -protocol_whitelist file keeps a crafted playlist from making ffmpeg fetch other addresses.
    const result = await runFfmpeg([
      "-hide_banner", "-nostdin", "-y",
      "-protocol_whitelist", "file",
      "-i", input,
      "-vn", "-map_metadata", "-1",
      "-t", String(MAX_SECONDS + 5),
      "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le",
      output,
    ]).catch(error => {
      logger.error(`[AI VIDEO] ffmpeg could not run: ${error.code || error.message}`);
      throw httpError(503, "Voice notes cannot be processed right now. Please try again later.");
    });

    const seconds = decodedSeconds(result.log);
    let wav = null;
    if (result.code === 0) wav = await fs.promises.readFile(output).catch(() => null);
    if (!wav || !wav.length || seconds === null) {
      throw httpError(400, "That file could not be read as audio. Try another recording.");
    }
    if (seconds < MIN_SECONDS) throw httpError(400, "That voice note is too short. Speak for at least a few seconds.");
    if (seconds > MAX_SECONDS_WITH_SLACK) {
      throw httpError(400, `Voice notes can be up to ${MAX_SECONDS} seconds. Trim yours and try again.`);
    }
    return { buffer: wav, seconds: Math.round(seconds * 10) / 10, mimetype: "audio/wav", filename: "voice.wav" };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { prepareVoiceNote, looksLikeAudio, MAX_SECONDS, MIN_SECONDS, MAX_UPLOAD_BYTES };
