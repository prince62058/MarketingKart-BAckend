const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
// Ensure the key is exactly 32 bytes
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY 
  ? crypto.scryptSync(process.env.ENCRYPTION_KEY, 'salt', 32) 
  : crypto.scryptSync('fallback_secret_key_for_dev_only', 'salt', 32);

const IV_LENGTH = 16;

/**
 * Encrypts a text string safely
 */
function encryptText(text) {
  if (!text) return text;
  try {
    if (process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY) {
      const key = Buffer.from(process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY, 'hex');
      if (key.length !== 32) throw new Error('Invalid WhatsApp encryption key');
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
      const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return ['gcm1', nonce.toString('hex'), cipher.getAuthTag().toString('hex'), data.toString('hex')].join(':');
    }
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
  } catch (error) {
    console.error('[Encryption Error]:', error.message);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypts an encrypted text string safely
 */
function decryptText(encryptedText) {
  if (!encryptedText) return encryptedText;
  try {
    if (encryptedText.startsWith('gcm1:')) {
      const [,nonce,tag,data] = encryptedText.split(':');
      const cipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY || '', 'hex'), Buffer.from(nonce, 'hex'));
      cipher.setAuthTag(Buffer.from(tag, 'hex'));
      return Buffer.concat([cipher.update(Buffer.from(data, 'hex')), cipher.final()]).toString('utf8');
    }
    const textParts = encryptedText.split(':');
    if (textParts.length !== 2) return encryptedText; // Probably not encrypted with this method
    
    const iv = Buffer.from(textParts[0], 'hex');
    const encryptedTextContent = Buffer.from(textParts[1], 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedTextContent, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('[Decryption Error]:', error.message);
    throw new Error('Failed to decrypt data');
  }
}

module.exports = {
  encryptText,
  decryptText
};
