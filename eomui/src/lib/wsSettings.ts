// Setting changes over WebSocket, and the EOM's replies to them (doc/WebSocket.md).

const LOCKED_ERRNO = 2;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The commands in a WebSocket message that the EOM refused because the Settings lock is on.
export function lockedCommands(msg: unknown): string[] {
  if (!isObject(msg)) return [];
  return Object.keys(msg).filter((name) => isObject(msg[name]) && (msg[name] as Record<string, unknown>).errno === LOCKED_ERRNO);
}

// An accepted configSet gets no reply, so each one goes out with a `time` command whose nonce marks
// the reply frame: an errno in that frame means it was refused.
export class WsSettings {
  private send: (frame: string) => void;
  private timeoutMs: number;
  private nextNonce = 1;
  private pending = new Map<number, (ok: boolean) => void>();

  constructor(send: (frame: string) => void, timeoutMs = 3000) {
    this.send = send;
    this.timeoutMs = timeoutMs;
  }

  // Resolves to false if the EOM refused it. Without a reply, it counts as sent, as it did before.
  set(key: string, wire: string | number): Promise<boolean> {
    const nonce = this.nextNonce++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle(true), this.timeoutMs);
      const settle = (ok: boolean) => {
        clearTimeout(timer);
        this.pending.delete(nonce);
        resolve(ok);
      };
      this.pending.set(nonce, settle);
      this.send(JSON.stringify({ configSet: { [key]: wire }, time: { nonce } }));
    });
  }

  // Call with every message the EOM sends.
  receive(msg: unknown) {
    if (!isObject(msg) || !isObject(msg.time)) return;
    const settle = this.pending.get(Number(msg.time.nonce));
    settle?.(!(isObject(msg.configSet) && msg.configSet.errno !== undefined));
  }
}
