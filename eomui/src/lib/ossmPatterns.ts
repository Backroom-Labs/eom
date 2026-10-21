// An OSSM's stroke patterns, read from its pattern characteristic on connect.

export interface OSSMPattern {
  name: string;
  idx: number;
}

// The OSSM's first pattern, used when its pattern list can't be read, so the panel still has one to show.
const FALLBACK: OSSMPattern[] = [{ name: "Simple Stroke", idx: 0 }];

// Reads and parses the pattern list. Never throws: a failed read, garbled JSON or an empty list gives Simple Stroke alone.
export async function readOssmPatterns(read: () => Promise<DataView>): Promise<OSSMPattern[]> {
  try {
    const list = JSON.parse(new TextDecoder().decode(await read()));
    if (!Array.isArray(list) || list.length === 0) throw new Error("no patterns in the list");
    let indexFallback = 0;
    return list.map((pattern: any) => ({ name: String(pattern.name), idx: pattern.idx ?? indexFallback++ }));
  } catch (error) {
    console.error("Failed to read patterns:", error);
    return FALLBACK.map((pattern) => ({ ...pattern }));
  }
}
