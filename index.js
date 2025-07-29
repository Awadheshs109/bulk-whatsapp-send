const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const multer = require('multer');
const { connectToWhatsApp } = require('./connection');
const { sendMessages } = require('./message');
const { sleep } = require('./utils');

const port = 3000;
const ASSET_FOLDER = './assets';
const CONTACTS_XLSX = './contacts.xlsx';

// --- Ensure assets dir exists ---
if (!fs.existsSync(ASSET_FOLDER)) fs.mkdirSync(ASSET_FOLDER);

// Multer config: .jpg, .png, .mp4, .mp3, .ogg only, max 20MB/file, allow multiple, preserve original name with suffix if duplicate
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ASSET_FOLDER),
  filename: (req, file, cb) => {
    let filename = file.originalname;
    let ext = path.extname(filename);
    let basename = path.basename(filename, ext);
    let suffix = 0;
    while (fs.existsSync(path.join(ASSET_FOLDER, filename))) {
      suffix++;
      filename = `${basename} (${suffix})${ext}`;
    }
    cb(null, filename); // Preserve original with suffix if needed
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'video/mp4', 'audio/mpeg', 'audio/ogg'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only .jpg, .png images, .mp4 videos/GIFs, .mp3/.ogg audio allowed!'));
  }
});

// --- Express ---
const app = express();
app.set('view engine', 'ejs');
app.use(express.static(ASSET_FOLDER));  // Serve media from assets/ for previews
app.use(express.static('public'));      // For static HTML/JS/CSS (if needed)
app.use(express.urlencoded({extended: true}));
app.use(express.json());

// --- GLOBALS ---
let contactsData = [];
let sock = null;

// --- Load contacts from XLSX ---
function loadContacts() {
  if (!fs.existsSync(CONTACTS_XLSX)) {
    console.warn('contacts.xlsx not found, returning empty list');
    return [];
  }
  const workbook = XLSX.readFile(CONTACTS_XLSX);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);
  console.log(`Loaded ${data.length} contacts from XLSX (Media column ignored, using assets folder independently)`);
  return data;
}
// Initial load
contactsData = loadContacts();
// Debounce: Reload contacts every 30s
setInterval(() => {
  contactsData = loadContacts();
}, 30000);

// --- WhatsApp socket ---
(async () => {
  sock = await connectToWhatsApp();
  console.log('WhatsApp socket connected and kept open.');
})();

// --- ROUTES ---
// Home page: renders table and media upload via AJAX
app.get('/', (req, res) => {
  console.log('Serving home page');
  res.render('index', { contacts: contactsData });
});

// API: get current contacts (AJAX table refresh every 30s)
app.get('/api/contacts', (req, res) => {
  console.log('API: Returning contacts data');
  res.json(contactsData);
});

// API: List uploaded media in assets/ (for UI display with previews)
app.get('/api/media', (req, res) => {
  fs.readdir(ASSET_FOLDER, (err, files) => {
    if (err) {
      console.error('Error listing media files:', err);
      return res.json([]);
    }
    const filtered = files.filter(f => f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.mp4') || f.endsWith('.mp3') || f.endsWith('.ogg'));
    console.log(`API: Returning ${filtered.length} media files from assets`);
    res.json(filtered);
  });
});

// API: Media upload (.jpg/.png/.mp4/.mp3/.ogg, multiple, AJAX, drag/drop)
app.post('/api/upload-media', upload.array('mediaFiles', 20), (req, res) => {
  if (!req.files || req.files.length === 0) {
    console.warn('No files uploaded in request');
    return res.json({ ok: false, message: 'No files' });
  }
  const uploadedFiles = req.files.map(f => f.filename);
  console.log('Uploaded files to assets:', uploadedFiles); // Proper log
  res.json({ ok: true, files: uploadedFiles });
});

// API: Delete a single media file from assets
app.delete('/api/media/:file', (req, res) => {
  const filename = req.params.file;
  const fullPath = path.join(ASSET_FOLDER, filename);
  
  // Security check: ensure the file is within assets folder
  if (!fullPath.startsWith(path.resolve(ASSET_FOLDER))) {
    console.error('Security violation: attempted path traversal');
    return res.status(400).json({ ok: false, message: 'Invalid file path' });
  }
  
  fs.unlink(fullPath, (err) => {
    if (err) {
      console.error('Delete error:', err);
      return res.status(500).json({ ok: false, message: 'Delete failed' });
    }
    console.log('Deleted media file:', filename);
    res.json({ ok: true, message: 'File deleted successfully' });
  });
});

// API: Send message to all contacts (frontend supplies messageTemplate string; media independent from Excel, sent from assets to all)
app.post('/api/send-messages', async (req, res) => {
  const template = req.body.messageTemplate || '';
  const mode = req.body.mode || 'all';
  console.log('API: Starting send-messages with template:', template.substring(0, 50) + '...');
  // Accept {name} replacement
  const customGenerateMessage = (row) => template.replace(/{name}/g, row.Name || ' ');
  if (!sock) {
    console.error('API: WhatsApp socket not connected');
    return res.status(500).json({ ok: false, message: "WhatsApp not connected" });
  }
  // messages.js: sendMessages(sock, contacts, customGenerateMessage)
  const { successCount, failureCount, successNumbers = [], failedNumbers = [], details = [] } = await sendMessages(sock, contactsData, customGenerateMessage, mode);
  console.log('API: Send completed - Success:', successCount, 'Failed:', failureCount);
  res.json({
    ok: true,
    summary: { total: contactsData.length, success: successCount, failed: failureCount },
    successNumbers, failedNumbers, details
  });
});

// --- START ---
app.listen(port, () => {
  console.log(`Bulk WhatsApp running at http://localhost:${port}`);
});
