const fs = require('fs');
const path = require('path');
const { sleep } = require('./utils');

function buildPayload(ext, mediaPath, addCaption, caption) {
  if (['.jpg', '.jpeg', '.png'].includes(ext)) {
    return { image: fs.readFileSync(mediaPath), caption: addCaption ? caption : undefined };
  }
  if (ext === '.mp4') {
    const isGif = path.basename(mediaPath).toLowerCase().includes('gif');
    return {
      video: fs.readFileSync(mediaPath),
      caption: addCaption ? caption : undefined,
      gifPlayback: isGif,
      ptv: false,
    };
  }
  if (['.mp3', '.ogg'].includes(ext)) {
    return { audio: { stream: fs.createReadStream(mediaPath) }, mimetype: 'audio/ogg' };
  }
  return null;
}

async function sendMessages(sock, contacts, formatMessage) {
  const mediaFiles = fs
    .readdirSync('assets')
    .filter((f) =>
      ['.jpg', '.jpeg', '.png', '.mp4', '.mp3', '.ogg'].includes(path.extname(f).toLowerCase())
    );

  console.log(`Media files found: ${mediaFiles.join(', ')}`);

  let successCount = 0;
  let failureCount = 0;
  const successNumbers = [];
  const failedNumbers = [];
  const details = [];

  for (const row of contacts) {
    let number;

    try {
      number = row.Number.toString().replace(/\D/g, '');
      if (number.length === 10) number = '91' + number;
      if (!(number.length === 12 && number.startsWith('91'))) throw new Error('Invalid number');
    } catch (err) {
      console.error(`Skipping invalid number: ${row.Number}`, err.message);
      failureCount++;
      failedNumbers.push(row.Number);
      continue;
    }

    const jid = `${number}@s.whatsapp.net`;
    let text = formatMessage(row);
    console.log(`Sending to ${number}: "${text.slice(0, 30)}..."`);

    let allSent = true;
    let captionUsed = false;

    if (mediaFiles.length > 0) {
      for (const file of mediaFiles) {
        const mediaPath = path.join('assets', file);
        const ext = path.extname(file).toLowerCase();
        const payload = buildPayload(ext, mediaPath, !captionUsed, text);

        if (!payload) {
          console.warn(`Skipping unsupported file type: ${file}`);
          continue;
        }

        try {
          await sock.sendMessage(jid, payload);
          console.log(`Sent ${file} ${captionUsed ? '' : '(with caption)'}`);
          captionUsed = true;
          await sleep(1000);
        } catch (err) {
          console.error(`Failed sending ${file} to ${number}:`, err.message);
          allSent = false;
          details.push({ number, file, error: err.message });
        }
      }
    }

    if (!captionUsed) {
      // Send only text when no media sent
      try {
        await sock.sendMessage(jid, { text });
        console.log(`Sent text message to ${number}`);
      } catch (err) {
        console.error(`Failed sending text to ${number}:`, err.message);
        allSent = false;
        details.push({ number, error: err.message });
      }
    }

    if (allSent) {
      successCount++;
      successNumbers.push(number);
    } else {
      failureCount++;
      failedNumbers.push(number);
    }
  }

  console.log(`Sending complete — Success: ${successCount}, Failed: ${failureCount}`);
  return { successCount, failureCount, successNumbers, failedNumbers, details };
}

module.exports = { sendMessages };
