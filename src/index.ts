import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { writeClipboard } from "./clipboard";
import { findMatchingLeader, type KeyLike, leaderChar } from "./leader";
import { checkForUpdate } from "./version";
import {
  type Action,
  createVimState,
  finishOneShotIfComplete,
  handleInsertKey,
  handleNormalKey,
  handleVisualKey,
  toggleVimMode,
  translateKey,
} from "./vim";

// V2 plugin seam. The official types live in @opencode/plugin/tui, whose type
// graph pulls in @opentui/core and solid-js — packages the host provides at
// runtime and that must NOT be installed into the plugin (local stubs would
// shadow the host's module intercepts). The context is therefore typed as
// `any` and every access is defensive (`?.`), same as the V1 api seam.
/* biome-ignore lint/suspicious/noExplicitAny: plugin-API seam, host-owned types */
type V2Context = any;

type V2Plugin = { id: string; setup: (context: V2Context) => (() => void) | undefined };

// The host injects @opencode/plugin/tui and Plugin.define is identity, so a
// plain module object with the same shape resolves identically without a
// runtime import of the SDK specifier.
const plugin: V2Plugin = {
  id: "vimcode",
  setup(context: V2Context) {
    const state = createVimState();
    const options = context?.options ?? {};
    const startMode = options?.startMode === "normal" ? "normal" : "insert";
    state.mode = startMode;
    // Resolved once at setup: the CLI config rarely changes mid-session, and
    // re-reading it per keypress would add file I/O to the hot path.
    const leaderKeys = resolveLeaderKeys();

    // Resolve modeIndicator: "toast" (default) or "none".
    // Backward compat: modeToast:false maps to "none", but only if
    // modeIndicator isn't explicitly set.
    const modeIndicator: "toast" | "none" =
      options?.modeIndicator === "toast" || options?.modeIndicator === "none"
        ? options.modeIndicator
        : options?.modeToast === false
          ? "none"
          : "toast";

    const toast = (opts: { message: string; variant: string; duration: number }) => context?.ui?.toast?.show?.(opts);
    const dispatch = (cmd: string) => {
      try {
        context?.keymap?.dispatch?.(cmd);
      } catch {
        // The keymap bridge resolves its provider only inside the app's
        // component tree; failing silently is the same contract as V1's
        // dispatch-on-missing-command.
      }
    };

    // Tiny async kv shim over the V2 durable store so version.ts and the
    // disabled flag keep their get/set shape.
    function createKv() {
      try {
        const entry = context?.storage?.store?.("vimcode", { initial: {} });
        if (Array.isArray(entry) && entry.length >= 2) {
          const [value, update] = entry;
          return {
            get: async (key: string) => value?.[key],
            set: async (key: string, v: unknown) => {
              // biome-ignore lint/suspicious/noExplicitAny: store draft is untyped at the seam
              await update?.((draft: any) => {
                draft[key] = v;
              });
            },
          };
        }
      } catch {}
      return {
        get: async (_key: string) => undefined as unknown,
        set: async (_key: string, _v: unknown) => {},
      };
    }
    const kv = createKv();

    // Restoring the persisted disabled state is async in V2 (setup is sync),
    // so it lands shortly after startup instead of blocking it.
    kv.get("disabled")
      .then((v) => {
        state.disabled = v === true;
        if (state.disabled) {
          toast({ message: "Vim mode disabled (use /vim to re-enable)", variant: "info", duration: 3000 });
        }
      })
      .catch(() => {});

    // Track whether the previous key was the leader, so the follow-up
    // key also passes through to OpenCode's leader system.
    let leaderPending = false;
    let leaderTimer: ReturnType<typeof setTimeout> | null = null;

    // Track pending permissions/questions from child sessions via events.
    // list() only covers one session ID, but subagent prompts live on child
    // IDs. Events fire globally; we aggregate by root.
    const pendingChildPrompts = new Map<string, number>();

    // biome-ignore lint/suspicious/noExplicitAny: event shape is untyped at the seam
    function trackPromptEvent(event: any, delta: number) {
      const sessionID = event?.properties?.sessionID ?? event?.sessionID;
      if (!sessionID) return;
      const session = context?.data?.session?.get?.(sessionID);
      const rootId = session?.parentID ?? sessionID;
      const count = (pendingChildPrompts.get(rootId) ?? 0) + delta;
      if (count <= 0) pendingChildPrompts.delete(rootId);
      else pendingChildPrompts.set(rootId, count);
    }

    const disposers: Array<() => void> = [];

    // Prefer the catch-all listener: V2 event names are still settling
    // (question → form), and subscribing to both the listener and specific
    // data.on types would double-count prompts.
    if (typeof context?.data?.listen === "function") {
      const off = context.data.listen((event: { details?: unknown }) => {
        /* biome-ignore lint/suspicious/noExplicitAny: event shape is untyped at the seam */
        const details = event?.details as any;
        const type = details?.type ?? details?.name;
        if (typeof type !== "string" || !/^(permission|question|form)\./.test(type)) return;
        if (/\.(asked|created)$/.test(type)) trackPromptEvent(details, 1);
        else if (/\.(replied|rejected|answered)$/.test(type)) trackPromptEvent(details, -1);
      });
      if (typeof off === "function") disposers.push(off);
    } else {
      // Fallback for hosts without data.listen: explicit subscriptions.
      for (const [type, delta] of [
        ["permission.asked", 1],
        ["permission.replied", -1],
        ["question.asked", 1],
        ["question.replied", -1],
        // Dismissing a question emits question.rejected, not question.replied.
        // Without this the +1 from question.asked never balances and the
        // plugin stays stuck passing every key through to the host.
        ["question.rejected", -1],
      ] as const) {
        try {
          /* biome-ignore lint/suspicious/noExplicitAny: event shape is untyped at the seam */
          const off = context?.data?.on?.(type, (e: any) => trackPromptEvent(e, delta));
          if (typeof off === "function") disposers.push(off);
        } catch {}
      }
    }

    function currentSessionID(): string | undefined {
      const route = context?.ui?.router?.current?.();
      if (!route) return undefined;
      // V2 routes are a discriminated union on `type`; read `name` as a
      // defensive fallback in case a host ships the V1-ish shape.
      const kind = route.type ?? route.name;
      if (kind === "session") return route.sessionID;
      return typeof route.sessionID === "string" ? route.sessionID : undefined;
    }

    function hasActivePrompts(sid: string): boolean {
      const location = context?.location;
      const forms = context?.data?.session?.form?.list?.(sid, location) ?? [];
      if (forms.length > 0) return true;
      const perms = context?.data?.session?.permission?.list?.(sid) ?? [];
      if (perms.length > 0) return true;
      return (pendingChildPrompts.get(sid) ?? 0) > 0;
    }

    // True when something other than the main input owns the keyboard
    // (dialogs, question/permission overlays). Dialogs register modal
    // keymap layers, which show up as non-default modes here. Only treat a
    // positively-identified non-default mode as an overlay; if the value is
    // missing or unrecognizable we keep vim handling (don't pass through).
    const NON_OVERLAY_MODES = new Set(["", "base", "normal", "global", "home", "default"]);
    function overlayActive(): boolean {
      let mode: unknown;
      try {
        mode = context?.keymap?.mode?.current?.();
      } catch {
        return false;
      }
      if (mode == null) return false;
      if (typeof mode === "string") return !NON_OVERLAY_MODES.has(mode);
      const name =
        typeof mode === "object"
          ? ((mode as { name?: unknown; id?: unknown; mode?: unknown }).name ??
            (mode as { id?: unknown }).id ??
            (mode as { mode?: unknown }).mode)
          : undefined;
      return typeof name === "string" ? !NON_OVERLAY_MODES.has(name) : false;
    }

    // Reads the current input mode; undefined when it can't be determined
    // (missing, non-string, or the provider lookup throws outside the tree).
    function safeModeCurrent(): string | undefined {
      try {
        const mode = context?.keymap?.mode?.current?.();
        return typeof mode === "string" ? mode : undefined;
      } catch {
        return undefined;
      }
    }

    // Baseline input mode captured when the layer registers. Foreign input
    // modes (dialogs, custom modes) then disable the whole layer reactively
    // via `enabled`, so overlays whose key handling doesn't outrank ours
    // still get their keys. Self-calibrating: if no baseline could be read,
    // the layer stays always-enabled (the per-key checks remain the backstop).
    let baselineMode: string | undefined;
    function vimLayerActive(): boolean {
      if (baselineMode === undefined) return true;
      const mode = safeModeCurrent();
      // Throwing/undeterminable mode: keep vim handling rather than
      // permanently bricking the layer.
      if (mode === undefined) return true;
      return mode === baselineMode;
    }

    // Snapshots for single-step undo of vim changes.
    // The host editor's undo system splits repeated commands into multiple
    // entries, so we save/restore the buffer ourselves.
    let undoSnapshots: Array<{ text: string; cursor: number }> = [];

    const prompt = {
      getLine: (n: number) => getInputText().split("\n")[n] ?? "",
      getLineCount: () => getInputText().split("\n").length,
      getCursorLine: () => context?.renderer?.currentFocusedEditor?.visualCursor?.logicalRow ?? 0,
      getCursorOffset: () => context?.renderer?.currentFocusedEditor?.cursorOffset ?? 0,
      getPlainText: () => getInputText(),
    };

    // api.prompt doesn't exist on the plugin API. The actual text lives on
    // the focused editor exposed by the renderer.
    function getInputText(): string {
      return context?.renderer?.currentFocusedEditor?.plainText ?? "";
    }

    function applyActions(actions: Action[]) {
      let keepUndoSnapshotForBatch = false;
      for (const action of actions) {
        // Buffer-modifying actions (cmd, insertText) clear the undo stack,
        // unless this batch includes a saveUndoSnapshot (which sets
        // keepUndoSnapshotForBatch to preserve the stack).
        if ((action.type === "cmd" || action.type === "insertText") && !keepUndoSnapshotForBatch) {
          undoSnapshots = [];
        }
        switch (action.type) {
          case "cmd":
            // Deferred to break out of the key-dispatch stack; dispatching
            // motion commands synchronously from inside a key handler
            // silently no-ops (V1 gotcha, unchanged in V2).
            setTimeout(() => dispatch(action.cmd), 0);
            break;
          case "mode":
            if (modeIndicator === "toast") {
              const label = action.mode === "(insert)" ? action.mode : action.mode.toUpperCase();
              toast({
                message: label,
                variant: "info",
                duration: 800,
              });
            }
            break;
          case "toast":
            toast({
              message: action.message,
              variant: "info",
              duration: action.duration ?? 2000,
            });
            break;
          case "yank":
            writeClipboard(action.text);
            break;
          case "insertText":
            context?.renderer?.currentFocusedEditor?.insertText?.(action.text);
            break;
          case "yankSelection": {
            // Deferred so it runs after any preceding select commands
            setTimeout(() => {
              const editor = context?.renderer?.currentFocusedEditor;
              const text = editor?.editorView?.getSelectedText?.() ?? "";
              if (text) {
                state.yankRegister = text;
                writeClipboard(text);
                toast({
                  message: "yanked",
                  variant: "info",
                  duration: 1000,
                });
              }
              editor?.editorView?.resetSelection?.();
            }, 0);
            break;
          }
          case "clearSelection":
            context?.renderer?.currentFocusedEditor?.editorView?.resetSelection?.();
            break;
          case "deleteRange": {
            const editor = context?.renderer?.currentFocusedEditor;
            const eb = editor?.editBuffer;
            if (eb?.deleteRange) {
              const text = editor.plainText ?? "";
              const [sl, sc] = offsetToLineCol(text, action.start);
              const [el, ec] = offsetToLineCol(text, action.end + 1);
              eb.deleteRange(sl, sc, el, ec);
            }
            break;
          }
          case "saveUndoSnapshot": {
            const editor = context?.renderer?.currentFocusedEditor;
            if (editor) {
              undoSnapshots.push({
                text: editor.plainText ?? "",
                cursor: editor.cursorOffset ?? 0,
              });
            }
            keepUndoSnapshotForBatch = true;
            break;
          }
          case "undo": {
            const undoSnapshot = undoSnapshots.pop();
            if (undoSnapshot) {
              const editor = context?.renderer?.currentFocusedEditor;
              const eb = editor?.editBuffer;
              if (eb?.setText && editor) {
                eb.setText(undoSnapshot.text);
                editor.cursorOffset = undoSnapshot.cursor;
              }
            } else {
              setTimeout(() => dispatch("input.undo"), 0);
            }
            break;
          }
          case "cursorTo": {
            const editor = context?.renderer?.currentFocusedEditor;
            if (editor) editor.cursorOffset = action.offset;
            break;
          }
          case "selectRange": {
            const editor = context?.renderer?.currentFocusedEditor;
            if (editor) {
              editor.setSelectionInclusive?.(action.start, action.end);
            }
            break;
          }
        }
      }
    }

    function syncCursorStyle() {
      const editor = context?.renderer?.currentFocusedEditor;
      if (!editor) return;
      editor.cursorStyle = {
        style: state.mode === "insert" ? "line" : "block",
        blinking: true,
      };
    }

    // The Textarea resets cursorStyle during rendering, so re-apply on a
    // short interval. Setting a property is cheaper than writing DECSCUSR
    // escape sequences to stdout, and works in terminals that don't support
    // DECSCUSR (e.g. macOS Terminal.app).
    const cursorInterval = setInterval(syncCursorStyle, 100);
    disposers.push(() => clearInterval(cursorInterval));
    disposers.push(() => {
      if (leaderTimer) clearTimeout(leaderTimer);
    });

    if (options?.updateCheck !== false) {
      checkForUpdate(toast, kv);
    }

    // Shared key path for every bound key. Returns false to let the host
    // continue dispatch (lower layers / the editor), undefined to consume —
    // exactly mirroring the V1 intercept's "return vs ctx.consume()".
    function handleKey(event: V2Context): false | undefined {
      if (event?.eventType === "release") return false;

      // If vim mode is disabled, pass all keys through unmodified.
      if (state.disabled) return false;

      // Pass through when any overlay owns the keyboard: dialogs (command
      // palette, session list, etc.), question prompts, or permission prompts.
      if (overlayActive()) return false;

      const sid = currentSessionID();
      if (sid && hasActivePrompts(sid)) {
        // Consume the leader key so the host keymap doesn't match it as a
        // leader token, which would enter pending-sequence state instead of
        // typing a space.
        const matched = findMatchingLeader(event, leaderKeys);
        if (matched) {
          const ch = leaderChar(matched);
          if (ch) context?.renderer?.currentFocusedEditor?.insertText?.(ch);
          return undefined;
        }
        return false;
      }

      // Let autocomplete handle Enter/Escape before vim consumes them. V2's
      // dispatch returns void instead of { ok }, so we can't tell whether the
      // autocomplete layer was active; returning false lets that layer (which
      // sits below ours) consume the key when it is.
      if (state.mode === "insert") {
        if (event.name === "escape") dispatch("prompt.autocomplete.hide");
        if (event.name === "return" && !event.ctrl) dispatch("prompt.autocomplete.select");
      }

      const key = translateKey(event);

      // In normal/visual mode, let the leader key and its follow-up
      // pass through so OpenCode's leader bindings work.
      if (leaderKeys.length > 0 && state.mode !== "insert") {
        if (leaderPending) {
          leaderPending = false;
          if (leaderTimer) clearTimeout(leaderTimer);
          return false;
        }
        if (findMatchingLeader(event, leaderKeys)) {
          leaderPending = true;
          leaderTimer = setTimeout(() => {
            leaderPending = false;
          }, 2000);
          return false;
        }
      }

      const handlerMode = state.mode;
      const result =
        state.mode === "insert"
          ? handleInsertKey(state, key, event, prompt)
          : state.mode === "visual"
            ? handleVisualKey(state, key, event, prompt)
            : handleNormalKey(state, key, event, prompt);
      if (handlerMode === "normal") finishOneShotIfComplete(state, result);

      // In insert mode, intercept printable leaders (space, "a") so they
      // insert their character instead of triggering the leader menu
      // mid-typing. Non-printable leaders (ctrl+x, alt+m) fall through so
      // app-level shortcuts work without switching modes. Runs after
      // handleInsertKey so explicit handlers (escape, return, tab, ctrl+o)
      // take priority. Don't mutate `result` — it may be the shared PASS
      // constant.
      let consume = result.consume;
      let actions = result.actions;
      if (handlerMode === "insert" && !consume && leaderKeys.length > 0) {
        const matched = findMatchingLeader(event, leaderKeys);
        if (matched) {
          const ch = leaderChar(matched);
          if (ch) {
            actions = [{ type: "insertText" as const, text: ch }];
            consume = true;
          }
        }
      }

      if (!consume) return false;
      applyActions(actions);
      return undefined;
    }

    // ONE global layer at high priority, registered once. Every key the vim
    // engine can ever handle gets its own command whose run delegates to
    // handleKey; returning false falls through to the host, so pass-through
    // semantics survive the intercept → layer migration.
    // Gating is PER COMMAND, not layer-level: the palette lists only
    // currently-reachable commands, and a foreign input mode (e.g. "modal")
    // is pushed while the palette itself is open — layer-level `enabled`
    // would therefore hide :q/:wq/:w//vim from the palette exactly when the
    // palette is shown. Palette/slash commands have no bind and can't
    // intercept keys, so they stay enabled in every mode.
    const keyGate = () => !state.disabled && vimLayerActive();
    const paletteGate = () => !state.disabled;
    const layerConfig = () => ({
      mode: "global",
      priority: 10_000,
      commands: [
        ...vimKeyCommands(handleKey).map((cmd) => ({ ...cmd, enabled: keyGate })),
        {
          id: "vimcode.q",
          title: ":q",
          group: "Vim",
          palette: true,
          enabled: paletteGate,
          slash: { name: "q", aliases: ["quit"] },
          run: () => {
            setTimeout(() => dispatch("app.exit"), 0);
          },
        },
        {
          id: "vimcode.wq",
          title: ":wq",
          group: "Vim",
          palette: true,
          enabled: paletteGate,
          slash: { name: "wq" },
          run: () => {
            setTimeout(() => dispatch("app.exit"), 0);
          },
        },
        {
          id: "vimcode.w",
          title: ":w",
          group: "Vim",
          palette: true,
          enabled: paletteGate,
          slash: { name: "w", aliases: ["write"] },
          run: () => {
            setTimeout(() => dispatch("input.submit"), 0);
          },
        },
        {
          id: "vimcode.vim",
          title: ":vim",
          group: "Vim",
          palette: true,
          enabled: paletteGate,
          slash: { name: "vim" },
          run: () => {
            const result = toggleVimMode(state);
            kv.set("disabled", state.disabled).catch(() => {});
            applyActions(result.actions);
          },
        },
      ],
    });

    // keymap.layer() is "owned by the calling component": it resolves the
    // keymap provider via useContext, which throws outside the app's
    // component tree — including in setup(). Registering from a slot render
    // runs us inside the tree. Slot renders are reactive and may run more
    // than once, so guard with a flag and never dispose/recreate the layer.
    let layerRegistered = false;
    const unregisterSlot = context?.ui?.slot?.({
      append: "app",
      render: () => {
        if (!layerRegistered) {
          layerRegistered = true;
          // Calibrate the baseline from inside the tree, where the provider
          // is guaranteed to resolve.
          baselineMode = safeModeCurrent();
          context?.keymap?.layer?.(layerConfig);
        }
        return null;
      },
    });
    if (typeof unregisterSlot === "function") disposers.push(unregisterSlot);

    return () => {
      for (const off of disposers) {
        try {
          off();
        } catch {}
      }
    };
  },
};

