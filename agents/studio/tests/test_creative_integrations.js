// test_creative_integrations.js — Comprehensive tests for creative tool integrations.
//
// Validates all 10 creative integration tools (5 imports, 3 exports, 2 engine imports),
// store management, filtering, edge cases, and error handling.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  importFromFigma,
  importFromCanva,
  exportToPremiere,
  exportToDavinci,
  exportToFinalCut,
  importFromBlender,
  importFromCinema4D,
  importFromUnreal,
  importFromUnity,
  importFromHoudini,
  listImports,
  listExports,
  getImport,
  getExport,
  removeImport,
  removeExport,
  _resetStores,
  _getImports,
  _getExports,
} from "../src/creative_integrations.js";

// Reset stores before each test
test.beforeEach(() => {
  _resetStores();
});

// =====================================================================
// 1. importFromFigma — returns all required fields
// =====================================================================
test("importFromFigma returns all required fields", () => {
  const result = importFromFigma({
    figmaUrl: "https://figma.com/file/abc123/design",
    projectId: "proj-001",
  });
  assert.equal(result.imported, true);
  assert.equal(result.source, "figma");
  assert.equal(result.project_id, "proj-001");
  assert.ok(result.import_id.startsWith("figma-"));
  assert.ok(result.frames_count >= 1);
  assert.ok(result.assets_count >= 1);
  assert.deepEqual(result.dimensions, { width: 1920, height: 1080 });
  assert.ok(result.created_at);
});

// =====================================================================
// 2. importFromFigma — throws without figmaUrl
// =====================================================================
test("importFromFigma throws without figmaUrl", () => {
  assert.throws(
    () => importFromFigma({ projectId: "p1" }),
    /figmaUrl is required/
  );
});

// =====================================================================
// 3. importFromFigma — throws without projectId
// =====================================================================
test("importFromFigma throws without projectId", () => {
  assert.throws(
    () => importFromFigma({ figmaUrl: "https://figma.com/file/x" }),
    /projectId is required/
  );
});

// =====================================================================
// 4. importFromFigma — throws on invalid URL
// =====================================================================
test("importFromFigma throws on invalid URL", () => {
  assert.throws(
    () => importFromFigma({ figmaUrl: "https://example.com/file", projectId: "p1" }),
    /Invalid Figma URL/
  );
});

// =====================================================================
// 5. importFromCanva — returns all required fields
// =====================================================================
test("importFromCanva returns all required fields", () => {
  const result = importFromCanva({
    canvaUrl: "https://canva.com/design/xyz",
    projectId: "proj-002",
  });
  assert.equal(result.imported, true);
  assert.equal(result.source, "canva");
  assert.equal(result.project_id, "proj-002");
  assert.ok(result.import_id.startsWith("canva-"));
  assert.ok(result.elements_count >= 1);
  assert.ok(result.pages_count >= 1);
  assert.ok(result.created_at);
});

// =====================================================================
// 6. importFromCanva — throws without canvaUrl
// =====================================================================
test("importFromCanva throws without canvaUrl", () => {
  assert.throws(
    () => importFromCanva({ projectId: "p1" }),
    /canvaUrl is required/
  );
});

// =====================================================================
// 7. importFromCanva — throws on invalid URL
// =====================================================================
test("importFromCanva throws on invalid URL", () => {
  assert.throws(
    () => importFromCanva({ canvaUrl: "https://example.com/design", projectId: "p1" }),
    /Invalid Canva URL/
  );
});

// =====================================================================
// 8. exportToPremiere — returns all required fields
// =====================================================================
test("exportToPremiere returns all required fields", () => {
  const result = exportToPremiere({ projectId: "proj-003" });
  assert.ok(result.export_id.startsWith("premiere-"));
  assert.equal(result.format, "xml");
  assert.ok(result.url.includes("premiere-"));
  assert.ok(result.url.endsWith(".xml"));
  assert.ok(result.file_size_mb > 0);
  assert.ok(result.tracks_count >= 1);
  assert.equal(result.project_id, "proj-003");
  assert.ok(result.created_at);
});

