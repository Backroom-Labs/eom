// A toy on the real Buttplug client, with the wire to the server replaced by a list of sent
// messages, each stamped with Date.now() (mocked in tests that check timing).
import { ButtplugClientDevice, type ButtplugMessage } from "buttplug";

export type Wire = { at: number; msg: ButtplugMessage };

export type FakeOutput = Record<string, { Value: number[]; Duration?: number[] }>;

export function fakeToy(output: FakeOutput, timingGapMs?: number) {
  const wire: Wire[] = [];
  const toy = ButtplugClientDevice.fromMsg(
    {
      DeviceIndex: 3,
      DeviceName: "Toy",
      DeviceFeatures: { 0: { FeatureIndex: 0, FeatureDescriptor: "", Output: output, Input: {} } },
      DeviceMessageTimingGap: timingGapMs,
    },
    async (msg) => { wire.push({ at: Date.now(), msg }); return { Ok: { Id: 1 } }; },
  );
  const sent = () => wire.map((w) => w.msg);
  // The output commands that reached the toy, as { type: value }.
  const outputs = () => wire.filter((w) => w.msg.OutputCmd).map((w) => w.msg.OutputCmd!.Command as Record<string, { Value: number; Duration?: number }>);
  return { toy, feature: toy.features.get(0)!, wire, sent, outputs };
}

// Lets pending promise callbacks run.
export const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