// All printable ASCII plus the special keys the engine handles. One command
// per base key: shifted variants (shift+a → "A") are normalized by
// translateKey before the engine sees them. Binds are exact-match, so the two
// modifier combos the engine consumes (ctrl+return → submit, ctrl+o → one-shot
// normal) must be bound explicitly; all other ctrl combos must stay unbound so
// they fall through to host bindings.
const SPECIAL_KEYS = ["escape", "return", "tab", "backspace", "delete", "left", "right", "up", "down", "home", "end"];
const MODIFIER_BINDS = ["ctrl+return", "ctrl+o"];

function keyCommandId(key: string): string {
  // IDs are also config keybind identifiers; keep punctuation out of them.
  return `vimcode.key.${key.replace(/[^_a-zA-Z0-9]/g, "-")}`;
}

type KeyCommand = {
  id: string;
  title: string;
  group: string;
  bind: string;
  /* biome-ignore lint/suspicious/noExplicitAny: plugin-API seam, host-owned types */
  run: (input: unknown, event: any) => false | undefined;
  enabled?: () => boolean;
};

function vimKeyCommands(handleKey: (event: V2Context) => false | undefined): KeyCommand[] {
  const binds: string[] = [];
  for (let i = 33; i <= 126; i++) binds.push(String.fromCharCode(i));
  binds.push("space", ...SPECIAL_KEYS, ...MODIFIER_BINDS);
  return binds.map((bind) => ({
    id: keyCommandId(bind),
    title: `Vim: ${bind}`,
    group: "Vim",
    bind,
    run: (_input: unknown, event: V2Context) => handleKey(event),
  }));
}

// Read all configured leader keys from OpenCode's global CLI config. The V1
// api.tuiConfig.keybinds accessor has no documented V2 equivalent, so we read
// cli.json directly and degrade to "no leader pass-through" on any failure.
function resolveLeaderKeys(): KeyLike[] {
  try {
    const xdg = process.env.XDG_CONFIG_HOME;
    const file = xdg ? path.join(xdg, "opencode", "cli.json") : path.join(homedir(), ".config", "opencode", "cli.json");
    const config = JSON.parse(readFileSync(file, "utf8"));
    const raw = config?.keybinds?.leader;
    const entries: unknown[] = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
    return entries
      .map((e) => (typeof e === "object" && e !== null ? (e as { key?: unknown }).key : e))
      .filter(
        (k): k is KeyLike =>
          !!k &&
          k !== "none" &&
          k !== "false" &&
          (typeof k === "string" || (typeof k === "object" && typeof (k as Record<string, unknown>).name === "string")),
      );
  } catch {
    return [];
  }
}

function offsetToLineCol(text: string, offset: number): [number, number] {
  const before = text.substring(0, offset);
  const lines = before.split("\n");
  return [lines.length - 1, lines[lines.length - 1].length];
}

export default plugin;
