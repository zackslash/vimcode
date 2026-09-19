import { beforeEach, describe, expect, it } from "bun:test";
import { createVimState, finishOneShotIfComplete, handleInsertKey, handleNormalKey, type VimState } from "../src/vim";
import { mockPrompt } from "./fixtures";
import { ev } from "./support";

// Isolate resolveLeaderKeys() from the developer's real ~/.config/opencode/cli.json.
process.env.XDG_CONFIG_HOME = "/tmp/opencode/vimcode-test-no-config";

let state: VimState;

beforeEach(() => {
  state = createVimState();
  state.mode = "normal";
});

// ── Ctrl+O one-shot normal mode ───────────────────────────

describe("Ctrl+O one-shot normal mode", () => {
  function enterOneShot() {
    state.mode = "insert";
    handleInsertKey(state, "o", ev("o", { ctrl: true }), mockPrompt);
  }

  it("w auto-returns to insert", () => {
    enterOneShot();
    const r = handleNormalKey(state, "w", ev("w"), mockPrompt);
    finishOneShotIfComplete(state, r);
    expect(state.mode).toBe("insert");
    expect(state.oneShotNormal).toBe(false);
    expect(r.actions).toContainEqual({ type: "mode", mode: "insert" });
  });

  it("3w auto-returns to insert after count is consumed", () => {
    enterOneShot();
    handleNormalKey(state, "3", ev("3"), mockPrompt);
    expect(state.oneShotNormal).toBe(true);
    const r = handleNormalKey(state, "w", ev("w"), mockPrompt);
    finishOneShotIfComplete(state, r);
    expect(state.mode).toBe("insert");
    expect(state.oneShotNormal).toBe(false);
  });

  it("dw auto-returns to insert after operator+motion", () => {
    enterOneShot();
    const r1 = handleNormalKey(state, "d", ev("d"), mockPrompt);
    finishOneShotIfComplete(state, r1);
    expect(state.mode).toBe("normal");
    const r2 = handleNormalKey(state, "w", ev("w"), mockPrompt);
    finishOneShotIfComplete(state, r2);
    expect(state.mode).toBe("insert");
    expect(state.oneShotNormal).toBe(false);
  });

  it("dd auto-returns to insert", () => {
    enterOneShot();
    const r1 = handleNormalKey(state, "d", ev("d"), mockPrompt);
    finishOneShotIfComplete(state, r1);
    const r2 = handleNormalKey(state, "d", ev("d"), mockPrompt);
    finishOneShotIfComplete(state, r2);
    expect(state.mode).toBe("insert");
  });

  it("r{char} auto-returns to insert", () => {
    enterOneShot();
    const r1 = handleNormalKey(state, "r", ev("r"), mockPrompt);
    finishOneShotIfComplete(state, r1);
    expect(state.mode).toBe("normal");
    const r2 = handleNormalKey(state, "a", ev("a"), mockPrompt);
    finishOneShotIfComplete(state, r2);
    expect(state.mode).toBe("insert");
  });

  it("gg auto-returns to insert", () => {
    enterOneShot();
    const r1 = handleNormalKey(state, "g", ev("g"), mockPrompt);
    finishOneShotIfComplete(state, r1);
    expect(state.mode).toBe("normal");
    const r2 = handleNormalKey(state, "g", ev("g"), mockPrompt);
    finishOneShotIfComplete(state, r2);
    expect(state.mode).toBe("insert");
  });

  it("cw enters insert directly without double mode switch", () => {
    enterOneShot();
    const r1 = handleNormalKey(state, "c", ev("c"), mockPrompt);
    finishOneShotIfComplete(state, r1);
    const r2 = handleNormalKey(state, "w", ev("w"), mockPrompt);
    finishOneShotIfComplete(state, r2);
    expect(state.mode).toBe("insert");
    expect(state.oneShotNormal).toBe(false);
    const modeActions = r2.actions.filter((a) => a.type === "mode" && a.mode === "insert");
    expect(modeActions).toHaveLength(1);
  });

  it("u auto-returns to insert", () => {
    enterOneShot();
    const r = handleNormalKey(state, "u", ev("u"), mockPrompt);
    finishOneShotIfComplete(state, r);
    expect(state.mode).toBe("insert");
  });

  it("p auto-returns to insert", () => {
    enterOneShot();
    const r = handleNormalKey(state, "p", ev("p"), mockPrompt);
    finishOneShotIfComplete(state, r);
    expect(state.mode).toBe("insert");
  });

  it(": auto-returns to insert", () => {
    enterOneShot();
    const r = handleNormalKey(state, ":", ev(":"), mockPrompt);
    finishOneShotIfComplete(state, r);
    expect(state.mode).toBe("insert");
  });

  it("e auto-returns to insert", () => {
    enterOneShot();
    const r = handleNormalKey(state, "e", ev("e"), mockPrompt);
    finishOneShotIfComplete(state, r);
    expect(state.mode).toBe("insert");
  });

  it("escape during one-shot returns to insert", () => {
    enterOneShot();
    const r = handleNormalKey(state, "escape", ev("escape"), mockPrompt);
    expect(r.consume).toBe(true);
    expect(state.mode).toBe("insert");
    expect(state.oneShotNormal).toBe(false);
    expect(r.actions).toContainEqual({ type: "mode", mode: "insert" });
  });

  it("v during one-shot cancels one-shot and enters visual", () => {
    enterOneShot();
    handleNormalKey(state, "v", ev("v"), mockPrompt);
    expect(state.mode).toBe("visual");
    expect(state.oneShotNormal).toBe(false);
  });

  it("sequential Ctrl+O usage works (flag resets cleanly)", () => {
    enterOneShot();
    const r1 = handleNormalKey(state, "w", ev("w"), mockPrompt);
    finishOneShotIfComplete(state, r1);
    expect(state.mode).toBe("insert");
    expect(state.oneShotNormal).toBe(false);
    // Second round
    enterOneShot();
    expect(state.oneShotNormal).toBe(true);
    const r2 = handleNormalKey(state, "b", ev("b"), mockPrompt);
    finishOneShotIfComplete(state, r2);
    expect(state.mode).toBe("insert");
    expect(state.oneShotNormal).toBe(false);
  });

  it("cc enters insert directly without double mode switch", () => {
    enterOneShot();
    const r1 = handleNormalKey(state, "c", ev("c"), mockPrompt);
    finishOneShotIfComplete(state, r1);
    const r2 = handleNormalKey(state, "c", ev("c"), mockPrompt);
    finishOneShotIfComplete(state, r2);
    expect(state.mode).toBe("insert");
    expect(state.oneShotNormal).toBe(false);
    const modeActions = r2.actions.filter((a) => a.type === "mode" && a.mode === "insert");
    expect(modeActions).toHaveLength(1);
  });

  it("de auto-returns to insert (deleteRange path)", () => {
    enterOneShot();
    const r1 = handleNormalKey(state, "d", ev("d"), mockPrompt);
    finishOneShotIfComplete(state, r1);
    expect(state.mode).toBe("normal");
    const r2 = handleNormalKey(state, "e", ev("e"), mockPrompt);
    finishOneShotIfComplete(state, r2);
    expect(state.mode).toBe("insert");
    expect(state.oneShotNormal).toBe(false);
    expect(r2.actions.some((a) => a.type === "deleteRange")).toBe(true);
  });

  it("does not auto-return when not in one-shot mode", () => {
    state.mode = "normal";
    state.oneShotNormal = false;
    const r = handleNormalKey(state, "w", ev("w"), mockPrompt);
    finishOneShotIfComplete(state, r);
    expect(state.mode).toBe("normal");
  });

  it("finishOneShotIfComplete does not double-append insert when the result already enters insert", () => {
    state.oneShotNormal = true;
    const result = { consume: true, actions: [{ type: "mode", mode: "insert" } as const] };
    finishOneShotIfComplete(state, result);
    expect(state.oneShotNormal).toBe(false);
    expect(result.actions.filter((a) => a.type === "mode" && a.mode === "insert").length).toBe(1);
  });

  it("Ctrl+O one-shot stays in normal mode while an operator is pending", () => {
    state.oneShotNormal = true;
    const result = handleNormalKey(state, "d", ev("d"), mockPrompt);
    finishOneShotIfComplete(state, result);
    expect(state.mode).toBe("normal");
  });
});

