const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const localUploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');
const localPrivateSupportCaseDir = path.join(__dirname, '..', '..', 'data', 'private', 'support-case-files');
const storageDriver = (process.env.STORAGE_DRIVER || 'local').trim().toLowerCase();
const PRIVATE_SUPPORT_CASE_PREFIX = 'private-support://';

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureLocalUploadsDir() {
  ensureDir(localUploadsDir);
}

function getExtension(file) {
  return path.extname(file.originalname || '').toLowerCase() || '.jpg';
}

function createFilename(file) {
  return `${Date.now()}-${randomUUID()}${getExtension(file)}`;
}

async function saveLocalFile(file, subfolder = '') {
  ensureLocalUploadsDir();
  const targetDir = subfolder ? path.join(localUploadsDir, subfolder) : localUploadsDir;
  ensureDir(targetDir);
  const filename = createFilename(file);
  const destination = path.join(targetDir, filename);
  await fs.promises.writeFile(destination, file.buffer);
  return subfolder ? `/uploads/${subfolder}/${filename}` : `/uploads/${filename}`;
}

function createS3Client() {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION || 'us-east-1';
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('S3 storage requires S3_ENDPOINT, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.');
  }

  return new S3Client({
    region,
    endpoint,
    forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || 'true') !== 'false',
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

function buildS3PublicUrl(key) {
  const explicitBase = String(process.env.S3_PUBLIC_BASE_URL || '').trim();
  if (explicitBase) {
    return `${explicitBase.replace(/\/$/, '')}/${key}`;
  }

  const endpoint = String(process.env.S3_ENDPOINT || '').trim().replace(/\/$/, '');
  const bucket = String(process.env.S3_BUCKET || '').trim();
  if (!endpoint || !bucket) {
    throw new Error('S3 storage requires S3_BUCKET and either S3_PUBLIC_BASE_URL or S3_ENDPOINT.');
  }

  return `${endpoint}/${bucket}/${key}`;
}

async function saveS3File(file, folder) {
  const bucket = String(process.env.S3_BUCKET || '').trim();
  if (!bucket) {
    throw new Error('S3 storage requires S3_BUCKET.');
  }

  const key = `${folder}/${createFilename(file)}`;
  const client = createS3Client();

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype || 'application/octet-stream',
  }));

  return buildS3PublicUrl(key);
}

async function saveJobPhoto(file) {
  if (!file || !file.buffer) {
    throw new Error('Uploaded file buffer missing.');
  }

  if (storageDriver === 's3') {
    const folder = String(process.env.S3_UPLOAD_PREFIX || 'job-photos').trim().replace(/^\/+|\/+$/g, '');
    return saveS3File(file, folder);
  }

  return saveLocalFile(file);
}

async function savePrivateLocalSupportCaseFile(file) {
  ensureDir(localPrivateSupportCaseDir);
  const filename = createFilename(file);
  const destination = path.join(localPrivateSupportCaseDir, filename);
  await fs.promises.writeFile(destination, file.buffer);
  return `${PRIVATE_SUPPORT_CASE_PREFIX}${filename}`;
}

async function saveSupportCaseAttachment(file) {
  if (!file || !file.buffer) {
    throw new Error('Uploaded file buffer missing.');
  }

  if (storageDriver === 's3') {
    const folder = String(process.env.S3_SUPPORT_CASE_PREFIX || 'support-case-files').trim().replace(/^\/+|\/+$/g, '');
    return saveS3File(file, folder);
  }

  return savePrivateLocalSupportCaseFile(file);
}

function getSupportCaseAttachmentLocalPath(storedUrl) {
  const value = String(storedUrl || '').trim();
  if (!value) return null;

  if (value.startsWith(PRIVATE_SUPPORT_CASE_PREFIX)) {
    const filename = value.slice(PRIVATE_SUPPORT_CASE_PREFIX.length);
    if (!filename) return null;
    return path.join(localPrivateSupportCaseDir, path.basename(filename));
  }

  const publicSupportPrefix = '/uploads/support-case-files/';
  if (value.startsWith(publicSupportPrefix)) {
    const filename = value.slice(publicSupportPrefix.length);
    if (!filename) return null;
    return path.join(localUploadsDir, 'support-case-files', path.basename(filename));
  }

  return null;
}

module.exports = {
  saveJobPhoto,
  saveSupportCaseAttachment,
  getSupportCaseAttachmentLocalPath,
  storageDriver,
};
