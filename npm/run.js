#!/usr/bin/env node

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const https = require('https');

// Dynamically read version from package.json so it always matches the GitHub Release tag
const VERSION = 'v' + require('../package.json').version;
const REPO = 'VishalRaut2106/go-gatekeeper';

const platform = os.platform();
const arch = os.arch();

let binName = 'gatekeeper-';
if (platform === 'win32') {
  binName += 'windows-amd64.exe';
} else if (platform === 'linux') {
  binName += 'linux-amd64';
} else if (platform === 'darwin') {
  binName += arch === 'arm64' ? 'darwin-arm64' : 'darwin-amd64';
} else {
  console.error(`Unsupported platform: ${platform} ${arch}`);
  process.exit(1);
}

const binPath = path.join(__dirname, platform === 'win32' ? 'gatekeeper.exe' : 'gatekeeper');
const versionMarkerPath = binPath + '.version';
const downloadUrl = `https://github.com/${REPO}/releases/download/${VERSION}/${binName}`;
const checksumsUrl = `https://github.com/${REPO}/releases/download/${VERSION}/checksums.txt`;

function fetchToFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    function get(url) {
      https.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          if (!res.headers.location) {
            reject(new Error('Redirect with no location header'));
            return;
          }
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) {
          fs.unlink(destPath, () => {});
          reject(new Error(`Failed to download ${url}: ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }
    get(url);
  });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    function get(url) {
      https.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          if (!res.headers.location) {
            reject(new Error('Redirect with no location header'));
            return;
          }
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to fetch ${url}: ${res.statusCode}`));
          return;
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      }).on('error', reject);
    }
    get(url);
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function verifyChecksum(filePath, expectedName) {
  const checksumsText = await fetchText(checksumsUrl);
  const escapedName = expectedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lineRegex = new RegExp(`^[0-9a-f]{64}\\s+\\*?${escapedName}$`);
  const line = checksumsText
    .split('\n')
    .map((l) => l.trim())
    .find((l) => lineRegex.test(l));
  if (!line) {
    throw new Error(`No checksum entry found for ${expectedName} in checksums.txt`);
  }
  const expectedHash = line.trim().split(/\s+/)[0];
  const actualHash = await sha256File(filePath);
  if (expectedHash !== actualHash) {
    throw new Error(
      `Checksum mismatch for ${expectedName}: expected ${expectedHash}, got ${actualHash}`
    );
  }
}

async function downloadBinary() {
  console.log(`Downloading gatekeeper ${VERSION} for ${platform}-${arch}...`);
  await fetchToFile(downloadUrl, binPath);

  try {
    await verifyChecksum(binPath, binName);
  } catch (e) {
    fs.unlink(binPath, () => {});
    throw new Error(`Integrity verification failed, binary removed: ${e.message}`);
  }

  console.log('Checksum verified.');
  // Windows doesn't use POSIX executable permission bits
  if (platform !== 'win32') {
    fs.chmodSync(binPath, 0o755);
  }
  fs.writeFileSync(versionMarkerPath, VERSION);
}

function needsDownload() {
  if (!fs.existsSync(binPath)) return true;
  if (!fs.existsSync(versionMarkerPath)) return true; // pre-upgrade cached binary, no marker yet
  const cachedVersion = fs.readFileSync(versionMarkerPath, 'utf8').trim();
  return cachedVersion !== VERSION;
}

async function main() {
  if (needsDownload()) {
    try {
      await downloadBinary();
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
  }

  const args = process.argv.slice(2);
  if (args.length === 0) {
    args.push('--server', 'wss://gatekeeper-relay.onrender.com/ws?role=host');
  }

  const child = spawn(binPath, args, { stdio: 'inherit' });
  child.on('exit', (code) => {
    process.exit(code);
  });
}

main();
