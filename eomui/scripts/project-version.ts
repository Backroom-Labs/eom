// The app is released with the firmware from one tag, so its version is the firmware's
// PROJECT_VER (the release workflow checks the tag against it), not package.json's.
export function projectVersion(cmakeLists: string): string {
  const match = /^\s*set\(\s*PROJECT_VER\s+"([^"]+)"\s*\)/m.exec(cmakeLists);
  if (!match) throw new Error('No set(PROJECT_VER "...") found in the top-level CMakeLists.txt');
  return match[1];
}
