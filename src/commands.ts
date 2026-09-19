// JSX's synthetic runtime import cannot resolve from cache-installed plugin
// files (the runtime's module interception rewrites explicit source imports,
// not transpiler-generated ones), so the blessed component mount is written
// with an explicit createComponent call: jsx(<Commands/>) compiles to exactly
// this. The component body runs once per mount with a persistent owner —
// keymap layers created there live as long as the slot.
import { createComponent } from "solid-js";
import type { V2Context } from "./seam";

type RegisterInput = {
  context: V2Context;
  layerConfig: () => unknown;
  safeModeCurrent: () => string | undefined;
  onRegistered: (baseline: string | undefined) => void;
  onUnregister: (off: unknown) => void;
  toast: (message: string) => void;
};

// biome-ignore lint/suspicious/noExplicitAny: host-owned component props
function VimLayer(props: any) {
  props.toast("vimcode: layer");
  props.onRegistered(props.safeModeCurrent());
  props.context.keymap.layer(props.layerConfig);
  try {
    const reachable = props.context.keymap.commands();
    const ours = reachable.filter((c: { id?: string; name?: string }) =>
      String(c?.name ?? c?.id ?? "").startsWith("vimcode"),
    ).length;
    props.toast(`vimcode: ${ours}/${reachable.length} cmds`);
  } catch (error) {
    props.toast(`vimcode: cmds err ${String(error).slice(0, 40)}`);
  }
  return null;
}

export function registerCommandsSlot(input: RegisterInput) {
  const { context, layerConfig, safeModeCurrent, onRegistered, onUnregister, toast } = input;
  if (typeof context?.ui?.slot !== "function") {
    // biome-ignore lint/suspicious/noConsole: TEMP-VERIFY loud guard
    console.error("[vimcode] host API missing: ui.slot");
    return;
  }
  const unregister = context.ui.slot({
    append: "app",
    // A component element, not a bare callback: the host mounts it, giving
    // the keymap layer a persistent owner.
    render: () =>
      createComponent(VimLayer, {
        context,
        layerConfig,
        safeModeCurrent,
        onRegistered,
        toast,
      }),
  });
  if (typeof unregister === "function") onUnregister(unregister);
}
