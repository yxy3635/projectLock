const express = require('express');
const cors = require('cors');
const multer = require('multer');
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const obfuscator = require('javascript-obfuscator');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getAllFiles(rootDir, fileList = []) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      getAllFiles(fullPath, fileList);
    } else {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

function injectScriptTagIntoHtml(htmlContent, scriptPath) {
  const normalizedScriptTag = `<script defer src="${scriptPath}"></script>`;
  if (htmlContent.includes(normalizedScriptTag)) {
    return htmlContent;
  }

  if (/<\/head>/i.test(htmlContent)) {
    return htmlContent.replace(/<\/head>/i, `${normalizedScriptTag}\n</head>`);
  }
  if (/<\/body>/i.test(htmlContent)) {
    return htmlContent.replace(/<\/body>/i, `${normalizedScriptTag}\n</body>`);
  }

  return `${normalizedScriptTag}\n${htmlContent}`;
}

function generateFrontLockRuntime(expireDateStr, customMessage) {
  const safeMessage = JSON.stringify(customMessage || '项目已到期，请联系开发者续期。');
  const safeExpireDate = JSON.stringify(expireDateStr);

  const code = `
    ;(() => {
      const EXPIRE_TS = new Date(${safeExpireDate}).getTime();
      const EXPIRED_MESSAGE = ${safeMessage};
      const KEY = '__PROJECT_LOCK_EXPIRED__';

      const showExpiredPage = () => {
        if (window[KEY]) return;
        window[KEY] = true;
        const escaped = String(EXPIRED_MESSAGE)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');

        const html = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f172a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,PingFang SC,Microsoft YaHei,sans-serif;padding:20px;box-sizing:border-box;">'
          + '<div style="max-width:760px;width:100%;background:#111827;border:1px solid #334155;border-radius:16px;padding:32px;box-shadow:0 20px 60px rgba(0,0,0,.35);">'
          + '<h1 style="margin:0 0 12px;font-size:28px;line-height:1.2;">项目授权已到期</h1>'
          + '<p style="margin:0;font-size:16px;line-height:1.8;white-space:pre-wrap;">' + escaped + '</p>'
          + '</div></div>';

        document.documentElement.innerHTML = '<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;">' + html + '</body>';

        const deny = () => Promise.reject(new Error('Project expired'));
        window.fetch = deny;
        window.XMLHttpRequest = function BlockedXHR() {
          throw new Error('Project expired');
        };
        history.pushState = () => {};
        history.replaceState = () => {};
        window.addEventListener('popstate', () => {
          location.hash = '';
        });
      };

      const getBeijingTime = async () => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3500);
          const res = await fetch('https://worldtimeapi.org/api/timezone/Asia/Shanghai', {
            cache: 'no-store',
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (!res.ok) throw new Error('Time API failed');
          const data = await res.json();
          const ts = new Date(data.datetime).getTime();
          if (Number.isNaN(ts)) throw new Error('Invalid time payload');
          return ts;
        } catch (err) {
          return Date.now();
        }
      };

      const boot = async () => {
        if (!Number.isFinite(EXPIRE_TS)) return;
        const nowTs = await getBeijingTime();
        if (nowTs > EXPIRE_TS) {
          showExpiredPage();
        }
      };

      boot();
    })();
  `;

  return obfuscator.obfuscate(code, {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    numbersToExpressions: true,
    simplify: true,
    stringArrayShuffle: true,
    splitStrings: true,
    stringArrayThreshold: 1
  }).getObfuscatedCode();
}

app.post('/api/lock', upload.single('project'), async (req, res) => {
  let tempExtractPath = '';
  let outZipPath = '';

  try {
    const { expireDate, message } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).send('No file uploaded.');
    }
    if (!expireDate) {
      return res.status(400).send('Expire date is required.');
    }

    ensureDir(path.join(__dirname, 'temp'));
    tempExtractPath = path.join(__dirname, 'temp', crypto.randomBytes(8).toString('hex'));
    ensureDir(tempExtractPath);

    const zip = new AdmZip(file.path);
    zip.extractAllTo(tempExtractPath, true);

    const runtimeName = 'project-lock.runtime.js';
    const runtimePath = path.join(tempExtractPath, runtimeName);
    fs.writeFileSync(runtimePath, generateFrontLockRuntime(expireDate, message), 'utf8');

    const allFiles = getAllFiles(tempExtractPath);
    const htmlFiles = allFiles.filter((filePath) => filePath.toLowerCase().endsWith('.html'));

    if (htmlFiles.length === 0) {
      return res.status(400).send('Uploaded package does not contain HTML entry pages.');
    }

    for (const htmlPath of htmlFiles) {
      const htmlDir = path.dirname(htmlPath);
      const relativeScriptPath = path.relative(htmlDir, runtimePath).replace(/\\\\/g, '/');
      const scriptPathForHtml = relativeScriptPath.startsWith('.') ? relativeScriptPath : `./${relativeScriptPath}`;

      const htmlContent = fs.readFileSync(htmlPath, 'utf8');
      const patchedHtml = injectScriptTagIntoHtml(htmlContent, scriptPathForHtml);
      fs.writeFileSync(htmlPath, patchedHtml, 'utf8');
    }

    const outZip = new AdmZip();
    outZip.addLocalFolder(tempExtractPath);
    outZipPath = path.join(__dirname, 'temp', crypto.randomBytes(8).toString('hex') + '.zip');
    outZip.writeZip(outZipPath);

    res.download(outZipPath, 'locked_project.zip', () => {
      if (tempExtractPath && fs.existsSync(tempExtractPath)) {
        fs.rmSync(tempExtractPath, { recursive: true, force: true });
      }
      if (file.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      if (outZipPath && fs.existsSync(outZipPath)) {
        fs.unlinkSync(outZipPath);
      }
    });
  } catch (error) {
    console.error(error);
    if (tempExtractPath && fs.existsSync(tempExtractPath)) {
      fs.rmSync(tempExtractPath, { recursive: true, force: true });
    }
    if (outZipPath && fs.existsSync(outZipPath)) {
      fs.unlinkSync(outZipPath);
    }
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).send('Internal Server Error');
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
