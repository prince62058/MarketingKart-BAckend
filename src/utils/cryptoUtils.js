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
