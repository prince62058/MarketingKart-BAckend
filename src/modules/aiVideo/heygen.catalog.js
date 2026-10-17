const heygen = require("./heygen.client");
const settings = require("./aiVideo.settings");

// Presets behind the app's "Priya" and "Raj" presenters. HeyGen's `gender` metadata is
// unreliable, so these ids were picked by looking at the previews. Override per
// deployment with HEYGEN_AVATAR_PRIYA / HEYGEN_AVATAR_RAJ.
// Only these presets and avatars a user creates are ever offered: the HeyGen workspace
// also holds private avatars for other businesses, which must never reach end users.
const PRESET_LOOKS = {
  priya: "4f0e5bc172804456bf92d0f8e4563b97",
  raj: "a761ce70b43447ab8383684d98afcf22",
};

// App voice -> preferred HeyGen voices (by name), then any voice of the right gender.
const VOICE_PROFILES = {
  priya: { gender: "female", names: ["Riya Mehta", "Aahana Verma"] },
  kavya: { gender: "female", names: ["Saanu", "Muskaan", "Bollywood Priyanka"] },
  aarav: { gender: "male", names: ["Manu", "Naveen", "Ruhaan"] },
};

const LANGUAGE_BY_APP_LANGUAGE = { hindi: "Hindi", hinglish: "Hindi", english: "English" };

const LOOK_TTL_MS = 60 * 60 * 1000;
const VOICE_TTL_MS = 6 * 60 * 60 * 1000;

const cache = new Map();

async function cached(key, ttl, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  if (hit && hit.pending) return hit.pending;
  const pending = load().then(
    value => {
      cache.set(key, { at: Date.now(), value });
      return value;
    },
    error => {
      cache.delete(key);
      throw error;
    },
  );
  cache.set(key, { at: 0, pending });
  return pending;
}

function clearCache() {
  cache.clear();
}

// The admin Settings page wins, then the deployment's env var, then the built-in preset.
async function presetCandidates(presenter) {
  let chosen = "";
  try {
    chosen = ((await settings.get()).presenters || {})[presenter] || "";
  } catch (error) {
    // Settings are a convenience here; the env var and built-in preset still work without them.
  }
  return [chosen, process.env[`HEYGEN_AVATAR_${String(presenter).toUpperCase()}`], PRESET_LOOKS[presenter]].filter(Boolean);
}

