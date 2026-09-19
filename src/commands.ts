// JSX and direct solid-js imports cannot resolve from cache-installed
// plugin files on v2.0.8 — only host-injected specifiers work. The render
// callback's call-site scope also reports non-interactive, and
// keymap.layer() force-disables layers created there (enabled:
// interactivity ? options.enabled : false), which is why a bare-callback
// layer registers zero reachable commands. Mounting an element inherits
// interactivity from the mount position instead, so the render returns a
// PluginContextProvider element (from the host-injected @opencode/plugin/tui)
// whose children accessor runs at mount: the keymap layer is created there.
// TEMP-VERIFY toasts make each step observable.

import { PluginContextProvider } from "@opencode/plugin/tui";
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
  if (typeof PluginContextProvider !== "function") {
    // biome-ignore lint/suspicious/noConsole: TEMP-VERIFY loud guard
    console.error("[vimcode] host API missing: PluginContextProvider");
    return;
  }
  const unregister = context.ui.slot({
    append: "app",
    render: () =>
      PluginContextProvider({
        value: context,
        get children() {
          toast("vimcode: mount");
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
      }),
  });
  if (typeof unregister === "function") onUnregister(unregister);
}
