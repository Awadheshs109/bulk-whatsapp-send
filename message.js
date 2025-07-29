// Full message.js (Cross-checked and updated with official Baileys docs: Exact match for image, video (with ptv), GIF (gifPlayback), audio (mimetype); added detailed logging for every step; media now independent from Excel - loads all files from assets and sends to every contact as separate messages)
const fs = require('fs');
const path = require('path');
const { sleep } = require('./utils');


// Now returns lists of numbers for success/failure
async function sendMessages(sock, data, customGenerateMessage) {
  let successCount = 0, failureCount = 0;
  let successNumbers = [], failedNumbers = [], details = [];

  // Load all media files from assets folder (independent from Excel)
  let mediaFiles = [];
  try {
    mediaFiles = fs.readdirSync('assets').filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.mp4' || ext === '.mp3' || ext === '.ogg';
    });
    console.log(`[LOG] Loaded ${mediaFiles.length} media files from assets folder independently: ${mediaFiles}`);
  } catch (err) {
    console.error(`[ERROR] Failed to load media from assets: ${err.message}`);
  }

  for (const row of data) {
    let number;
    try {
      number = row.Number.toString().replace(/[^0-9]/g, '');
      if (number.length === 10) number = '91' + number;
      if (number.length !== 12 || !number.startsWith('91')) throw new Error('Bad mobile number');
      console.log(`[LOG] Processing number: ${number}`);
    } catch (err) { 
      console.error(`[ERROR] Failed to parse number for row ${JSON.stringify(row)}: ${err.message}`);
      failedNumbers.push(row.Number || ''); 
      continue; 
    }
    const jid = `${number}@s.whatsapp.net`;
    let msg = customGenerateMessage ? customGenerateMessage(row) : 'Hi';
    console.log(`[LOG] Generated message for ${number}: ${msg.substring(0, 50)}...`);

    // Send text message first (independent of media)
    let allSent = true;
    try {
      await sock.sendMessage(jid, { text: msg });
      console.log(`[SUCCESS] Sent text message to ${number}`);
    } catch (error) {
      console.error(`[ERROR] Failed to send text to ${number}: ${error.message}`);
      allSent = false;
      details.push({ number, status: 'fail', error: error.message });
    }

    // Send each media file from assets as a separate message (independent from Excel)
    for (let file of mediaFiles) {
      const mediaPath = path.join('assets', file);
      const ext = path.extname(file).toLowerCase();
      try {
        if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') {
          // Image Message (exact official docs)
          await sock.sendMessage(jid, { image: { url: mediaPath }, caption: msg });
          console.log(`[SUCCESS] Sent image ${file} to ${number}`);
        } else if (ext === '.mp4') {
          // Video or GIF Message (exact official docs: gifPlayback for GIFs if filename includes 'gif', ptv false)
          const isGif = file.toLowerCase().includes('gif');
          await sock.sendMessage(jid, { video: { url: mediaPath }, caption: msg, gifPlayback: isGif, ptv: false });
          console.log(`[SUCCESS] Sent ${isGif ? 'GIF' : 'video'} ${file} to ${number}`);
        } else if (ext === '.mp3' || ext === '.ogg') {
          // Audio Message (exact official docs: mimetype 'audio/mp4')
          await sock.sendMessage(jid, { audio: { url: mediaPath }, mimetype: 'audio/mp4' });
          console.log(`[SUCCESS] Sent audio ${file} to ${number}`);
        } else {
          console.warn(`[WARN] Unsupported media type: ${ext} for file ${file} - skipped for ${number}`);
          continue; // Skip unsupported
        }
      } catch (error) {
        console.error(`[ERROR] Failed to send media ${file} to ${number}: ${error.message}`);
        allSent = false;
        details.push({ number, status: 'fail', error: error.message, file });
      }
      await sleep(1000); // Small delay between media sends
    }


    if (allSent) {
      successCount++; successNumbers.push(number);
      details.push({ number, status: 'success' });
      console.log(`[SUCCESS] All text and media from assets sent to ${number}`);
    } else {
      failureCount++; failedNumbers.push(number);
      console.log(`[ERROR] Failed to send some text/media to ${number}`);
    }
    await sleep(Math.floor(Math.random() * 2000) + 1000); // Delay between contacts
  }
  console.log(`[SUMMARY] Sending complete: Success: ${successCount}, Failed: ${failureCount}`);
  return { successCount, failureCount, successNumbers, failedNumbers, details };
}


module.exports = { sendMessages };