describe("version sync", () => {
  it("VERSION matches package.json", async () => {
    const pkg = await import("../package.json");
    const { VERSION } = await import("../src/version");
    expect(VERSION).toBe(pkg.version);
  });
});

// ── V2 mock context harness ───────────────────────────────

// Shape of one command inside a keymap layer (subset the harness needs).
type MockCommand = {
  id?: string;
  bind?: string;
  /* biome-ignore lint/suspicious/noExplicitAny: event shape is host-owned */
  run: (input?: unknown, event?: any) => unknown;
};
type MockLayer = { commands?: MockCommand[] };

// Builds a minimal V2 plugin context: sparse by design — fields may be
// undefined or stubs, which is exactly the hostile environment we need to
// survive (the scenario that crashed v0.7.0).
function createMockContext(init: {
  options?: Record<string, unknown>;
  editor?: unknown;
  route?: { type: string; sessionID?: string };
  mode?: string;
  sessions?: Record<string, { parentID?: string }>;
  permissions?: unknown[];
}) {
  const dispatched: string[] = [];
  const toasts: string[] = [];
  const events = new Map<string, (e: unknown) => void>();
  let listener: ((e: { details: Record<string, unknown> }) => void) | undefined;
  let layer: (() => MockLayer) | undefined;
  const store: Record<string, unknown> = {};
  const sessions = init.sessions ?? {};
  const slotCalls = { count: 0 };
  const layerCalls = { count: 0 };
  let mode = init.mode ?? "base";

  const ctx = {
    options: init.options ?? {},
    location: undefined,
    storage: {
      store: (_key: string, o: { initial: Record<string, unknown> }) => [
        Object.assign(store, o.initial),
        (mutation: (draft: Record<string, unknown>) => void) => {
          mutation(store);
        },
      ],
    },
    ui: {
      toast: {
        show: (opts: { message: string }) => {
          toasts.push(opts.message);
        },
      },
      router: { current: () => init.route ?? { type: "home" } },
      // Simulates a mount: the plugin claims the slot and the render returns
      // a component element; invoking render mounts the component, which is
      // what registers the keymap layer (blessed v2.0.8 pattern).
      slot: (claim: { render: (input: unknown) => unknown }) => {
        slotCalls.count += 1;
        claim.render({});
        return () => {};
      },
    },
    keymap: {
      layer: (fn: () => MockLayer) => {
        layerCalls.count += 1;
        layer = fn;
      },
      mode: { current: () => mode },
      dispatch: (id: string) => {
        dispatched.push(id);
      },
    },
    data: {
      on: (type: string, h: (e: unknown) => void) => {
        events.set(type, h);
        return () => events.delete(type);
      },
      listen: (h: (e: { details: Record<string, unknown> }) => void) => {
        listener = h;
        return () => {
          listener = undefined;
        };
      },
      session: {
        get: (id: string) => sessions[id],
        form: { list: () => [] },
        permission: { list: () => init.permissions ?? [] },
      },
    },
    renderer: { currentFocusedEditor: init.editor },
  };

  let loaded = false;
  const load = async () => {
    if (loaded) return;
    const plugin = (await import("../src/index")).default;
    plugin.setup(ctx);
    loaded = true;
  };

  // Drives the one shared key command: every bound key's run delegates to
  // the same handleKey, so any bind works. Gating is entirely inside run()
  // (no reactive `enabled` — v2.0.8 drops commands that carry it), so the
  // returned boolean is whatever run() decided. Returns whether it consumed.
  const press = (name: string, opts: Record<string, boolean> = {}) => {
    const cmd = layer?.()?.commands?.find((c) => c.bind !== undefined);
    if (!cmd) throw new Error("no keymap layer registered");
    const result = cmd.run(undefined, { name, eventType: "press", ...opts });
    return result !== false;
  };

  // Fires an event through the catch-all data.listen channel.
  const emit = (type: string, properties: Record<string, unknown>) => {
    listener?.({ details: { type, ...properties } });
  };

  const setMode = (next: string) => {
    mode = next;
  };

  const layerConfig = () => layer?.();

  return { ctx, dispatched, toasts, events, load, press, emit, setMode, layerConfig, slotCalls, layerCalls };
}

