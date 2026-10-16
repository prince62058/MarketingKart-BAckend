const test = require('node:test');
const assert = require('node:assert/strict');
const { describeMessage, cleanText, previewText, isGenericLabel } = require('../src/services/whatsappChatFormat');

test('text and media messages keep their content, media ids and captions', () => {
  assert.deepEqual(describeMessage({ type: 'text', text: { body: 'hello' } }), { type: 'TEXT', textBody: 'hello', mediaType: null, mediaId: null });
  const photo = describeMessage({ type: 'image', image: { id: 'm1', caption: 'my shop' } });
  assert.equal(photo.type, 'MEDIA'); assert.equal(photo.mediaId, 'm1'); assert.equal(photo.mediaType, 'image'); assert.equal(photo.textBody, 'my shop');
  const bare = describeMessage({ type: 'image', image: { id: 'm2' } });
  assert.equal(bare.textBody, '📷 Photo'); assert.equal(isGenericLabel(bare.textBody), true);
  const voice = describeMessage({ type: 'voice', voice: { id: 'm3' } });
  assert.equal(voice.mediaType, 'audio'); assert.equal(voice.textBody, '🎤 Voice message');
  assert.equal(describeMessage({ type: 'document', document: { id: 'm4', filename: 'rate.pdf' } }).textBody, '📄 rate.pdf');
});

test('locations, contacts, replies and unsupported types become readable text', () => {
  assert.equal(describeMessage({ type: 'location', location: { name: 'Shop', latitude: 1, longitude: 2 } }).textBody, '📍 Shop');
  assert.equal(describeMessage({ type: 'contacts', contacts: [{ name: { formatted_name: 'Asha' } }] }).textBody, '👤 Asha');
  assert.equal(describeMessage({ type: 'button', button: { text: 'Yes' } }).textBody, 'Yes');
  assert.equal(describeMessage({ type: 'interactive', interactive: { list_reply: { title: 'Plan A' } } }).type, 'INTERACTIVE');
  assert.equal(describeMessage({ type: 'media_placeholder' }).textBody, '📎 Media');
  const unsupported = describeMessage({ type: 'errors', errors: [{ code: 131051 }] });
  assert.equal(unsupported.type, 'UNKNOWN'); assert.match(unsupported.textBody, /Unsupported message/);
});

test('reactions and protocol notices are not shown as chat messages', () => {
  assert.equal(describeMessage({ type: 'reaction', reaction: { emoji: '👍' } }), null);
  assert.equal(describeMessage({ type: 'protocol' }), null);
});

test('placeholder text stored by earlier syncs is shown as friendly labels', () => {
  assert.match(cleanText('[ERRORS]'), /Unsupported message/);
  assert.equal(cleanText('[MEDIA_PLACEHOLDER]'), '📎 Media');
  assert.equal(cleanText('[IMAGE]'), '📷 Photo');
  assert.equal(cleanText('normal text'), 'normal text');
  assert.equal(previewText('  line one\n\nline two  '), 'line one line two');
  assert.equal(previewText('x'.repeat(300)).length, 100);
});
