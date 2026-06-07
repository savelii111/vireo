// Unified publisher facade — routes to the right platform publisher based on platform name.

import { YouTubePublisher, YouTubeError } from "./youtube.js";
import { TikTokPublisher, TikTokError } from "./tiktok.js";
import { InstagramPublisher, InstagramError } from "./instagram.js";
import { XPublisher, XError } from "./x.js";
import { LinkedInPublisher, LinkedInError } from "./linkedin.js";

export { YouTubePublisher, YouTubeError };
export { TikTokPublisher, TikTokError };
export { InstagramPublisher, InstagramError };
export { XPublisher, XError };
export { LinkedInPublisher, LinkedInError };

/**
 * Build a publisher for a specific platform given credentials.
 * @param {string} platform
 * @param {object} credentials
 * @param {string} credentials.accessToken  - OAuth access token
 * @param {string} [credentials.refreshToken] - for token refresh flows
 * @returns {object} publisher instance
 */
export function publisherFor(platform, credentials) {
  if (!credentials?.accessToken) {
    throw new Error(`publisherFor(${platform}): credentials.accessToken is required`);
  }
  switch (platform) {
    case "youtube":
    case "youtube_shorts":
      return new YouTubePublisher({ accessToken: credentials.accessToken });
    case "tiktok":
      return new TikTokPublisher({ accessToken: credentials.accessToken });
    case "instagram_reels":
    case "instagram":
      return new InstagramPublisher({
        accessToken: credentials.accessToken,
        igUserId: credentials.igUserId || credentials.accountId,
      });
    case "x":
      return new XPublisher({ accessToken: credentials.accessToken });
    case "linkedin":
      return new LinkedInPublisher({
        accessToken: credentials.accessToken,
        authorUrn: credentials.authorUrn,
      });
    case "telegram":
    case "substack":
    case "podcast":
    case "threads":
      throw new Error(`publisherFor(${platform}): not yet implemented (use mock publisher)`);
    default:
      throw new Error(`publisherFor: unknown platform ${platform}`);
  }
}

/**
 * Map of platform → error class for error handling
 */
export const PUBLISHER_ERRORS = {
  youtube: YouTubeError,
  youtube_shorts: YouTubeError,
  tiktok: TikTokError,
  instagram_reels: InstagramError,
  instagram: InstagramError,
  x: XError,
  linkedin: LinkedInError,
};
