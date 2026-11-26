export type ListeningOutcome = "active" | "ended" | "replaced" | "transition" | "error" | "interrupted";
export type PlayEvent = {
  id: string;
  sessionId: string;
  songId: string;
  startedAt: number;
  updatedAt: number;
  endedAt: number | null;
  msListened: number;
  outcome: ListeningOutcome;
  contextType: "library" | "playlist";
  contextId: string | null;
};

type PlaybackSample = { currentTime: number; paused: boolean; seeking: boolean; playbackRate: number };

// No timers or audio ownership here: the player supplies observations and lifecycle boundaries.
export class ListeningHistory {
  private event: PlayEvent | null = null;
  private lastPosition = 0;
  private lastTick = 0;
  private lastWrite = 0;
  private listened = 0;
  private running = false;
  private readonly sessionId: string;
  private readonly write: (event: PlayEvent) => void;
  private readonly now: () => number;
  private readonly monotonic: () => number;
  private readonly uuid: () => string;

  constructor(write: (event: PlayEvent) => void, now = Date.now,
    monotonic = () => performance.now(), uuid = () => crypto.randomUUID()) {
    this.write = write;
    this.now = now;
    this.monotonic = monotonic;
    this.uuid = uuid;
    this.sessionId = uuid();
  }

  play(songId: string, position: number, playlistId: string | null = null) {
    if (this.event?.songId !== songId) this.finish("replaced");
    if (!this.event) {
      const startedAt = this.now();
      this.event = { id: this.uuid(), sessionId: this.sessionId, songId, startedAt, updatedAt: startedAt,
        endedAt: null, msListened: 0, outcome: "active", contextType: playlistId ? "playlist" : "library", contextId: playlistId };
      this.listened = 0;
      this.checkpoint();
    }
    this.lastPosition = position;
    this.lastTick = this.monotonic();
    this.running = true;
  }

  sample(audio: PlaybackSample) {
    if (!this.event) return;
    const tick = this.monotonic();
    const elapsed = Math.max(0, tick - this.lastTick);
    const progress = audio.currentTime - this.lastPosition;
    const rate = Math.max(0.25, audio.playbackRate || 1);
    // Reject discontinuities; use wall listening milliseconds, not media time at fast/slow rates.
    if (this.running && !audio.seeking && progress > 0 && elapsed <= 5000 && progress <= elapsed * rate / 1000 + 0.25) {
      this.listened += Math.min(elapsed, progress * 1000 / rate);
    }
    this.lastPosition = audio.currentTime;
    this.lastTick = tick;
    this.running = !audio.paused && !audio.seeking;
    if (tick - this.lastWrite >= 15_000) this.checkpoint();
  }

  discontinuity(position: number) {
    this.lastPosition = position;
    this.lastTick = this.monotonic();
  }

  pause(audio: PlaybackSample) {
    this.sample(audio);
    this.running = false;
    this.checkpoint();
  }

  finish(outcome: Exclude<ListeningOutcome, "active">) {
    if (!this.event) return;
    this.checkpoint(outcome);
    this.event = null;
    this.running = false;
  }

  private checkpoint(outcome: ListeningOutcome = "active") {
    if (!this.event) return;
    const updatedAt = Math.max(this.event.updatedAt, this.now());
    this.event = { ...this.event, updatedAt, msListened: Math.min(Math.floor(this.listened), updatedAt - this.event.startedAt),
      outcome, endedAt: outcome === "active" ? null : updatedAt };
    this.lastWrite = this.monotonic();
    this.write({ ...this.event });
  }
}

export type PlayEventReceipt = { status: "stored" } | { status: "discarded"; reason: "not-recordable" };

export function isListeningJournal(value: unknown): value is PlayEvent[] {
  return Array.isArray(value) && value.every(event => event && ["id","sessionId","songId"].every(key => typeof event[key] === "string" && event[key].length > 0) &&
    [event.startedAt,event.updatedAt,event.msListened].every(Number.isSafeInteger) &&
    event.startedAt > 0 && event.updatedAt >= event.startedAt && event.msListened >= 0 &&
    ["active","ended","replaced","transition","error","interrupted"].includes(event.outcome) &&
    event.endedAt === (event.outcome === "active" ? null : event.updatedAt) &&
    (event.contextType === "library" || (event.contextType === "playlist" && typeof event.contextId === "string")));
}

export function createListeningEventWriter(write: (event: PlayEvent) => Promise<boolean | PlayEventReceipt>, journal: (events: PlayEvent[]) => void, recovered: PlayEvent[] = [], failed: (durable: boolean, saved: boolean) => void = () => {}) {
  const pending = new Map(recovered.map(event => [event.id, event]));
  let running: Promise<boolean> | null = null;
  const persist = () => {
    try { journal([...pending.values()]); return true; }
    catch { return false; }
  };
  async function drain() {
    while (pending.size) {
      const event = pending.values().next().value as PlayEvent;
      try {
        const receipt = await write(event);
        if (receipt !== true && !(typeof receipt === "object" && receipt !== null &&
          (receipt.status === "stored" || (receipt.status === "discarded" && receipt.reason === "not-recordable")))) {
          throw new Error("Listening event was not acknowledged");
        }
      } catch { failed(persist(), false); return false; }
      if (pending.get(event.id) === event) pending.delete(event.id);
      persist();
    }
    if (!persist()) { failed(false, true); return false; }
    return true;
  }
  const flush = (): Promise<boolean> => {
    if (running) return running;
    running = drain().then(ok => {
      running = null;
      return ok && pending.size ? flush() : ok;
    }, error => { running = null; throw error; });
    return running;
  };
  return {flush, enqueue(event: PlayEvent) {
    const prior = pending.get(event.id);
    if (prior && (prior.updatedAt > event.updatedAt || (prior.outcome !== "active" && event.outcome === "active"))) return;
    pending.set(event.id, event);
    if (!persist()) failed(false, false);
    void flush();
  }};
}
