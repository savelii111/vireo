/**
 * Smart Reframing System for Vireo Studio
 * 
 * Provides intelligent video reframing for multiple platforms,
 * face detection, motion tracking, and split-screen capabilities.
 */

class SmartReframe {
  constructor() {
    this.defaultConfig = {
      faceDetectionEnabled: true,
      motionSensitivity: 0.5,
      reframeSmoothness: 0.7,
      maxZoomFactor: 2.0,
      minZoomFactor: 1.0,
      cropPadding: 0.1,
      animationDuration: 0.5,
      keyframeInterval: 10,
    };
  }

  /**
   * Detect faces in a video frame
   * @param {Object} frame - Frame data with width, height, and optional faceData
   * @returns {Array} Array of detected faces
   */
  detectFaces(frame) {
    if (!frame || !frame.width || !frame.height) {
      return [];
    }

    // If face data is provided, use it directly
    if (frame.faceData && Array.isArray(frame.faceData)) {
      return frame.faceData.map(face => ({
        x: Math.max(0, Math.min(face.x, frame.width)),
        y: Math.max(0, Math.min(face.y, frame.height)),
        width: Math.max(0, Math.min(face.width, frame.width - face.x)),
        height: Math.max(0, Math.min(face.height, frame.height - face.y)),
        confidence: face.confidence || 0.9,
      }));
    }

    // Simulate face detection with basic heuristics
    const faces = [];
    const centerX = frame.width / 2;
    const centerY = frame.height / 2;

    // Assume a face in the center region for demonstration
    faces.push({
      x: Math.max(0, centerX - 75),
      y: Math.max(0, centerY - 75),
      width: Math.min(150, frame.width),
      height: Math.min(180, frame.height),
      confidence: 0.92,
    });

    return faces;
  }

  /**
   * Detect the most important region in a frame
   * Uses rule of thirds + face detection + motion analysis
   * @param {Object} frame - Frame data
   * @returns {Object} Important region with coordinates and score
   */
  detectImportantRegion(frame) {
    if (!frame || !frame.width || !frame.height) {
      return { x: 0, y: 0, width: 0, height: 0, score: 0 };
    }

    const faces = this.detectFaces(frame);
    let region = {
      x: frame.width * 0.167,
      y: frame.height * 0.167,
      width: frame.width * 0.333,
      height: frame.height * 0.333,
      score: 0.5,
    };

    // If faces detected, prioritize the largest/most confident face
    if (faces.length > 0) {
      const primaryFace = faces.reduce((best, face) => 
        (face.confidence * face.width * face.height) > 
        (best.confidence * best.width * best.height) ? face : best
      );

      const faceArea = primaryFace.width * primaryFace.height;
      const frameArea = frame.width * frame.height;
      const faceRatio = faceArea / frameArea;

      // Expand face region for better framing
      const padding = 0.3;
      region = {
        x: Math.max(0, primaryFace.x - primaryFace.width * padding),
        y: Math.max(0, primaryFace.y - primaryFace.height * padding),
        width: Math.min(frame.width, primaryFace.width * (1 + padding * 2)),
        height: Math.min(frame.height, primaryFace.height * (1 + padding * 2)),
        score: 0.8 + (faceRatio * 0.2),
      };
    }

    // Apply rule of thirds weighting
    const thirdsX = frame.width / 3;
    const thirdsY = frame.height / 3;
    const thirdsPoints = [
      { x: thirdsX, y: thirdsY },
      { x: thirdsX * 2, y: thirdsY },
      { x: thirdsX, y: thirdsY * 2 },
      { x: thirdsX * 2, y: thirdsY * 2 },
    ];

    let thirdsScore = 0;
    thirdsPoints.forEach(point => {
      const distance = Math.sqrt(
        Math.pow(point.x - (region.x + region.width / 2), 2) +
        Math.pow(point.y - (region.y + region.height / 2), 2)
      );
      const normalizedDistance = 1 - (distance / Math.sqrt(frame.width ** 2 + frame.height ** 2));
      thirdsScore += normalizedDistance;
    });
    thirdsScore /= thirdsPoints.length;

    region.score = (region.score + thirdsScore) / 2;

    // Ensure region stays within frame bounds
    region.x = Math.max(0, Math.min(region.x, frame.width - region.width));
    region.y = Math.max(0, Math.min(region.y, frame.height - region.height));

    return region;
  }

