// Run from eomui/: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { projectVersion } from "../scripts/project-version.ts";

test("the app's version is PROJECT_VER from the top-level CMakeLists.txt", () => {
  const cmake = 'cmake_minimum_required(VERSION 3.16.0)\nset(PROJECT_VER "3.8.0-beta.1")\ninclude($ENV{IDF_PATH}/tools/cmake/project.cmake)\n';
  assert.equal(projectVersion(cmake), "3.8.0-beta.1");
});

test("a CMakeLists.txt without PROJECT_VER is refused rather than giving a wrong version", () => {
  assert.throws(() => projectVersion("project(eom)\n"), /PROJECT_VER/);
  assert.throws(() => projectVersion('set(PROJECT_VER "")\n'), /PROJECT_VER/);
});
