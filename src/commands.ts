// JSX is unusable in cache-installed plugins on v2.0.8: the runtime
// transpiler defaults to react and no runtime-module interception reaches
// these files, so the slot render must stay plain TS. The render callback
// runs inside the host's slot tree; keymap.layer() is called there and
// every step is observed via TEMP-VERIFY toasts.
import type { V2Context } from "./seam";

type RegisterInput = {
  context: V2Context;
  layerConfig: () => unknown;
  safeModeCurrent: () => string | undefined;
  onRegistered: (baseline: string | undefined) => void;
  onUnregister: (off: unknown) => void;
  toast: (message: string) => void;
};

export function registerCommandsSlot(input: RegisterInput) {
  const { context, layerConfig, safeModeCurrent, onRegistered, onUnregister, toast } = input;
  if (typeof context?.ui?.slot !== "function") {
    // biome-ignore lint/suspicious/noConsole: TEMP-VERIFY loud guard
    console.error("[vimcode] host API missing: ui.slot");
    return;
  }
  const unregister = context.ui.slot({
    append: "app",
    render: () => {
      toast("vimcode: layer");
      if (typeof context?.keymap?.layer !== "function") {
        // biome-ignore lint/suspicious/noConsole: TEMP-VERIFY loud guard
        console.error("[vimcode] host API missing: keymap.layer");
        return null;
      }
      onRegistered(safeModeCurrent());
      context.keymap.layer(layerConfig as never);
      try {
        const reachable = context.keymap.commands();
        const ours = reachable.filter((c: { id?: string }) => String(c?.id ?? "").startsWith("vimcode")).length;
        toast(`vimcode: ${ours}/${reachable.length} cmds`);
      } catch (error) {
        toast(`vimcode: cmds err ${String(error).slice(0, 40)}`);
      }
      return null;
    },
  });
  if (typeof unregister === "function") onUnregister(unregister);
}
