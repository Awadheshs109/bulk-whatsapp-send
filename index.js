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

// Ensure assets folder exists
if (!fs.existsSync(ASSET_FOLDER)) fs.mkdirSync(ASSET_FOLDER);

// Multer config: accepts jpg, jpeg, png, mp4, mp3, ogg; max 20MB; preserves filename with suffix for duplicates
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ASSET_FOLDER),
  filename: (req, file, cb) => {
    let filename = file.originalname;
    let ext = path.extname(filename);
    let base = path.basename(filename, ext);
    let counter = 0;
    while (fs.existsSync(path.join(ASSET_FOLDER, filename))) {
      counter++;
      filename = `${base} (${counter})${ext}`;
    }
    cb(null, filename);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'video/mp4',
      'audio/mpeg',
      'audio/ogg',
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only jpg, jpeg, png, mp4, mp3, ogg files allowed!'));
  },
});

const app = express();
app.set('view engine', 'ejs');
app.use(express.static(ASSET_FOLDER));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let contactsData = [];
let sock = null;

function loadContacts() {
  if (!fs.existsSync(CONTACTS_XLSX)) {
    console.warn('contacts.xlsx not found');
    return [];
  }
  const workbook = XLSX.readFile(CONTACTS_XLSX);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);
  console.log(`Loaded ${data.length} contacts from XLSX`);
  return data;
}

contactsData = loadContacts();
setInterval(() => {
  contactsData = loadContacts();
}, 30000);

(async () => {
  sock = await connectToWhatsApp();
  console.log('WhatsApp socket connected and ready.');
})();

// Routes

app.get('/', (req, res) => {
  res.render('index', { contacts: contactsData });
});

app.get('/api/contacts', (req, res) => {
  res.json(contactsData);
});

app.get('/api/media', (req, res) => {
  fs.readdir(ASSET_FOLDER, (err, files) => {
    if (err) {
      console.error('Error listing media:', err);
      return res.json([]);
    }
    const filtered = files.filter((file) =>
      ['.jpg', '.jpeg', '.png', '.mp4', '.mp3', '.ogg'].includes(
        path.extname(file).toLowerCase()
      )
    );
    res.json(filtered);
  });
});

app.post('/api/upload', upload.array('mediaFiles', 20), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.json({ ok: false, message: 'No files uploaded' });
  }
  console.log('Uploaded files:', req.files.map(f => f.filename));
  res.json({ ok: true, files: req.files.map(f => f.filename) });
});

// Delete media file
app.delete('/api/media/:file', (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.file);
    if (filename.includes('\0') || filename.includes('..')) {
      console.warn('Blocked path traversal:', filename);
      return res.status(400).json({ ok: false, message: 'Invalid filename' });
    }
    const fullPath = path.resolve(ASSET_FOLDER, filename);
    if (!fullPath.startsWith(path.resolve(ASSET_FOLDER))) {
      console.warn('Blocked outside folder path:', fullPath);
      return res.status(400).json({ ok: false, message: 'Invalid path' });
    }
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ ok: false, message: 'File does not exist' });
    }
    fs.unlink(fullPath, (err) => {
      if (err) {
        console.error('Delete error:', err);
        return res.status(500).json({ ok: false, message: 'Could not delete file' });
      }
      console.log('Deleted file:', filename);
      res.json({ ok: true });
    });
  } catch (e) {
    console.error('Delete handler error:', e);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
});

app.post('/api/send-messages', async (req, res) => {
  const template = req.body.messageTemplate || '';
  const formatMessage = (row) => template.replace(/{name}/g, row.Name || '');
  if (!sock) {
    return res.status(500).json({ ok: false, message: 'WhatsApp not connected' });
  }
  const { successCount, failureCount, successNumbers, failedNumbers, details } =
    await sendMessages(sock, contactsData, formatMessage);

  res.json({
    ok: true,
    summary: { total: contactsData.length, success: successCount, failed: failureCount },
    successNumbers,
    failedNumbers,
    details,
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
