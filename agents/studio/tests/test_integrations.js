import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  GoogleDriveIntegration,
  DropboxIntegration,
  OneDriveIntegration,
  AWSS3Integration,
  FigmaIntegration,
  CanvaIntegration,
  AdobeIntegration,
  BlenderIntegration,
  SlackIntegration,
  ZapierIntegration,
} from '../src/integrations.js';

// ─── GoogleDriveIntegration ────────────────────────────────────────

describe('GoogleDriveIntegration', () => {
  it('connect with valid credentials', () => {
    const gd = new GoogleDriveIntegration();
    const res = gd.connect({ clientId: 'id', clientSecret: 'secret' });
    assert.strictEqual(res.status, 'Connected');
    assert.strictEqual(res.service, 'GoogleDrive');
  });

  it('connect with invalid credentials throws', () => {
    const gd = new GoogleDriveIntegration();
    assert.throws(() => gd.connect({}), /Invalid Google Drive credentials/);
  });

  it('upload returns FileRef', () => {
    const gd = new GoogleDriveIntegration();
    gd.connect({ clientId: 'id', clientSecret: 'secret' });
    const ref = gd.upload('proj1', '/assets/scene.png');
    assert.strictEqual(ref.service, 'GoogleDrive');
    assert.strictEqual(ref.name, 'scene.png');
    assert.ok(ref.id);
  });

  it('upload when not connected throws', () => {
    const gd = new GoogleDriveIntegration();
    assert.throws(() => gd.upload('proj1', '/a.png'), /Not connected/);
  });

  it('download returns local path', () => {
    const gd = new GoogleDriveIntegration();
    gd.connect({ clientId: 'id', clientSecret: 'secret' });
    const ref = gd.upload('proj1', '/assets/scene.png');
    const path = gd.download(ref.id);
    assert.strictEqual(path, '/tmp/vireo/downloads/scene.png');
  });

  it('download unknown file throws', () => {
    const gd = new GoogleDriveIntegration();
    gd.connect({ clientId: 'id', clientSecret: 'secret' });
    assert.throws(() => gd.download('bad-id'), /File not found/);
  });

  it('listFiles returns files', () => {
    const gd = new GoogleDriveIntegration();
    gd.connect({ clientId: 'id', clientSecret: 'secret' });
    gd.upload('proj1', '/a.png');
    gd.upload('proj1', '/b.png');
    const list = gd.listFiles('proj1');
    assert.strictEqual(list.length, 2);
  });

  it('sync returns SyncResult', () => {
    const gd = new GoogleDriveIntegration();
    gd.connect({ clientId: 'id', clientSecret: 'secret' });
    gd.upload('proj1', '/a.png');
    const res = gd.sync('proj1');
    assert.strictEqual(res.synced, 1);
    assert.strictEqual(res.status, 'Synced');
  });
});

// ─── DropboxIntegration ────────────────────────────────────────────

describe('DropboxIntegration', () => {
  it('connect with valid credentials', () => {
    const db = new DropboxIntegration();
    const res = db.connect({ accessToken: 'token123' });
    assert.strictEqual(res.status, 'Connected');
  });

  it('connect without token throws', () => {
    const db = new DropboxIntegration();
    assert.throws(() => db.connect({}), /Invalid Dropbox credentials/);
  });

  it('upload and download', () => {
    const db = new DropboxIntegration();
    db.connect({ accessToken: 'token' });
    const ref = db.upload('proj1', '/videos/clip.mp4');
    assert.strictEqual(ref.name, 'clip.mp4');
    const path = db.download(ref.id);
    assert.strictEqual(path, '/tmp/vireo/downloads/clip.mp4');
  });

  it('getSharedLink returns URL', () => {
    const db = new DropboxIntegration();
    db.connect({ accessToken: 'token' });
    const ref = db.upload('proj1', '/doc.pdf');
    const link = db.getSharedLink(ref.id);
    assert.ok(link.includes('dropbox.com'));
  });

  it('listFiles filters by path prefix', () => {
    const db = new DropboxIntegration();
    db.connect({ accessToken: 'token' });
    db.upload('proj1', '/assets/a.png');
    db.upload('proj1', '/videos/b.mp4');
    const list = db.listFiles('/assets');
    assert.strictEqual(list.length, 1);
  });
});

