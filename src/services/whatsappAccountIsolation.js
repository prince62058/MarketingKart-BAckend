const Account = require('../models/whatsappAccountModel');

async function assertUniquePhone(phoneNumberId, Model = Account) {
  // Only CONNECTED rows count — a leftover DISCONNECTED row for the same
  // phoneNumberId must not block sends after the number was reassigned.
  const accounts = await Model.find({ phoneNumberId, status: 'CONNECTED' }).limit(2);
  if (accounts.length === 0) {
    throw new Error('WhatsApp number ownership is ambiguous or disconnected. Connect your own number or contact support.');
  }
  if (accounts.length !== 1) {
    throw new Error('WhatsApp number ownership is ambiguous or disconnected. Connect your own number or contact support.');
  }
  const account = accounts[0];
  if (account.tokenExpiresAt && new Date(account.tokenExpiresAt).getTime() <= Date.now()) {
    throw new Error('WhatsApp authorization expired. Connect your number again.');
  }
  return account;
}
module.exports = { assertUniquePhone };
