// Full message.js (Complete and updated version with thumbnail generation, mode support for text/media only, and fixed to send only media without text when mode='media'; cross-checked with official Baileys docs)
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const { promisify } = require('util');
const { sleep } = require('./utils');

const unlinkAsync = promisify(fs.unlink);

// Generate image thumbnail buffer using sharp
async function generateImageThumbnail(imagePath) {
  try {
    return await sharp(imagePath)
      .resize(96, 96)
      .jpeg({ quality: 60 })
      .toBuffer();
  } catch (err) {
    console.error('Error generating image thumbnail:', err);
    return null;
  }
}

// Generate video thumbnail buffer using ffmpeg
function generateVideoThumbnail(videoPath) {
  return new Promise((resolve, reject) => {
    const tempThumbPath = path.join(__dirname, 'temp_thumbnail.jpg');

    ffmpeg(videoPath)
      .on('error', err => {
        reject(err);
      })
      .on('end', async () => {
        try {
          const thumbBuffer = await fs.promises.readFile(tempThumbPath);
          await unlinkAsync(tempThumbPath);
          resolve(thumbBuffer);
        } catch (readErr) {
          reject(readErr);
        }
      })
      // Take a snapshot at 1 second for better preview
      .screenshots({
        count: 1,
        timemarks: ['00:00:01.000'],
        size: '96x96',
        filename: 'temp_thumbnail.jpg',
        folder: __dirname,
      });
  });
}

// Helper to build Baileys media message payload with thumbnails
async function buildPayload(ext, mediaPath, addCaption, caption) {
  if (['.jpg', '.jpeg', '.png'].includes(ext)) {
    const thumb = await generateImageThumbnail(mediaPath);
    return { 
      image: fs.readFileSync(mediaPath), 
      caption: addCaption ? caption : undefined,
      jpegThumbnail: thumb || undefined,
    };
  }

  if (ext === '.mp4') {
    let thumb = null;
    try {
      thumb = await generateVideoThumbnail(mediaPath);
    } catch (err) {
      console.warn('Failed to generate video thumbnail:', err.message);
    }
    const isGif = path.basename(mediaPath).toLowerCase().includes('gif');
    return {
      video: fs.readFileSync(mediaPath),
      caption: addCaption ? caption : undefined,
      gifPlayback: isGif,
      ptv: false,
      jpegThumbnail: thumb || undefined,
    };
  }

  if (ext === '.mp3' || ext === '.ogg') {
    // For audios, no thumbnail and no caption
    return {
      audio: fs.createReadStream(mediaPath),
      mimetype: 'audio/ogg',
    };
  }
  
  return null; // unsupported file type
}

// Main sending function: sends text + all media in assets to all contacts
async function sendMessages(sock, contacts, formatMessage, mode = 'all') {
  // mode: 'text', 'media', 'all'
  const mediaDir = path.join(__dirname, 'assets');

  let mediaFiles = [];
  try {
    mediaFiles = fs.readdirSync(mediaDir).filter(f =>
      ['.jpg', '.jpeg', '.png', '.mp4', '.mp3', '.ogg'].includes(path.extname(f).toLowerCase())
    );
  } catch (err) {
    console.error('Error reading assets folder:', err.message);
  }

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
      if (!(number.length === 12 && number.startsWith('91'))) throw new Error('Invalid number format');
    } catch (err) {
      console.warn(`Skipping invalid number: ${row.Number} (${err.message})`);
      failureCount++;
      failedNumbers.push(row.Number);
      continue;
    }

    const jid = `${number}@s.whatsapp.net`;

    const text = formatMessage(row);
    console.log(`Sending to ${number} (mode: ${mode}): ${text.length > 50 ? text.substr(0, 50) + '...' : text}`);

    let allSent = true;
    let captionAdded = false;

    if (mode === 'text' || (mode === 'all' && mediaFiles.length === 0)) {
      try {
        await sock.sendMessage(jid, { text });
        console.log(`Sent text message to ${number}`);
      } catch (error) {
        console.error(`Error sending text to ${number}: ${error.message}`);
        allSent = false;
        details.push({ number, error: error.message });
      }
    }

    if (mode === 'media' || mode === 'all') {
      if (mediaFiles.length === 0) {
        console.log(`No media to send for ${number} in mode ${mode}`);
        if (mode === 'media') allSent = false; // Mark as failure if media mode but no media
      } else {
        for (let i = 0; i < mediaFiles.length; i++) {
          const file = mediaFiles[i];
          const ext = path.extname(file).toLowerCase();
          const mediaPath = path.join(mediaDir, file);

          let payload = null;
          try {
            payload = await buildPayload(ext, mediaPath, (mode === 'all' && !captionAdded), text); // Caption only in 'all' mode
          } catch (error) {
            console.warn(`Failed to build payload for ${file}: ${error.message}`);
            continue;
          }
          if (!payload) {
            console.warn(`Skipping unsupported media type for ${file}`);
            continue;
          }

          try {
            await sock.sendMessage(jid, payload);
            console.log(`Sent media ${file}${payload.caption ? ' (with caption)' : ''} to ${number}`);
            captionAdded = true;
            await sleep(1000); // Small delay between media sends
          } catch (error) {
            console.error(`Error sending media ${file} to ${number}: ${error.message}`);
            allSent = false;
            details.push({ number, file, error: error.message });
          }
        }
      }
    }

    if (allSent) {
      successCount++;
      successNumbers.push(number);
    } else {
      failureCount++;
      failedNumbers.push(number);
    }

    await sleep(1500 + Math.floor(Math.random() * 1000)); // Delay between contacts
  }

  console.log(`Sending complete: Success=${successCount}, Failed=${failureCount}`);
  return { successCount, failureCount, successNumbers, failedNumbers, details };
}

module.exports = { sendMessages };
