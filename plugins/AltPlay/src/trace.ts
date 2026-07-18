import { Tracer } from "@luna/core";

// `trace.msg.*` shows a toast inside TIDAL; `trace.*` goes to the console.
export const { trace, errSignal } = Tracer("[AltPlay]");