// ── plugin init sanity check ──────────────────────────────

describe("plugin init", () => {
  it("setup() does not throw with a minimal mock context", async () => {
    const plugin = (await import("../src/index")).default;
    expect(plugin.id).toBe("vimcode");
    const { load } = createMockContext({});
    // Should not throw with a sparse mock context.
    await load();
  });
});

// ── undo snapshot integration ─────────────────────────────

describe("undo snapshot — deleteRange + u", () => {
  // Exercises the full pipeline: key event → handler → applyActions → editor state.
  // The contract: u after dG restores the full buffer in one step via
  // editBuffer.setText, not the host's per-line input.undo.

  function createMockEditor(text: string, cursor: number) {
    let editorText = text;
    let editorCursor = cursor;
    const calls: { method: string; args: unknown[] }[] = [];
    const editor = {
      get plainText() {
        return editorText;
      },
      get cursorOffset() {
        return editorCursor;
      },
      set cursorOffset(v: number) {
        editorCursor = v;
      },
      visualCursor: { logicalRow: 1 },
      cursorStyle: { style: "block" as const, blinking: true },
      insertText: () => {},
      setSelectionInclusive: () => {},
      editorView: { resetSelection: () => {} },
      editBuffer: {
        deleteRange: (sl: number, sc: number, el: number, ec: number) => {
          calls.push({ method: "deleteRange", args: [sl, sc, el, ec] });
          editorText = editorText.substring(0, cursor);
        },
        setText: (t: string) => {
          calls.push({ method: "setText", args: [t] });
          editorText = t;
        },
      },
    };
    return { editor, calls, getText: () => editorText, getCursor: () => editorCursor };
  }

  async function setup(text: string, cursor: number) {
    const { editor, calls, getText, getCursor } = createMockEditor(text, cursor);
    const mock = createMockContext({ editor });
    await mock.load();

    // Enter normal mode
    mock.press("escape");

    return { press: mock.press, calls, dispatched: mock.dispatched, getText, getCursor };
  }

  it("u after dG restores the full buffer via editBuffer.setText", async () => {
    const original = "hello world\nsecond line\nthird line";
    const { press, calls, dispatched, getCursor } = await setup(original, 12);

    press("d");
    press("g", { shift: true });
    expect(calls.some((c) => c.method === "deleteRange")).toBe(true);

    calls.length = 0;
    press("u");

    expect(calls).toContainEqual({ method: "setText", args: [original] });
    expect(getCursor()).toBe(12);
    expect(dispatched).not.toContain("input.undo");
  });

  it("u after dG then a motion falls back to host input.undo", async () => {
    const { press, calls, dispatched } = await setup("hello world\nsecond line\nthird line", 12);

    press("d");
    press("g", { shift: true });
    expect(calls.some((c) => c.method === "deleteRange")).toBe(true);

    // h dispatches input.move.left (a cmd action), invalidating the snapshot
    press("h");

    calls.length = 0;
    dispatched.length = 0;
    press("u");

    expect(calls.every((c) => c.method !== "setText")).toBe(true);
    // input.undo is dispatched via setTimeout
    await new Promise((r) => setTimeout(r, 20));
    expect(dispatched).toContain("input.undo");
  });

  it("u after 3dw restores the full buffer via editBuffer.setText", async () => {
    const original = "hello world second line third line";
    const { press, calls, dispatched, getCursor } = await setup(original, 0);

    press("3");
    press("d");
    press("w");

    calls.length = 0;
    press("u");

    expect(calls).toContainEqual({ method: "setText", args: [original] });
    expect(getCursor()).toBe(0);
    expect(dispatched).not.toContain("input.undo");
  });

  it("u after 3dw then dd unwinds the snapshot stack one step per press", async () => {
    const original = "hello world second line third line";
    const { press, calls, dispatched } = await setup(original, 0);

    // Two stacked undoable changes → two snapshots on the stack.
    press("3");
    press("d");
    press("w");
    press("d");
    press("d");

    // First u pops the dd snapshot, second pops the 3dw snapshot — each a
    // local restore via setText, never the host's input.undo.
    calls.length = 0;
    dispatched.length = 0;
    press("u");
    expect(calls.some((c) => c.method === "setText")).toBe(true);
    expect(dispatched).not.toContain("input.undo");

    calls.length = 0;
    press("u");
    expect(calls.some((c) => c.method === "setText")).toBe(true);
    expect(dispatched).not.toContain("input.undo");

    // Stack is now empty — a third u falls through to host undo.
    calls.length = 0;
    press("u");
    expect(calls.every((c) => c.method !== "setText")).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(dispatched).toContain("input.undo");
  });

  it("u after 3dw then an insert-mode edit falls back to host input.undo", async () => {
    const { press, calls, dispatched } = await setup("hello world second line third line", 0);

    press("3");
    press("d");
    press("w");

    // Enter insert and modify the buffer. The insert edit emits an
    // insertText action, which clears the vim snapshot stack.
    press("i");
    press("tab");
    press("escape");

    calls.length = 0;
    dispatched.length = 0;
    press("u");

    expect(calls.every((c) => c.method !== "setText")).toBe(true);
    // input.undo is dispatched via setTimeout
    await new Promise((r) => setTimeout(r, 20));
    expect(dispatched).toContain("input.undo");
  });
});