async function fetchLook(lookId) {
  return cached(`look:${lookId}`, LOOK_TTL_MS, async () => {
    try {
      return await heygen.getLook(lookId);
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  });
}

async function fallbackLook() {
  return cached("look:fallback", LOOK_TTL_MS, async () => {
    const { items } = await heygen.listLooks({ ownership: "public", avatar_type: "digital_twin", limit: 50 });
    return items.find(item => item.status === "completed" && item.preferred_orientation === "portrait") || null;
  });
}

// Picks the engine the look supports; HeyGen defaults to Avatar IV when none is sent.
function engineFor(look) {
  const supported = look.supported_api_engines || [];
  const wanted = process.env.HEYGEN_ENGINE;
  if (wanted && supported.includes(wanted)) return { type: wanted };
  if (!supported.length || supported.includes("avatar_iv")) return undefined;
  return { type: supported[0] };
}

// `presenter` is "priya" | "raj", or the HeyGen look id of an avatar the user created.
async function resolvePresenter(presenter, { lookId } = {}) {
  let look = null;
  if (lookId) {
    look = await fetchLook(lookId);
    if (!look || look.status !== "completed") {
      const error = new Error("This avatar is not ready yet.");
      error.status = 400;
      throw error;
    }
  } else {
    for (const candidate of [...(await presetCandidates(presenter)), ...(presenter === "priya" ? [] : await presetCandidates("priya"))]) {
      const found = await fetchLook(candidate);
      if (found && found.status === "completed") {
        look = found;
        break;
      }
    }
    if (!look) look = await fallbackLook();
  }
  if (!look) {
    const error = new Error("No presenter is available right now. Please try again later.");
    error.status = 503;
    throw error;
  }
  return {
    avatarId: look.id,
    defaultVoiceId: look.default_voice_id || null,
    previewImageUrl: look.preview_image_url || null,
    orientation: look.preferred_orientation || null,
    engine: engineFor(look),
  };
}

async function voicesFor(language) {
  return cached(`voices:${language}`, VOICE_TTL_MS, async () => {
    const { items } = await heygen.listVoices({ type: "public", language });
    return items;
  });
}

function voiceEnvKey(voice, language) {
  return `HEYGEN_VOICE_${String(voice).toUpperCase()}_${language === "English" ? "EN" : "HI"}`;
}

const LIBRARY_PREFIX = "hg:";
const presentVoice = item => ({
  id: `${LIBRARY_PREFIX}${item.voice_id}`,
  name: String(item.name || "").trim(),
  gender: item.gender || null,
  language: item.language || null,
  previewUrl: item.preview_audio_url || null,
});

// Public HeyGen voices for the picker. `language` is the app language; gender and search narrow it.
async function libraryVoices({ language, gender, search } = {}) {
  const heygenLanguage = LANGUAGE_BY_APP_LANGUAGE[language] || "Hindi";
  const wantGender = ["female", "male"].includes(gender) ? gender : null;
  const term = String(search || "").trim().toLowerCase();
  const voices = await voicesFor(heygenLanguage);
  return voices
    .filter(item => item.voice_id && item.name)
    .filter(item => !wantGender || item.gender === wantGender)
    .filter(item => !term || String(item.name).toLowerCase().includes(term))
    .map(presentVoice)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// A library pick is stored as "hg:<voice id>". Confirm it still exists before it is used.
async function libraryVoiceDetails(voice) {
  const id = String(voice).slice(LIBRARY_PREFIX.length);
  const notFound = () => {
    const error = new Error("That voice is no longer available. Pick another one.");
    error.status = 400;
    return error;
  };
  if (!id) throw notFound();
  for (const language of ["Hindi", "English"]) {
    const match = (await voicesFor(language)).find(item => item.voice_id === id);
    if (match) return { voiceId: id, name: match.name, previewUrl: match.preview_audio_url || null };
  }
  try {
    const found = await heygen.getVoice(id);
    if (found && found.voice_id) return { voiceId: id, name: found.name || null, previewUrl: found.preview_audio_url || null };
  } catch (error) {
    if (!(error instanceof heygen.HeyGenError && error.status === 404)) throw error;
  }
  throw notFound();
}

const isLibraryVoice = voice => typeof voice === "string" && voice.startsWith(LIBRARY_PREFIX);

// `voice` is the app's voice id ("priya" | "aarav" | "kavya") or a library pick ("hg:<id>"); `language` the app language.
// Returns { voiceId, name, previewUrl }; previewUrl is HeyGen's free sample for that voice.
async function resolveVoiceDetails({ voice, language, fallbackVoiceId }) {
  if (isLibraryVoice(voice)) return libraryVoiceDetails(voice);
  const heygenLanguage = LANGUAGE_BY_APP_LANGUAGE[language] || "Hindi";
  const profile = VOICE_PROFILES[voice] || VOICE_PROFILES.priya;
  const voices = await voicesFor(heygenLanguage);
  const pinned = process.env[voiceEnvKey(voice, heygenLanguage)];
  if (pinned) {
    const match = voices.find(item => item.voice_id === pinned);
    return { voiceId: pinned, name: match ? match.name : null, previewUrl: match ? match.preview_audio_url || null : null };
  }

  const sameGender = voices.filter(item => item.gender === profile.gender);
  const byName = profile.names.map(name => sameGender.find(item => item.name.trim() === name)).find(Boolean);
  const chosen = byName || sameGender[0] || voices[0];
  if (chosen) return { voiceId: chosen.voice_id, name: chosen.name, previewUrl: chosen.preview_audio_url || null };
  if (fallbackVoiceId) return { voiceId: fallbackVoiceId, name: null, previewUrl: null };
  const error = new Error("No voice is available for this language right now.");
  error.status = 503;
  throw error;
}

async function resolveVoice(options) {
  return (await resolveVoiceDetails(options)).voiceId;
}

module.exports = {
  PRESET_LOOKS,
  VOICE_PROFILES,
  LANGUAGE_BY_APP_LANGUAGE,
  resolvePresenter,
  resolveVoice,
  resolveVoiceDetails,
  libraryVoices,
  isLibraryVoice,
  fetchLook,
  engineFor,
  clearCache,
};
