// Turns raw WhatsApp message payloads (Business App history/echoes) into the plain
// text/media shape the inbox stores, and cleans legacy placeholder text for the app.
const MEDIA_TYPES = ['image', 'video', 'audio', 'voice', 'document', 'sticker'];
const LABELS = {
  image: '📷 Photo',
  video: '🎥 Video',
  audio: '🎵 Audio',
  voice: '🎤 Voice message',
  document: '📄 Document',
  sticker: 'Sticker',
};
const MEDIA_PLACEHOLDER = '📎 Media';
const UNSUPPORTED = 'Unsupported message – open WhatsApp Business to view it';
// Text that earlier syncs stored verbatim; shown to people as friendly labels instead.
const LEGACY = {
  '[ERRORS]': UNSUPPORTED,
  '[UNSUPPORTED]': UNSUPPORTED,
  '[UNKNOWN]': UNSUPPORTED,
  '[MEDIA_PLACEHOLDER]': MEDIA_PLACEHOLDER,
  '[IMAGE]': LABELS.image,
  '[VIDEO]': LABELS.video,
  '[AUDIO]': LABELS.audio,
  '[VOICE]': LABELS.voice,
  '[DOCUMENT]': LABELS.document,
  '[STICKER]': LABELS.sticker,
};
const GENERIC_LABELS = new Set([...Object.values(LABELS), MEDIA_PLACEHOLDER]);

const clip = (value, max = 4096) => String(value ?? '').slice(0, max);

/**
 * @returns {{type:string,textBody:string,mediaType:string|null,mediaId:string|null}|null}
 *   null means the message should not appear in the inbox (reactions, protocol notices).
 */
function describeMessage(msg = {}) {
  const t = String(msg.type || '').toLowerCase();
  if (t === 'text') return { type: 'TEXT', textBody: clip(msg.text?.body), mediaType: null, mediaId: null };
  if (MEDIA_TYPES.includes(t)) {
    const media = msg[t] || {};
    return {
      type: 'MEDIA',
      mediaType: t === 'voice' ? 'audio' : t,
      mediaId: media.id ? String(media.id) : null,
      textBody: clip(media.caption || (t === 'document' && media.filename ? `📄 ${media.filename}` : LABELS[t])),
    };
  }
  if (t === 'media_placeholder') return { type: 'UNKNOWN', textBody: MEDIA_PLACEHOLDER, mediaType: null, mediaId: null };
  if (t === 'location') {
    const place = msg.location || {};
    const where = place.name || place.address || [place.latitude, place.longitude].filter(Boolean).join(', ');
    return { type: 'TEXT', textBody: clip(`📍 ${where || 'Location'}`), mediaType: null, mediaId: null };
  }
  if (t === 'contacts') {
    const names = (msg.contacts || []).map(c => c?.name?.formatted_name).filter(Boolean).join(', ');
    return { type: 'TEXT', textBody: clip(`👤 ${names || 'Contact'}`), mediaType: null, mediaId: null };
  }
  if (t === 'button') return { type: 'INTERACTIVE', textBody: clip(msg.button?.text || 'Button reply'), mediaType: null, mediaId: null };
  if (t === 'interactive') {
    const reply = msg.interactive?.button_reply || msg.interactive?.list_reply;
    return { type: 'INTERACTIVE', textBody: clip(reply?.title || 'Interactive reply'), mediaType: null, mediaId: null };
  }
  if (t === 'reaction' || t === 'protocol' || t === 'ephemeral' || t === 'system') return null;
  return { type: 'UNKNOWN', textBody: UNSUPPORTED, mediaType: null, mediaId: null };
}

/** Friendly text for placeholders stored by earlier versions. */
function cleanText(text) {
  const value = String(text ?? '');
  return LEGACY[value.toUpperCase()] || value;
}

/** Preview line for the conversation list (single line, trimmed). */
function previewText(text) {
  return cleanText(text).replace(/\s+/g, ' ').trim().slice(0, 100);
}

const isGenericLabel = text => GENERIC_LABELS.has(cleanText(text));

module.exports = { describeMessage, cleanText, previewText, isGenericLabel, MEDIA_PLACEHOLDER, UNSUPPORTED, LABELS };