  /**
   * Reframe video to target aspect ratio
   * @param {Object} video - Video data with width, height, duration, frames
   * @param {string} targetAspect - Target aspect ratio ('16:9', '9:16', '1:1', '4:5')
   * @returns {Object} Reframed video data
   */
  reframeToAspectRatio(video, targetAspect) {
    if (!video || !video.width || !video.height) {
      throw new Error('Invalid video data');
    }

    const aspectMap = {
      '16:9': 16 / 9,
      '9:16': 9 / 16,
      '1:1': 1,
      '4:5': 4 / 5,
    };

    const targetRatio = aspectMap[targetAspect];
    if (!targetRatio) {
      throw new Error(`Invalid aspect ratio: ${targetAspect}`);
    }

    const sourceRatio = video.width / video.height;
    let cropX, cropY, cropWidth, cropHeight;

    // Calculate crop dimensions
    if (sourceRatio > targetRatio) {
      // Source is wider, crop horizontally
      cropHeight = video.height;
      cropWidth = video.height * targetRatio;
      cropX = (video.width - cropWidth) / 2;
      cropY = 0;
    } else {
      // Source is taller, crop vertically
      cropWidth = video.width;
      cropHeight = video.width / targetRatio;
      cropX = 0;
      cropY = (video.height - cropHeight) / 2;
    }

    // Analyze frames for smart cropping
    const frames = video.frames || [];
    let smartCropX = cropX;
    let smartCropY = cropY;

    if (frames.length > 0) {
      const regions = frames.map(frame => this.detectImportantRegion(frame));
      const avgX = regions.reduce((sum, r) => sum + r.x, 0) / regions.length;
      const avgY = regions.reduce((sum, r) => sum + r.y, 0) / regions.length;
      
      // Adjust crop to center on important content
      smartCropX = Math.max(0, Math.min(avgX - cropWidth / 2, video.width - cropWidth));
      smartCropY = Math.max(0, Math.min(avgY - cropHeight / 2, video.height - cropHeight));
    }

    return {
      originalWidth: video.width,
      originalHeight: video.height,
      newWidth: Math.round(cropWidth),
      newHeight: Math.round(cropHeight),
      cropX: Math.round(smartCropX),
      cropY: Math.round(smartCropY),
      cropWidth: Math.round(cropWidth),
      cropHeight: Math.round(cropHeight),
      targetAspect,
      sourceAspect: `${video.width}:${video.height}`,
      frames: frames.length,
    };
  }

  /**
   * Auto-reframe video for multiple platforms
   * @param {Object} video - Video data
   * @param {Array} platforms - Target platforms
   * @returns {Object} Reframed versions for each platform
   */
  autoReframeAll(video, platforms) {
    if (!video || !Array.isArray(platforms)) {
      throw new Error('Invalid input: video and platforms array required');
    }

    const platformAspects = {
      youtube: '16:9',
      tiktok: '9:16',
      instagram: '1:1',
      instagram_reels: '9:16',
      instagram_feed: '4:5',
      twitter: '16:9',
      linkedin: '16:9',
      facebook: '1:1',
    };

    const results = {};

    platforms.forEach(platform => {
      const aspect = platformAspects[platform.toLowerCase()];
      if (aspect) {
        try {
          results[platform] = this.reframeToAspectRatio(video, aspect);
          results[platform].platform = platform;
        } catch (error) {
          results[platform] = {
            error: error.message,
            platform,
          };
        }
      } else {
        results[platform] = {
          error: `Unknown platform: ${platform}`,
          platform,
        };
      }
    });

    return results;
  }

