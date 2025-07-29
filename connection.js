// File 2: connection.js (Updated: Removed intentional close flag since we keep connection open; adjusted reconnection)
const qrcode = require('qrcode-terminal');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('baileys');
const pino = require('pino');
const { sleep } = require('./utils');

// Function to connect to WhatsApp and return the socket once connected (keep open indefinitely)
async function connectToWhatsApp() {
  // Auth state
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  // Promise to resolve when connection is open
  let connectionResolve;
  const connectionPromise = new Promise((resolve) => {
    connectionResolve = resolve;
  });

  // Inner function to create and connect socket
  const createSocket = () => {
    const sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: Browsers.macOS('Desktop'), // As per docs for better compatibility
      markOnlineOnConnect: false, // Avoid marking online if not needed
    });

    // Handle creds update
    sock.ev.on('creds.update', saveCreds);

    // Handle connection updates
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrcode.generate(qr, { small: true });
        console.log('Scan the QR code above to login');
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        let reason = 'Unknown';
        
        if (statusCode) {
          reason = `Status code: ${statusCode} - ${DisconnectReason[statusCode] || 'Unknown'}`;
        } else if (lastDisconnect?.error) {
          reason = lastDisconnect.error.message || 'No error message';
        }
        
        console.log(`Connection closed due to: ${reason}`);

        // Reconnect on temporary errors; do not close unexpectedly unless logged out
        if (statusCode === DisconnectReason.restartRequired || statusCode === 428 /* connectionClosed */) {
          console.log('Temporary disconnect detected, reconnecting...');
          await sleep(2000); // Wait 2 seconds before retrying
          createSocket(); // Reconnect by creating a new socket
        } else if (statusCode === DisconnectReason.loggedOut) {
          console.log('Logged out. Please delete the "auth_info_baileys" folder and scan the QR code again to re-authenticate.');
          process.exit(1);
        } // No else: Keep trying or log without exiting
      } else if (connection === 'open') {
        console.log('Connected successfully to WhatsApp');
        connectionResolve(sock); // Resolve the promise with the connected socket
      }
    });

    return sock;
  };

  createSocket(); // Start the connection process
  return connectionPromise; // Await until 'open' event
}

module.exports = { connectToWhatsApp };
