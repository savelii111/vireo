// Mock publisher — pretends to be a real platform API.
// Returns a stable fake post_id, sleeps a bit, never fails.
import { newId } from "@vireo/shared";

export async function mockPublisher(job) {
  await new Promise((r) => setTimeout(r, 10 + Math.random() * 20));
  return {
    platform_post_id: `${job.platform}_${newId()}`,
    metadata: { mock: true, duration_ms: 15 },
  };
}

// Fails randomly — for testing the failure path
export function flakyPublisher(failRate = 0.3) {
  return async (job) => {
    await new Promise((r) => setTimeout(r, 5));
    if (Math.random() < failRate) throw new Error(`Mock ${job.platform} error`);
    return { platform_post_id: `${job.platform}_${newId()}`, metadata: { mock: true } };
  };
}