  /**
   * Dynamic reframing that follows action/motion through video
   * @param {Object} video - Video data with frames
   * @param {Object} options - Reframing options
   * @returns {Object} Dynamic reframing instructions
   */
  dynamicReframe(video, options = {}) {
    const { zoomStyle = 'smooth', targetAspect = '16:9' } = options;

    if (!video || !video.width || !video.height) {
      throw new Error('Invalid video data');
    }

    const aspectRatio = this._parseAspect(targetAspect);
    const frames = video.frames || [];
    
    const keyframes = [];
    let previousRegion = null;

    frames.forEach((frame, index) => {
      const region = this.detectImportantRegion(frame);
      
      // Apply smoothing or snap based on style
      if (zoomStyle === 'smooth' && previousRegion) {
        const smoothFactor = 0.3;
        region.x = previousRegion.x + (region.x - previousRegion.x) * smoothFactor;
        region.y = previousRegion.y + (region.y - previousRegion.y) * smoothFactor;
        region.width = previousRegion.width + (region.width - previousRegion.width) * smoothFactor;
        region.height = previousRegion.height + (region.height - previousRegion.height) * smoothFactor;
      }

      // Calculate zoom level
      const regionRatio = region.width / region.height;
      let zoomLevel;
      if (regionRatio > aspectRatio) {
        zoomLevel = video.width / region.width;
      } else {
        zoomLevel = video.height / region.height;
      }
      zoomLevel = Math.max(1.0, Math.min(zoomLevel, 2.0));

      keyframes.push({
        frame: index,
        timestamp: frame.timestamp || index / (video.fps || 30),
        region: {
          x: Math.round(region.x),
          y: Math.round(region.y),
          width: Math.round(region.width),
          height: Math.round(region.height),
        },
        zoomLevel: Math.round(zoomLevel * 100) / 100,
        score: region.score,
      });

      previousRegion = { ...region };
    });

    return {
      style: zoomStyle,
      targetAspect,
      totalFrames: frames.length,
      keyframes,
      smoothPath: zoomStyle === 'smooth',
    };
  }

  /**
   * Create split screen from two videos
   * @param {Object} video1 - First video data
   * @param {Object} video2 - Second video data
   * @param {string} layout - Split screen layout
   * @returns {Object} Split screen configuration
   */
  splitScreen(video1, video2, layout = 'side-by-side') {
    if (!video1 || !video2) {
      throw new Error('Both video inputs required');
    }

    const validLayouts = ['side-by-side', 'top-bottom', 'pip'];
    if (!validLayouts.includes(layout)) {
      throw new Error(`Invalid layout: ${layout}. Must be one of: ${validLayouts.join(', ')}`);
    }

    let result = {
      layout,
      video1: {
        width: video1.width,
        height: video1.height,
      },
      video2: {
        width: video2.width,
        height: video2.height,
      },
    };

    switch (layout) {
      case 'side-by-side':
        result.outputWidth = video1.width + video2.width;
        result.outputHeight = Math.max(video1.height, video2.height);
        result.video1.position = { x: 0, y: 0 };
        result.video2.position = { x: video1.width, y: 0 };
        result.video1.scale = Math.min(1, result.outputHeight / video1.height);
        result.video2.scale = Math.min(1, result.outputHeight / video2.height);
        break;

      case 'top-bottom':
        result.outputWidth = Math.max(video1.width, video2.width);
        result.outputHeight = video1.height + video2.height;
        result.video1.position = { x: 0, y: 0 };
        result.video2.position = { x: 0, y: video1.height };
        result.video1.scale = Math.min(1, result.outputWidth / video1.width);
        result.video2.scale = Math.min(1, result.outputWidth / video2.width);
        break;

      case 'pip':
        const pipScale = 0.25;
        const pipWidth = video1.width * pipScale;
        const pipHeight = video2.height * pipScale;
        result.outputWidth = video1.width;
        result.outputHeight = video1.height;
        result.video1.position = { x: 0, y: 0 };
        result.video1.scale = 1;
        result.video2.position = {
          x: video1.width - pipWidth - 20,
          y: video1.height - pipHeight - 20,
        };
        result.video2.scale = pipScale;
        result.video2.originalSize = {
          width: pipWidth,
          height: pipHeight,
        };
        break;
    }

    // Balance content based on importance
    result.balanced = this._balanceSplitContent(video1, video2, layout);

    return result;
  }