// ─── OneDriveIntegration ───────────────────────────────────────────

describe('OneDriveIntegration', () => {
  it('connect succeeds', () => {
    const od = new OneDriveIntegration();
    const res = od.connect({ accessToken: 'token' });
    assert.strictEqual(res.status, 'Connected');
  });

  it('upload and download', () => {
    const od = new OneDriveIntegration();
    od.connect({ accessToken: 'token' });
    const ref = od.upload('proj1', '/docs/readme.md');
    assert.strictEqual(ref.service, 'OneDrive');
    const path = od.download(ref.id);
    assert.ok(path.includes('readme.md'));
  });

  it('listFiles filters', () => {
    const od = new OneDriveIntegration();
    od.connect({ accessToken: 'token' });
    od.upload('proj1', '/images/pic.jpg');
    od.upload('proj1', '/audio/song.mp3');
    assert.strictEqual(od.listFiles('/images').length, 1);
  });
});

// ─── AWSS3Integration ──────────────────────────────────────────────

describe('AWSS3Integration', () => {
  it('connect with valid credentials', () => {
    const s3 = new AWSS3Integration();
    const res = s3.connect({ accessKeyId: 'AKIAXXX', secretAccessKey: 'secret' });
    assert.strictEqual(res.status, 'Connected');
  });

  it('connect without keys throws', () => {
    const s3 = new AWSS3Integration();
    assert.throws(() => s3.connect({}), /Invalid AWS credentials/);
  });

  it('upload with bucket and key', () => {
    const s3 = new AWSS3Integration();
    s3.connect({ accessKeyId: 'a', secretAccessKey: 'b' });
    const ref = s3.upload('proj1', 'my-bucket', 'assets/image.png');
    assert.strictEqual(ref.bucket, 'my-bucket');
    assert.strictEqual(ref.key, 'assets/image.png');
  });

  it('download from bucket', () => {
    const s3 = new AWSS3Integration();
    s3.connect({ accessKeyId: 'a', secretAccessKey: 'b' });
    s3.upload('proj1', 'my-bucket', 'assets/image.png');
    const path = s3.download('my-bucket', 'assets/image.png');
    assert.ok(path.includes('image.png'));
  });

  it('listObjects filters by bucket and prefix', () => {
    const s3 = new AWSS3Integration();
    s3.connect({ accessKeyId: 'a', secretAccessKey: 'b' });
    s3.upload('proj1', 'bucket1', 'a/x.png');
    s3.upload('proj1', 'bucket1', 'b/y.png');
    s3.upload('proj1', 'bucket2', 'a/z.png');
    assert.strictEqual(s3.listObjects('bucket1', 'a/').length, 1);
    assert.strictEqual(s3.listObjects('bucket1').length, 2);
  });

  it('generatePresignedUrl returns URL', () => {
    const s3 = new AWSS3Integration();
    s3.connect({ accessKeyId: 'a', secretAccessKey: 'b' });
    const url = s3.generatePresignedUrl('bucket', 'key.txt');
    assert.ok(url.includes('s3.amazonaws.com'));
  });
});

// ─── FigmaIntegration ──────────────────────────────────────────────

