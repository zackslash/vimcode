// JSX and direct solid-js imports cannot resolve from cache-installed plugin
// files on v2.0.8 — only host-injected specifiers work — so the slot render
// stays plain TS. The render callback itself executes inside the host slot
// tree (the host wraps it as a mounted component and pre-provides the plugin
// context), which gives keymap.layer() the component scope it needs.

import type { V2Context } from "./seam";

type RegisterInput = {
  context: V2Context;
  layerConfig: () => unknown;
  safeModeCurrent: () => string | undefined;
  onRegistered: (baseline: string | undefined) => void;
  onUnregister: (off: unknown) => void;
};

export function registerCommandsSlot(input: RegisterInput) {
  const { context, layerConfig, safeModeCurrent, onRegistered, onUnregister } = input;
  if (typeof context?.ui?.slot !== "function") {
    // biome-ignore lint/suspicious/noConsole: loud guard against silent host-API drift
    console.error("[vimcode] host API missing: ui.slot");
    return;
  }
  const unregister = context.ui.slot({
    append: "app",
    render: () => {
      if (typeof context?.keymap?.layer !== "function") {
        // biome-ignore lint/suspicious/noConsole: loud guard against silent host-API drift
        console.error("[vimcode] host API missing: keymap.layer");
        return null;
      }
      // Calibrate the mode baseline inside the tree, where the keymap
      // provider is guaranteed to resolve. useBindings registers the layer
      // in a deferred createEffect; re-running on remount is safe because
      // disposal of the previous effect cleans up the old layer.
      onRegistered(safeModeCurrent());
      context.keymap.layer(layerConfig as never);
      return null;
    },
  });
  if (typeof unregister === "function") onUnregister(unregister);
}
