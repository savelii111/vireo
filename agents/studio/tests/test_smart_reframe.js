/**
 * test_smart_reframe.js — Tests for Smart Reframing System (25+ tests)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import SmartReframe from '../src/smart_reframe.js';

// ── Test Helpers ──

function createMockVideo(width = 1920, height = 1080, frameCount = 30) {
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    frames.push({
      index: i,
      timestamp: i / 30,
      width,
      height,
      faceData: i % 3 === 0 ? [{
        x: width / 2 - 75,
        y: height / 2 - 75,
        width: 150,
        height: 180,
        confidence: 0.9 + (Math.random() * 0.1),
      }] : [],
    });
  }

  return {
    width,
    height,
    duration: frameCount / 30,
    fps: 30,
    frames,
    averageBrightness: 0.6,
    averageMotion: 0.4,
  };
}

function createMockFrame(width = 1920, height = 1080, faceData = []) {
  return {
    width,
    height,
    faceData,
    index: 0,
    timestamp: 0,
  };
}

// ── Tests ──

describe('SmartReframe', () => {
  describe('detectFaces', () => {
    test('should return empty array for null input', () => {
      const reframe = new SmartReframe();
      const result = reframe.detectFaces(null);
      assert.deepStrictEqual(result, []);
    });

    test('should return empty array for invalid frame', () => {
      const reframe = new SmartReframe();
      const result = reframe.detectFaces({});
      assert.deepStrictEqual(result, []);
    });

    test('should detect provided face data', () => {
      const reframe = new SmartReframe();
      const frame = createMockFrame(1920, 1080, [
        { x: 100, y: 100, width: 150, height: 180, confidence: 0.95 },
      ]);
      const result = reframe.detectFaces(frame);
      
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].x, 100);
      assert.strictEqual(result[0].y, 100);
      assert.strictEqual(result[0].width, 150);
      assert.strictEqual(result[0].height, 180);
      assert.strictEqual(result[0].confidence, 0.95);
    });

    test('should handle multiple faces', () => {
      const reframe = new SmartReframe();
      const frame = createMockFrame(1920, 1080, [
        { x: 100, y: 100, width: 150, height: 180, confidence: 0.95 },
        { x: 500, y: 200, width: 120, height: 150, confidence: 0.88 },
      ]);
      const result = reframe.detectFaces(frame);
      
      assert.strictEqual(result.length, 2);
    });

    test('should clamp face coordinates to frame bounds', () => {
      const reframe = new SmartReframe();
      const frame = createMockFrame(1920, 1080, [
        { x: -50, y: -30, width: 200, height: 200, confidence: 0.9 },
      ]);
      const result = reframe.detectFaces(frame);
      
      assert.ok(result[0].x >= 0, 'x should be >= 0');
      assert.ok(result[0].y >= 0, 'y should be >= 0');
    });

    test('should provide default confidence if not specified', () => {
      const reframe = new SmartReframe();
      const frame = createMockFrame(1920, 1080, [
        { x: 100, y: 100, width: 150, height: 180 },
      ]);
      const result = reframe.detectFaces(frame);
      
      assert.strictEqual(result[0].confidence, 0.9);
    });
  });

  describe('detectImportantRegion', () => {
    test('should return zero region for null input', () => {
      const reframe = new SmartReframe();
      const result = reframe.detectImportantRegion(null);
      assert.deepStrictEqual(result, { x: 0, y: 0, width: 0, height: 0, score: 0 });
    });

    test('should detect region using rule of thirds', () => {
      const reframe = new SmartReframe();
      const frame = createMockFrame(1920, 1080);
      const result = reframe.detectImportantRegion(frame);
      
      assert.ok('x' in result);
      assert.ok('y' in result);
      assert.ok('width' in result);
      assert.ok('height' in result);
      assert.ok('score' in result);
      assert.ok(result.score >= 0 && result.score <= 1, 'score should be 0-1');
    });

    test('should prioritize face regions', () => {
      const reframe = new SmartReframe();
      const face = { x: 400, y: 300, width: 150, height: 180, confidence: 0.95 };
      const frame = createMockFrame(1920, 1080, [face]);
      const result = reframe.detectImportantRegion(frame);
      
      assert.ok(result.x < face.x + face.width, 'region x within face');
      assert.ok(result.y < face.y + face.height, 'region y within face');
      assert.ok(result.score > 0.7, 'score should be high with face');
    });

    test('should keep region within frame bounds', () => {
      const reframe = new SmartReframe();
      const frame = createMockFrame(1920, 1080);
      const result = reframe.detectImportantRegion(frame);
      
      assert.ok(result.x >= 0, 'x >= 0');
      assert.ok(result.y >= 0, 'y >= 0');
      assert.ok(result.x + result.width <= 1920, 'x + width <= frame width');
      assert.ok(result.y + result.height <= 1080, 'y + height <= frame height');
    });
  });

  describe('reframeToAspectRatio', () => {
    test('should throw error for invalid video', () => {
      const reframe = new SmartReframe();
      assert.throws(() => reframe.reframeToAspectRatio(null, '16:9'), /Invalid video data/);
    });

    test('should throw error for invalid aspect ratio', () => {
      const reframe = new SmartReframe();
      const video = createMockVideo();
      assert.throws(() => reframe.reframeToAspectRatio(video, '3:4'), /Invalid aspect ratio/);
    });

    test('should reframe 16:9 to 9:16 (vertical)', () => {
      const reframe = new SmartReframe();
      const video = createMockVideo(1920, 1080);
      const result = reframe.reframeToAspectRatio(video, '9:16');
      
      assert.strictEqual(result.targetAspect, '9:16');
      assert.ok(result.newHeight > result.newWidth, 'height > width for vertical');
    });

    test('should reframe to square (1:1)', () => {
      const reframe = new SmartReframe();
      const video = createMockVideo(1920, 1080);
      const result = reframe.reframeToAspectRatio(video, '1:1');
      
      assert.strictEqual(result.targetAspect, '1:1');
      assert.ok(Math.abs(result.newWidth - result.newHeight) < 10, 'width ≈ height for square');
    });

    test('should reframe to 4:5', () => {
      const reframe = new SmartReframe();
      const video = createMockVideo(1920, 1080);
      const result = reframe.reframeToAspectRatio(video, '4:5');
      
      assert.strictEqual(result.targetAspect, '4:5');
      const ratio = result.newWidth / result.newHeight;
      assert.ok(Math.abs(ratio - 4/5) < 0.1, 'ratio should be ~4:5');
    });

    test('should preserve 16:9 aspect ratio', () => {
      const reframe = new SmartReframe();
      const video = createMockVideo(1920, 1080);
      const result = reframe.reframeToAspectRatio(video, '16:9');
      
      assert.strictEqual(result.targetAspect, '16:9');
      assert.ok(result.cropX >= 0, 'cropX >= 0');
      assert.strictEqual(result.cropY, 0, 'cropY should be 0');
    });

    test('should include crop information', () => {
      const reframe = new SmartReframe();
      const video = createMockVideo(1920, 1080);
      const result = reframe.reframeToAspectRatio(video, '9:16');
      
      assert.ok('cropX' in result);
      assert.ok('cropY' in result);
      assert.ok('cropWidth' in result);
      assert.ok('cropHeight' in result);
    });
  });

  describe('autoReframeAll', () => {
    test('should throw error for invalid input', () => {
      const reframe = new SmartReframe();
      assert.throws(() => reframe.autoReframeAll(null, ['youtube']), /Invalid input/);
      assert.throws(() => reframe.autoReframeAll({}, null), /Invalid input/);
    });

    test('should reframe for YouTube (16:9)', () => {
      const reframe = new SmartReframe();
      const video = createMockVideo(1920, 1080);
      const result = reframe.autoReframeAll(video, ['youtube']);
      
      assert.ok(result.youtube);
      assert.strictEqual(result.youtube.targetAspect, '16:9');
    });

    test('should reframe for TikTok (9:16)', () => {
      const reframe = new SmartReframe();
      const video = createMockVideo(1920, 1080);
      const result = reframe.autoReframeAll(video, ['tiktok']);
      
      assert.ok(result.tiktok);
      assert.strictEqual(result.tiktok.targetAspect, '9:16');
    });

    test('should reframe for Instagram (1:1)', () => {
      const reframe = new SmartReframe();
      const video = createMockVideo(1920, 1080);
      const result = reframe.autoReframeAll(video, ['instagram']);
      
      assert.ok(result.instagram);
      assert.strictEqual(result.instagram.targetAspect, '1:1');
    });

    test('should handle multiple platforms at once', () => {
      const reframe = new SmartReframe();
      const video = createMockVideo(1920, 1080);
      const result = reframe.autoReframeAll(video, ['youtube', 'tiktok', 'instagram']);
      
      assert.ok(result.youtube);
      assert.ok(result.tiktok);
      assert.ok(result.instagram);
    });

    test('should handle unknown platform gracefully', () => {
      const reframe = new SmartReframe();
      const video = createMockVideo(1920, 1080);
      const result = reframe.autoReframeAll(video, ['unknown_platform']);
      
      assert.ok('error' in result.unknown_platform);
    });
  });

  describe('dynamicReframe', () => {
    test('should throw error for invalid video', () => {
      const reframe = new SmartReframe();
      assert.throws(() => reframe.dynamicReframe(null), /Invalid video data/);
    });

    test('should generate keyframes for smooth style', () => {
      const reframe = new SmartReframe();
      const video = createMockVideo(1920, 1080, 10);
      const result = reframe.dynamicReframe(video, { zoomStyle: 'smooth' });
      
      assert.strictEqual(result.style, 'smooth');
      assert.strictEqual(result.keyframes.length, 10);
      assert.strictEqual(result.smoothPath, true);
    });

    test('should generate keyframes for snap style', () => {
      const reframe = new SmartReframe();
      const video = createMockVideo(1920, 1080, 10);
      const result = reframe.dynamicReframe(video, { zoomStyle: 'snap' });
      
      assert.strictEqual(result.style, 'snap');
      assert.strictEqual(result.smoothPath, false);
    });

    test('should include zoom level in keyframes', () => {
      const reframe = new SmartReframe();
      const video = createMockVideo(1920, 1080, 5);
      const result = reframe.dynamicReframe(video);
      
      for (const kf of result.keyframes) {
        assert.ok('zoomLevel' in kf, 'keyframe has zoomLevel');
        assert.ok(kf.zoomLevel >= 1.0, 'zoomLevel >= 1.0');
        assert.ok(kf.zoomLevel <= 2.0, 'zoomLevel <= 2.0');
      }
    });

    test('should include timestamps in keyframes', () => {
      const reframe = new SmartReframe();
      const video = createMockVideo(1920, 1080, 5);
      const result = reframe.dynamicReframe(video);
      
      for (const kf of result.keyframes) {
        assert.ok('timestamp' in kf, 'keyframe has timestamp');
        assert.ok(kf.timestamp >= 0, 'timestamp >= 0');
      }
    });
  });

  describe('splitScreen', () => {
    test('should throw error for missing videos', () => {
      const reframe = new SmartReframe();
      const video = createMockVideo();
      assert.throws(() => reframe.splitScreen(null, video), /Both video inputs required/);
      assert.throws(() => reframe.splitScreen(video, null), /Both video inputs required/);
    });

    test('should throw error for invalid layout', () => {
      const reframe = new SmartReframe();
      const video = createMockVideo();
      assert.throws(() => reframe.splitScreen(video, video, 'invalid'), /Invalid layout/);
    });

    test('should create side-by-side layout', () => {
      const reframe = new SmartReframe();
      const video1 = createMockVideo(1920, 1080);
      const video2 = createMockVideo(1280, 720);
      const result = reframe.splitScreen(video1, video2, 'side-by-side');
      
      assert.strictEqual(result.layout, 'side-by-side');
      assert.strictEqual(result.outputWidth, 1920 + 1280);
      assert.strictEqual(result.video1.position.x, 0);
      assert.strictEqual(result.video2.position.x, 1920);
    });

    test('should create top-bottom layout', () => {
      const reframe = new SmartReframe();
      const video1 = createMockVideo(1920, 1080);
      const video2 = createMockVideo(1920, 720);
      const result = reframe.splitScreen(video1, video2, 'top-bottom');
      
      assert.strictEqual(result.layout, 'top-bottom');
      assert.strictEqual(result.outputHeight, 1080 + 720);
      assert.strictEqual(result.video1.position.y, 0);
      assert.strictEqual(result.video2.position.y, 1080);
    });

    test('should create picture-in-picture layout', () => {
      const reframe = new SmartReframe();
      const video1 = createMockVideo(1920, 1080);
      const video2 = createMockVideo(640, 480);
      const result = reframe.splitScreen(video1, video2, 'pip');
      
      assert.strictEqual(result.layout, 'pip');
      assert.strictEqual(result.outputWidth, 1920);
      assert.strictEqual(result.outputHeight, 1080);
      assert.strictEqual(result.video2.scale, 0.25);
    });

    test('should include balance information', () => {
      const reframe = new SmartReframe();
      const video1 = createMockVideo(1920, 1080);
      const video2 = createMockVideo(1920, 1080);
      const result = reframe.splitScreen(video1, video2);
      
      assert.ok('brightnessBalance' in result.balanced);
      assert.ok('motionBalance' in result.balanced);
      assert.ok('recommended' in result.balanced);
    });
  });

  describe('pillarboxRemover', () => {
    test('should throw error for invalid video', () => {
      const reframe = new SmartReframe();
      assert.throws(() => reframe.pillarboxRemover(null), /Invalid video data/);
    });

    test('should detect black bars and calculate cleaned dimensions', () => {
      const reframe = new SmartReframe();
      const video = createMockVideo(1920, 1080);
      const result = reframe.pillarboxRemover(video);
      
      assert.strictEqual(result.originalWidth, 1920);
      assert.strictEqual(result.originalHeight, 1080);
      assert.ok('cleanedWidth' in result);
      assert.ok('cleanedHeight' in result);
      assert.ok('method' in result);
    });

    test('should identify pillarbox bars', () => {
      const reframe = new SmartReframe();
      const video = createMockVideo(1920, 1080);
      const result = reframe.pillarboxRemover(video);
      
      assert.ok('top' in result.blackBars);
      assert.ok('bottom' in result.blackBars);
      assert.ok('left' in result.blackBars);
      assert.ok('right' in result.blackBars);
    });

    test('should recommend upscale or crop method', () => {
      const reframe = new SmartReframe();
      const video = createMockVideo(1920, 1080);
      const result = reframe.pillarboxRemover(video);
      
      assert.ok(['none', 'upscale', 'crop'].includes(result.method));
    });
  });

  describe('batchReframe', () => {
    test('should throw error for non-array input', () => {
      const reframe = new SmartReframe();
      assert.throws(() => reframe.batchReframe('not an array', '16:9'), /Videos must be an array/);
    });

    test('should process multiple videos', () => {
      const reframe = new SmartReframe();
      const videos = [
        createMockVideo(1920, 1080),
        createMockVideo(1280, 720),
        createMockVideo(640, 480),
      ];
      const results = reframe.batchReframe(videos, '9:16');
      
      assert.strictEqual(results.length, 3);
      for (let i = 0; i < results.length; i++) {
        assert.strictEqual(results[i].index, i);
        assert.strictEqual(results[i].success, true);
      }
    });

    test('should handle errors in batch gracefully', () => {
      const reframe = new SmartReframe();
      const videos = [
        null,
        createMockVideo(1920, 1080),
      ];
      const results = reframe.batchReframe(videos, '9:16');
      
      assert.strictEqual(results[0].success, false);
      assert.strictEqual(results[1].success, true);
    });
  });

  describe('generatePreviews', () => {
    test('should generate preview frames', () => {
      const reframe = new SmartReframe();
      const video = createMockVideo(1920, 1080, 30);
      const previews = reframe.generatePreviews(video, '9:16', 5);
      
      assert.strictEqual(previews.length, 5);
      for (const preview of previews) {
        assert.ok('frameIndex' in preview);
        assert.ok('timestamp' in preview);
        assert.ok('reframe' in preview);
      }
    });

    test('should include reframe data in previews', () => {
      const reframe = new SmartReframe();
      const video = createMockVideo(1920, 1080, 30);
      const previews = reframe.generatePreviews(video, '1:1', 3);
      
      for (const preview of previews) {
        assert.strictEqual(preview.reframe.targetAspect, '1:1');
      }
    });
  });
});