// =====================================================================
// 9. exportToPremiere — throws without projectId
// =====================================================================
test("exportToPremiere throws without projectId", () => {
  assert.throws(
    () => exportToPremiere({}),
    /projectId is required/
  );
});

// =====================================================================
// 10. exportToDavinci — returns all required fields
// =====================================================================
test("exportToDavinci returns all required fields", () => {
  const result = exportToDavinci({ projectId: "proj-004" });
  assert.ok(result.export_id.startsWith("davinci-"));
  assert.equal(result.format, "drp");
  assert.ok(result.url.includes("davinci-"));
  assert.ok(result.url.endsWith(".drp"));
  assert.ok(result.file_size_mb > 0);
  assert.ok(result.timelines_count >= 1);
  assert.equal(result.project_id, "proj-004");
  assert.ok(result.created_at);
});

// =====================================================================
// 11. exportToDavinci — throws without projectId
// =====================================================================
test("exportToDavinci throws without projectId", () => {
  assert.throws(
    () => exportToDavinci(),
    /projectId is required/
  );
});

// =====================================================================
// 12. exportToFinalCut — returns all required fields
// =====================================================================
test("exportToFinalCut returns all required fields", () => {
  const result = exportToFinalCut({ projectId: "proj-005" });
  assert.ok(result.export_id.startsWith("fcpx-"));
  assert.equal(result.format, "fcpxml");
  assert.ok(result.url.includes("finalcut-"));
  assert.ok(result.url.endsWith(".fcpxml"));
  assert.ok(result.file_size_mb > 0);
  assert.ok(result.clips_count >= 1);
  assert.equal(result.project_id, "proj-005");
  assert.ok(result.created_at);
});

// =====================================================================
// 13. exportToFinalCut — throws without projectId
// =====================================================================
test("exportToFinalCut throws without projectId", () => {
  assert.throws(
    () => exportToFinalCut({ projectId: undefined }),
    /projectId is required/
  );
});

// =====================================================================
// 14. importFromBlender — returns all required fields
// =====================================================================
test("importFromBlender returns all required fields", () => {
  const result = importFromBlender({
    blendFile: "scene_v2.blend",
    projectId: "proj-006",
  });
  assert.equal(result.imported, true);
  assert.equal(result.source, "blender");
  assert.equal(result.blend_file, "scene_v2.blend");
  assert.equal(result.project_id, "proj-006");
  assert.ok(result.import_id.startsWith("blender-"));
  assert.ok(result.scenes_count >= 1);
  assert.ok(result.objects_count >= 1);
  assert.ok(result.animations_count >= 0);
  assert.ok(result.created_at);
});

// =====================================================================
// 15. importFromBlender — throws on invalid extension
// =====================================================================
test("importFromBlender throws on invalid extension", () => {
  assert.throws(
    () => importFromBlender({ blendFile: "scene.fbx", projectId: "p1" }),
    /Invalid Blender file format/
  );
});

// =====================================================================
// 16. importFromBlender — throws without blendFile
// =====================================================================
test("importFromBlender throws without blendFile", () => {
  assert.throws(
    () => importFromBlender({ projectId: "p1" }),
    /blendFile is required/
  );
});

// =====================================================================
// 17. importFromCinema4D — returns all required fields
// =====================================================================
test("importFromCinema4D returns all required fields", () => {
  const result = importFromCinema4D({
    c4dFile: "project.c4d",
    projectId: "proj-007",
  });
  assert.equal(result.imported, true);
  assert.equal(result.source, "cinema4d");
  assert.equal(result.c4d_file, "project.c4d");
  assert.equal(result.project_id, "proj-007");
  assert.ok(result.import_id.startsWith("c4d-"));
  assert.ok(result.objects_count >= 1);
  assert.ok(result.materials_count >= 1);
  assert.ok(result.frames_count >= 1);
  assert.ok(result.created_at);
});

// =====================================================================
// 18. importFromCinema4D — throws on invalid extension
// =====================================================================
test("importFromCinema4D throws on invalid extension", () => {
  assert.throws(
    () => importFromCinema4D({ c4dFile: "model.blend", projectId: "p1" }),
    /Invalid Cinema 4D file format/
  );
});

