const Account = require('../models/whatsappAccountModel');

async function assertUniquePhone(phoneNumberId, Model = Account) {
  const accounts = await Model.find({ phoneNumberId }).limit(2);
  if (accounts.length !== 1 || accounts[0].status !== 'CONNECTED') {
    throw new Error('WhatsApp number ownership is ambiguous or disconnected. Connect your own number or contact support.');
  }
  const account = accounts[0];
  if (account.tokenExpiresAt && new Date(account.tokenExpiresAt).getTime() <= Date.now()) {
    throw new Error('WhatsApp authorization expired. Connect your number again.');
  }
  return account;
}
module.exports = { assertUniquePhone };
