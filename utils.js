// File 4: utils.js (Utility functions like sleep and crypto polyfill)
// No changes needed
const nodeCrypto = require('crypto');

// Polyfill for crypto to avoid "crypto is not defined" error
if (!global.crypto) {
  global.crypto = {
    getRandomValues: (array) => nodeCrypto.randomFillSync(array),
  };
}

// Sleep function for delays
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { sleep };
