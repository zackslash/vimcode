// The v2.0.8 keymap bridge resolves Solid/OpenTUI hooks against the calling
// component; calling keymap.layer() from a bare slot-render callback dies
// silently (the hook lookup throws or no-ops and the slot pipeline swallows
// it). This mirrors the blessed pattern from the v2.0.8 feature plugins
// (packages/tui/src/feature-plugins/system/plugins.tsx): the slot render
// returns a component element, and the hook work happens in the component
// body, which runs inside the tree.
/* biome-ignore lint/suspicious/noExplicitAny: plugin-API seam, host-owned types */
export type V2Context = any;

export type CommandsProps = {
  context: V2Context;
  layerConfig: () => unknown;
  safeModeCurrent: () => string | undefined;
  onRegistered: (baseline: string | undefined) => void;
};

export function Commands(props: CommandsProps) {
  // TEMP-VERIFY: screen-capture signal that the component mounted. Removed
  // in a follow-up commit after runtime verification.
  props.context?.ui?.toast?.show?.({ message: "vimcode: layer", variant: "info", duration: 1000 });

  if (!props.context?.keymap?.layer) {
    // biome-ignore lint/suspicious/noConsole: deliberate loud failure at the host seam — a silent no-op here looks like a successful load
    console.error("[vimcode] host API missing: keymap.layer");
    return null;
  }
  // The keymap provider resolves only inside the component tree, so the
  // baseline input mode is captured here — not in setup().
  const baseline = props.safeModeCurrent();
  props.context.keymap.layer(props.layerConfig);
  props.onRegistered(baseline);
  return null;
}

export function registerCommandsSlot(input: {
  context: V2Context;
  layerConfig: () => unknown;
  safeModeCurrent: () => string | undefined;
  onRegistered: (baseline: string | undefined) => void;
  onUnregister: (off: () => void) => void;
}) {
  if (!input.context?.ui?.slot) {
    // biome-ignore lint/suspicious/noConsole: deliberate loud failure at the host seam — a silent no-op here looks like a successful load
    console.error("[vimcode] host API missing: ui.slot");
    return;
  }
  const unregister = input.context.ui.slot({
    append: "app",
    // The render callback must return a component ELEMENT, not invoke the
    // work inline and return null — a bare callback has no component owner,
    // so the keymap hooks inside it resolve to nothing.
    render: () => (
      <Commands
        context={input.context}
        layerConfig={input.layerConfig}
        safeModeCurrent={input.safeModeCurrent}
        onRegistered={input.onRegistered}
      />
    ),
  });
  if (typeof unregister === "function") input.onUnregister(unregister);
}