describe('FigmaIntegration', () => {
  it('connect with token', () => {
    const fg = new FigmaIntegration();
    const res = fg.connect('figma-token');
    assert.strictEqual(res.status, 'Connected');
  });

  it('connect without token throws', () => {
    const fg = new FigmaIntegration();
    assert.throws(() => fg.connect(''), /Figma token required/);
  });

  it('importFrame returns ImportedFrame', () => {
    const fg = new FigmaIntegration();
    fg.connect('tok');
    const imp = fg.importFrame('file1', 'frame1');
    assert.strictEqual(imp.fileId, 'file1');
    assert.strictEqual(imp.frameId, 'frame1');
  });

  it('listFrames returns frames for file', () => {
    const fg = new FigmaIntegration();
    fg.connect('tok');
    fg.importFrame('file1', 'f1');
    fg.importFrame('file1', 'f2');
    fg.importFrame('file2', 'f3');
    assert.strictEqual(fg.listFrames('file1').length, 2);
  });

  it('exportFrame returns ExportFile', () => {
    const fg = new FigmaIntegration();
    fg.connect('tok');
    const exp = fg.exportFrame('file1', 'frame1', 'png');
    assert.strictEqual(exp.format, 'png');
    assert.ok(exp.path.includes('.png'));
  });
});

// ─── CanvaIntegration ──────────────────────────────────────────────

describe('CanvaIntegration', () => {
  it('connect succeeds', () => {
    const cv = new CanvaIntegration();
    const res = cv.connect({ apiKey: 'canva-key' });
    assert.strictEqual(res.status, 'Connected');
  });

  it('importDesign returns ImportedDesign', () => {
    const cv = new CanvaIntegration();
    cv.connect({ apiKey: 'key' });
    const imp = cv.importDesign('design123');
    assert.strictEqual(imp.designId, 'design123');
    assert.strictEqual(imp.service, 'Canva');
  });

  it('listDesigns returns all', () => {
    const cv = new CanvaIntegration();
    cv.connect({ apiKey: 'key' });
    cv.importDesign('d1');
    cv.importDesign('d2');
    assert.strictEqual(cv.listDesigns().length, 2);
  });

  it('exportDesign returns path', () => {
    const cv = new CanvaIntegration();
    cv.connect({ apiKey: 'key' });
    const exp = cv.exportDesign('d1', 'pdf');
    assert.ok(exp.path.includes('canva_d1.pdf'));
  });
});

// ─── AdobeIntegration ──────────────────────────────────────────────

describe('AdobeIntegration', () => {
  it('connect succeeds', () => {
    const ab = new AdobeIntegration();
    const res = ab.connect({ apiKey: 'adobe-key' });
    assert.strictEqual(res.status, 'Connected');
  });

  it('exportToPremiere returns AAV file', () => {
    const ab = new AdobeIntegration();
    ab.connect({ apiKey: 'key' });
    const res = ab.exportToPremiere('proj1');
    assert.ok(res.aavPath.includes('.aav'));
  });

  it('exportToAfterEffects returns AEP file', () => {
    const ab = new AdobeIntegration();
    ab.connect({ apiKey: 'key' });
    const res = ab.exportToAfterEffects('proj1');
    assert.ok(res.aepPath.includes('.aep'));
  });

  it('importFromPremiere returns Project', () => {
    const ab = new AdobeIntegration();
    ab.connect({ apiKey: 'key' });
    const proj = ab.importFromPremiere('/exports/premiere.prproj');
    assert.strictEqual(proj.service, 'AdobePremiere');
    assert.ok(proj.name.includes('premiere'));
  });
});

// ─── BlenderIntegration ────────────────────────────────────────────

describe('BlenderIntegration', () => {
  it('connect with endpoint', () => {
    const bl = new BlenderIntegration();
    const res = bl.connect('http://localhost:9090');
    assert.strictEqual(res.status, 'Connected');
  });

  it('importScene returns Scene', () => {
    const bl = new BlenderIntegration();
    bl.connect('http://localhost:9090');
    const scene = bl.importScene('/scenes/room.blend');
    assert.ok(scene.id);
    assert.strictEqual(scene.name, 'room.blend');
  });

  it('exportScene returns ExportFile', () => {
    const bl = new BlenderIntegration();
    bl.connect('http://localhost:9090');
    const scene = bl.importScene('/scenes/room.blend');
    const exp = bl.exportScene(scene.id, 'fbx');
    assert.ok(exp.path.includes('.fbx'));
  });

  it('renderFrame returns RenderedFrame', () => {
    const bl = new BlenderIntegration();
    bl.connect('http://localhost:9090');
    const scene = bl.importScene('/scenes/room.blend');
    const render = bl.renderFrame(scene.id, 42);
    assert.strictEqual(render.frame, 42);
    assert.ok(render.path.includes('f42'));
  });
});

