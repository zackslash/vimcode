// JSX and direct solid-js imports cannot resolve from cache-installed
// plugin files on v2.0.8 (only host-injected specifiers work), so the slot
// render stays plain TS. The render callback itself executes inside the
// host slot tree where host APIs resolve; the layer is registered there.
// TEMP-VERIFY toasts make each step of the chain observable.

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
      const baseline = safeModeCurrent();
      onRegistered(baseline);
      context.keymap.layer(layerConfig as never);
      try {
        const reachable = context.keymap.commands();
        const ours = reachable.filter((c: { id?: string; name?: string }) =>
          String(c?.name ?? c?.id ?? "").startsWith("vimcode"),
        ).length;
        let active = "E";
        try {
          active = context.keymap.mode.current() === baseline ? "Y" : "N";
        } catch {}
        toast(`vimcode: ${ours}/${reachable.length} cmds base=${baseline} act=${active}`);
      } catch (error) {
        toast(`vimcode: cmds err ${String(error).slice(0, 40)}`);
      }
      return null;
    },
  });
  if (typeof unregister === "function") onUnregister(unregister);
}