// ── arrow keys pass through the key layer (issue #63) ─────

describe("arrow keys pass through the key layer", () => {
  // #63: in normal mode the plugin consumed arrow keys, so OpenCode never
  // saw them and couldn't exit the subagent view. This drives the real
  // pipeline (plugin.setup → keymap layer command) and asserts the command
  // does not consume arrows, while a vim motion still is.
  async function setup() {
    const mock = createMockContext({ editor: undefined, options: { updateCheck: false } });
    await mock.load();
    mock.press("escape"); // leave insert, enter normal mode
    return { press: mock.press };
  }

  for (const arrow of ["up", "down", "left", "right"] as const) {
    it(`${arrow} in normal mode is not consumed, so the host handles it`, async () => {
      const { press } = await setup();
      expect(press(arrow)).toBe(false);
    });
  }

  it("a vim motion (j) is still consumed, proving the harness detects consumption", async () => {
    const { press } = await setup();
    expect(press("j")).toBe(true);
  });
});

// ── modifier binds + reactive layer gating ────────────────

describe("modifier combos and layer gating", () => {
  it("ctrl+return in insert mode is consumed and dispatches input.submit", async () => {
    const mock = createMockContext({ editor: undefined, options: { updateCheck: false } });
    await mock.load();
    // Still in insert mode (no escape first).
    expect(mock.press("return", { ctrl: true })).toBe(true);
    // cmd actions are dispatched deferred (setTimeout 0).
    await new Promise((r) => setTimeout(r, 10));
    expect(mock.dispatched).toContain("input.submit");
  });

  it("ctrl+o in insert mode enters one-shot normal mode", async () => {
    const mock = createMockContext({ editor: undefined, options: { updateCheck: false } });
    await mock.load();
    expect(mock.press("o", { ctrl: true })).toBe(true);
    expect(mock.toasts).toContain("(insert)");
  });

  it("normal-mode ctrl+letter passes through to the host", async () => {
    const mock = createMockContext({ editor: undefined, options: { updateCheck: false } });
    await mock.load();
    mock.press("escape"); // enter normal mode
    expect(mock.press("a", { ctrl: true })).toBe(false);
  });

  it("a pending permission on the session route makes keys pass through", async () => {
    const mock = createMockContext({
      editor: undefined,
      options: { updateCheck: false },
      route: { type: "session", sessionID: "root" },
      permissions: [{ id: "p1" }],
    });
    await mock.load();
    mock.press("escape");
    expect(mock.press("h")).toBe(false);
  });

  it("a foreign input mode makes key commands pass through; palette commands stay reachable", async () => {
    const mock = createMockContext({ editor: undefined, options: { updateCheck: false } });
    await mock.load();
    mock.press("escape"); // enter normal mode; baseline mode was "base"
    expect(mock.press("j")).toBe(true);

    mock.setMode("modal");
    // handleKey passes the key through when a foreign mode is active...
    expect(mock.press("j")).toBe(false);
    // ...and palette commands carry no mode gating at all (no `enabled`
    // anywhere — v2.0.8 drops commands that carry it, and they must stay
    // listed since the palette itself pushes a foreign mode while open).
    const commands = mock.layerConfig()?.commands ?? [];
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.every((c) => c.enabled === undefined)).toBe(true);

    mock.setMode("base");
    expect(mock.press("j")).toBe(true);
  });

  it("claims the slot once and registers the layer once per mount", async () => {
    const mock = createMockContext({ editor: undefined, options: { updateCheck: false } });
    await mock.load();
    // setup() claims the slot exactly once; the component body (one mount)
    // registers the layer exactly once.
    expect(mock.slotCalls.count).toBe(1);
    expect(mock.layerCalls.count).toBe(1);
  });

  it("keys pass through while a question is pending, then resume after question.rejected", async () => {
    const { press, emit } = await setup();

    emit("question.asked", { id: "q1", sessionID: "root" });
    expect(press("h")).toBe(false);

    emit("question.rejected", { requestID: "q1", sessionID: "root" });
    expect(press("h")).toBe(true);
  });

  it("question.replied also resumes key consumption", async () => {
    const { press, emit } = await setup();

    emit("question.asked", { id: "q1", sessionID: "root" });
    expect(press("h")).toBe(false);

    emit("question.replied", { requestID: "q1", sessionID: "root" });
    expect(press("h")).toBe(true);
  });

  it("permission.replied resumes key consumption", async () => {
    const { press, emit } = await setup();

    emit("permission.asked", { id: "p1", sessionID: "root" });
    expect(press("h")).toBe(false);

    emit("permission.replied", { requestID: "p1", sessionID: "root" });
    expect(press("h")).toBe(true);
  });

  it("a prompt on a child session is tracked against its root", async () => {
    const { press, emit } = await setup();

    emit("question.asked", { id: "q1", sessionID: "child" });
    expect(press("h")).toBe(false);

    emit("question.rejected", { requestID: "q1", sessionID: "child" });
    expect(press("h")).toBe(true);
  });
});