// ─── SlackIntegration ──────────────────────────────────────────────

describe('SlackIntegration', () => {
  it('connect with token', () => {
    const sl = new SlackIntegration();
    const res = sl.connect('xoxb-token');
    assert.strictEqual(res.status, 'Connected');
  });

  it('sendNotification returns Sent', () => {
    const sl = new SlackIntegration();
    sl.connect('xoxb-token');
    const res = sl.sendNotification('general', 'Hello team!');
    assert.strictEqual(res.status, 'Sent');
    assert.strictEqual(sl.sentMessages.length, 1);
  });

  it('getChannels returns channels', () => {
    const sl = new SlackIntegration();
    sl.connect('xoxb-token');
    const channels = sl.getChannels();
    assert.ok(channels.length >= 3);
    assert.strictEqual(channels[0].name, 'general');
  });

  it('uploadFile returns Uploaded', () => {
    const sl = new SlackIntegration();
    sl.connect('xoxb-token');
    const res = sl.uploadFile('design', '/exports/poster.png');
    assert.strictEqual(res.status, 'Uploaded');
    assert.strictEqual(res.name, 'poster.png');
  });
});

// ─── ZapierIntegration ─────────────────────────────────────────────

describe('ZapierIntegration', () => {
  it('connect with api key', () => {
    const zp = new ZapierIntegration();
    const res = zp.connect('zapier-key-123');
    assert.strictEqual(res.status, 'Connected');
  });

  it('createTrigger returns Trigger', () => {
    const zp = new ZapierIntegration();
    zp.connect('key');
    const trigger = zp.createTrigger('project.created', { name: 'test' });
    assert.strictEqual(trigger.event, 'project.created');
    assert.ok(trigger.id);
  });

  it('listTriggers returns all', () => {
    const zp = new ZapierIntegration();
    zp.connect('key');
    zp.createTrigger('e1', {});
    zp.createTrigger('e2', {});
    assert.strictEqual(zp.listTriggers().length, 2);
  });

  it('testTrigger returns success', () => {
    const zp = new ZapierIntegration();
    zp.connect('key');
    const trigger = zp.createTrigger('e1', {});
    const res = zp.testTrigger(trigger.id);
    assert.strictEqual(res.success, true);
  });

  it('getWebhookUrl returns URL', () => {
    const zp = new ZapierIntegration();
    zp.connect('zapier-key');
    const url = zp.getWebhookUrl();
    assert.ok(url.includes('hooks.zapier.com'));
    assert.ok(url.includes('zapier-key'));
  });
});

// ─── Cross-cutting: Not connected errors ───────────────────────────

describe('Not-connected error paths', () => {
  it('GoogleDrive throws when upload called before connect', () => {
    const gd = new GoogleDriveIntegration();
    assert.throws(() => gd.upload('p', '/a'), /Not connected/);
  });

  it('Dropbox throws when upload called before connect', () => {
    const db = new DropboxIntegration();
    assert.throws(() => db.upload('p', '/a'), /Not connected/);
  });

  it('OneDrive throws when upload called before connect', () => {
    const od = new OneDriveIntegration();
    assert.throws(() => od.upload('p', '/a'), /Not connected/);
  });

  it('Figma throws when importFrame called before connect', () => {
    const fg = new FigmaIntegration();
    assert.throws(() => fg.importFrame('f', 'fr'), /Not connected/);
  });

  it('Blender throws when importScene called before connect', () => {
    const bl = new BlenderIntegration();
    assert.throws(() => bl.importScene('/a.blend'), /Not connected/);
  });
});