// =====================================================================
// 19. importFromUnreal — returns all required fields
// =====================================================================
test("importFromUnreal returns all required fields", () => {
  const result = importFromUnreal({
    uassetFile: "character.uasset",
    projectId: "proj-008",
  });
  assert.equal(result.imported, true);
  assert.equal(result.source, "unreal");
  assert.equal(result.uasset_file, "character.uasset");
  assert.equal(result.project_id, "proj-008");
  assert.ok(result.import_id.startsWith("unreal-"));
  assert.ok(result.blueprints_count >= 1);
  assert.ok(result.actors_count >= 1);
  assert.ok(typeof result.level_name === "string");
  assert.ok(result.level_name.length > 0);
  assert.ok(result.created_at);
});

// =====================================================================
// 20. importFromUnreal — throws on invalid extension
// =====================================================================
test("importFromUnreal throws on invalid extension", () => {
  assert.throws(
    () => importFromUnreal({ uassetFile: "map.umap", projectId: "p1" }),
    /Invalid Unreal asset file format/
  );
});

// =====================================================================
// 21. importFromUnity — returns all required fields
// =====================================================================
test("importFromUnity returns all required fields", () => {
  const result = importFromUnity({
    unityPackage: "assets.unitypackage",
    projectId: "proj-009",
  });
  assert.equal(result.imported, true);
  assert.equal(result.source, "unity");
  assert.equal(result.unity_package, "assets.unitypackage");
  assert.equal(result.project_id, "proj-009");
  assert.ok(result.import_id.startsWith("unity-"));
  assert.ok(result.prefabs_count >= 1);
  assert.ok(result.scenes_count >= 1);
  assert.ok(result.scripts_count >= 1);
  assert.ok(result.created_at);
});

// =====================================================================
// 22. importFromUnity — throws on invalid extension
// =====================================================================
test("importFromUnity throws on invalid extension", () => {
  assert.throws(
    () => importFromUnity({ unityPackage: "assets.zip", projectId: "p1" }),
    /Invalid Unity package format/
  );
});

// =====================================================================
// 23. importFromHoudini — returns all required fields
// =====================================================================
test("importFromHoudini returns all required fields", () => {
  const result = importFromHoudini({
    hipFile: "simulation.hip",
    projectId: "proj-010",
  });
  assert.equal(result.imported, true);
  assert.equal(result.source, "houdini");
  assert.equal(result.hip_file, "simulation.hip");
  assert.equal(result.project_id, "proj-010");
  assert.ok(result.import_id.startsWith("houdini-"));
  assert.ok(result.nodes_count >= 1);
  assert.ok(result.simulations_count >= 1);
  assert.ok(result.frames_count >= 1);
  assert.ok(result.created_at);
});

// =====================================================================
// 24. importFromHoudini — throws on invalid extension
// =====================================================================
test("importFromHoudini throws on invalid extension", () => {
  assert.throws(
    () => importFromHoudini({ hipFile: "scene.hipnc", projectId: "p1" }),
    /Invalid Houdini file format/
  );
});

// =====================================================================
// 25. Store management — imports are stored and retrievable
// =====================================================================
test("imports are stored and retrievable via getImport", () => {
  const result = importFromFigma({
    figmaUrl: "https://figma.com/file/test",
    projectId: "proj-store",
  });
  const stored = getImport(result.import_id);
  assert.deepEqual(stored, result);
});

// =====================================================================
// 26. Store management — exports are stored and retrievable
// =====================================================================
test("exports are stored and retrievable via getExport", () => {
  const result = exportToPremiere({ projectId: "proj-store2" });
  const stored = getExport(result.export_id);
  assert.deepEqual(stored, result);
});

// =====================================================================
// 27. listImports — filters by source
// =====================================================================
test("listImports filters by source correctly", () => {
  importFromFigma({ figmaUrl: "https://figma.com/file/a", projectId: "p1" });
  importFromBlender({ blendFile: "s.blend", projectId: "p2" });
  importFromCanva({ canvaUrl: "https://canva.com/design/b", projectId: "p3" });

  const figmaImports = listImports({ source: "figma" });
  assert.equal(figmaImports.length, 1);
  assert.equal(figmaImports[0].source, "figma");

  const blenderImports = listImports({ source: "blender" });
  assert.equal(blenderImports.length, 1);
  assert.equal(blenderImports[0].source, "blender");
});

