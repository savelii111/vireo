// @vitest-environment jsdom
// Day 24: minimal smoke test for the export client. The real
// lifecycle is exercised by tests/test_studio_export_e2e.py on
// the Python side; this test just makes sure the helper that
// builds the media URL for the HTML5 <video> element behaves as
// expected (query-token on a relative URL, no token -> no
// query string).
import { describe, it, expect } from "vitest";
import { createExportClient } from "../src/exportClient";

describe("createExportClient.getMediaUrl", () => {
  it("appends access_token when one is provided", () => {
    const client = createExportClient();
    const url = client.getMediaUrl("ex_abc123", "tok-xyz");
    expect(url).toBe("/api/exports/ex_abc123/media?access_token=tok-xyz");
  });

  it("omits the query string when token is empty", () => {
    const client = createExportClient();
    expect(client.getMediaUrl("ex_abc123", "")).toBe("/api/exports/ex_abc123/media");
    expect(client.getMediaUrl("ex_abc123", null)).toBe("/api/exports/ex_abc123/media");
    expect(client.getMediaUrl("ex_abc123", undefined)).toBe("/api/exports/ex_abc123/media");
  });

  it("encodes the jobId so paths with slashes are safe", () => {
    const client = createExportClient();
    const url = client.getMediaUrl("ex/a b", "t");
    expect(url).toBe("/api/exports/ex%2Fa%20b/media?access_token=t");
  });

  it("getMediaUrlAbsolute anchors to a base URL with no trailing slash", () => {
    const client = createExportClient();
    const url = client.getMediaUrlAbsolute("http://localhost:8011/", "ex_x", "t");
    expect(url).toBe("http://localhost:8011/api/exports/ex_x/media?access_token=t");
  });
});
