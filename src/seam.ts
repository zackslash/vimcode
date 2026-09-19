// The plugin-API seam. The official types live in @opencode/plugin/tui but
// the runtime injects that module, so the plugin self-types the context
// structurally and accesses it defensively.
// biome-ignore lint/suspicious/noExplicitAny: host-owned shape, accessed defensively
export type V2Context = any;