  /**
   * Remove pillarbox/letterbox black bars from video
   * @param {Object} video - Video data
   * @returns {Object} Cleaned video configuration
   */
  pillarboxRemover(video) {
    if (!video || !video.width || !video.height) {
      throw new Error('Invalid video data');
    }

    // Detect black bars by analyzing frame edges
    const blackBarThreshold = 10;
    let topBar = 0;
    let bottomBar = 0;
    let leftBar = 0;
    let rightBar = 0;

    if (video.frames && video.frames.length > 0) {
      const sampleFrame = video.frames[0];
      const edgeData = sampleFrame.edgeData || {};

      topBar = edgeData.topBlackRows || 0;
      bottomBar = edgeData.bottomBlackRows || 0;
      leftBar = edgeData.leftBlackCols || 0;
      rightBar = edgeData.rightBlackCols || 0;
    }

    // Default: detect based on aspect ratio if no frame data
    if (topBar === 0 && bottomBar === 0 && leftBar === 0 && rightBar === 0) {
      const aspectRatio = video.width / video.height;
      
      // Check for common video aspect ratios
      if (aspectRatio > 1.8) {
        // Likely 16:9 with black bars (was 4:3)
        const expectedWidth = video.height * (4 / 3);
        leftBar = Math.round((video.width - expectedWidth) / 2);
        rightBar = leftBar;
      } else if (aspectRatio < 1.2) {
        // Likely 4:3 with black bars (was 16:9)
        const expectedHeight = video.width * (9 / 16);
        topBar = Math.round((video.height - expectedHeight) / 2);
        bottomBar = topBar;
      }
    }

    const cleanedWidth = video.width - leftBar - rightBar;
    const cleanedHeight = video.height - topBar - bottomBar;

    // Determine if upscale or crop is needed
    const originalAspect = video.width / video.height;
    const cleanedAspect = cleanedWidth / cleanedHeight;

    let method;
    if (Math.abs(originalAspect - cleanedAspect) < 0.1) {
      method = 'none';
    } else if (cleanedWidth < video.width * 0.8 || cleanedHeight < video.height * 0.8) {
      method = 'upscale';
    } else {
      method = 'crop';
    }

    return {
      originalWidth: video.width,
      originalHeight: video.height,
      cleanedWidth,
      cleanedHeight,
      blackBars: {
        top: topBar,
        bottom: bottomBar,
        left: leftBar,
        right: rightBar,
      },
      method,
      newAspect: `${cleanedWidth}:${cleanedHeight}`,
      scaleFactor: method === 'upscale' ? 
        Math.max(video.width / cleanedWidth, video.height / cleanedHeight) : 1,
    };
  }

  /**
   * Parse aspect ratio string to numeric value
   * @private
   */
  _parseAspect(aspect) {
    const aspectMap = {
      '16:9': 16 / 9,
      '9:16': 9 / 16,
      '1:1': 1,
      '4:5': 4 / 5,
    };
    return aspectMap[aspect] || 16 / 9;
  }

  /**
   * Balance content between split screens
   * @private
   */
  _balanceSplitContent(video1, video2, layout) {
    const brightness1 = video1.averageBrightness || 0.5;
    const brightness2 = video2.averageBrightness || 0.5;
    
    const motion1 = video1.averageMotion || 0.5;
    const motion2 = video2.averageMotion || 0.5;

    return {
      brightnessBalance: Math.abs(brightness1 - brightness2),
      motionBalance: Math.abs(motion1 - motion2),
      recommended: Math.abs(brightness1 - brightness2) < 0.3 && 
                   Math.abs(motion1 - motion2) < 0.3,
    };
  }

  /**
   * Batch process multiple videos
   * @param {Array} videos - Array of video data
   * @param {string} targetAspect - Target aspect ratio
   * @returns {Array} Reframed video configurations
   */
  batchReframe(videos, targetAspect) {
    if (!Array.isArray(videos)) {
      throw new Error('Videos must be an array');
    }

    return videos.map((video, index) => {
      try {
        return {
          index,
          ...this.reframeToAspectRatio(video, targetAspect),
          success: true,
        };
      } catch (error) {
        return {
          index,
          error: error.message,
          success: false,
        };
      }
    });
  }

  /**
   * Generate preview frames for reframing
   * @param {Object} video - Video data
   * @param {string} targetAspect - Target aspect ratio
   * @param {number} previewCount - Number of preview frames
   * @returns {Array} Preview frame configurations
   */
  generatePreviews(video, targetAspect, previewCount = 5) {
    const frames = video.frames || [];
    const step = Math.max(1, Math.floor(frames.length / previewCount));
    const previews = [];

    for (let i = 0; i < frames.length; i += step) {
      if (previews.length >= previewCount) break;

      const previewVideo = {
        ...video,
        frames: [frames[i]],
      };

      previews.push({
        frameIndex: i,
        timestamp: frames[i].timestamp || i / (video.fps || 30),
        reframe: this.reframeToAspectRatio(previewVideo, targetAspect),
      });
    }

    return previews;
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SmartReframe;
}

export default SmartReframe;