// =====================================================================
// 28. listExports — filters by format
// =====================================================================
test("listExports filters by format correctly", () => {
  exportToPremiere({ projectId: "p1" });
  exportToDavinci({ projectId: "p2" });
  exportToFinalCut({ projectId: "p3" });
  exportToPremiere({ projectId: "p4" });

  const xmlExports = listExports({ format: "xml" });
  assert.equal(xmlExports.length, 2);

  const drpExports = listExports({ format: "drp" });
  assert.equal(drpExports.length, 1);

  const fcpxExports = listExports({ format: "fcpxml" });
  assert.equal(fcpxExports.length, 1);
});

// =====================================================================
// 29. listImports — filters by projectId
// =====================================================================
test("listImports filters by projectId correctly", () => {
  importFromFigma({ figmaUrl: "https://figma.com/file/x", projectId: "proj-filter" });
  importFromBlender({ blendFile: "s.blend", projectId: "proj-filter" });
  importFromCanva({ canvaUrl: "https://canva.com/design/y", projectId: "proj-other" });

  const filtered = listImports({ projectId: "proj-filter" });
  assert.equal(filtered.length, 2);
});

// =====================================================================
// 30. removeImport — removes by ID
// =====================================================================
test("removeImport removes an import by ID", () => {
  const result = importFromHoudini({ hipFile: "test.hip", projectId: "p1" });
  const removeResult = removeImport(result.import_id);
  assert.equal(removeResult.ok, true);
  assert.equal(removeResult.import_id, result.import_id);
  assert.equal(getImport(result.import_id), undefined);
});

// =====================================================================
// 31. removeImport — returns error for unknown ID
// =====================================================================
test("removeImport returns error for unknown ID", () => {
  const removeResult = removeImport("houdini-unknown");
  assert.equal(removeResult.ok, false);
  assert.ok(removeResult.error.includes("not found"));
});

// =====================================================================
// 32. removeExport — removes by ID
// =====================================================================
test("removeExport removes an export by ID", () => {
  const result = exportToDavinci({ projectId: "p1" });
  const removeResult = removeExport(result.export_id);
  assert.equal(removeResult.ok, true);
  assert.equal(removeResult.export_id, result.export_id);
  assert.equal(getExport(result.export_id), undefined);
});

// =====================================================================
// 33. removeExport — returns error for unknown ID
// =====================================================================
test("removeExport returns error for unknown ID", () => {
  const removeResult = removeExport("davinci-fake");
  assert.equal(removeResult.ok, false);
  assert.ok(removeResult.error.includes("not found"));
});

// =====================================================================
// 34. _resetStores — clears all records
// =====================================================================
test("_resetStores clears all import and export records", () => {
  importFromFigma({ figmaUrl: "https://figma.com/file/r", projectId: "p1" });
  exportToPremiere({ projectId: "p2" });

  assert.equal(_getImports().size, 1);
  assert.equal(_getExports().size, 1);

  _resetStores();

  assert.equal(_getImports().size, 0);
  assert.equal(_getExports().size, 0);
});

// =====================================================================
// 35. listImports — returns all when no filter
// =====================================================================
test("listImports returns all imports when no filter applied", () => {
  importFromFigma({ figmaUrl: "https://figma.com/file/1", projectId: "p1" });
  importFromCanva({ canvaUrl: "https://canva.com/design/2", projectId: "p2" });
  importFromBlender({ blendFile: "s.blend", projectId: "p3" });

  const all = listImports();
  assert.equal(all.length, 3);
});

// =====================================================================
// 36. listExports — returns all when no filter
// =====================================================================
test("listExports returns all exports when no filter applied", () => {
  exportToPremiere({ projectId: "p1" });
  exportToDavinci({ projectId: "p2" });
  exportToFinalCut({ projectId: "p3" });

  const all = listExports();
  assert.equal(all.length, 3);
});
