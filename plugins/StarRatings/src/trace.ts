import { Tracer } from "@luna/core";

// `trace.msg.log/warn/err` surface a toast-style message inside TIDAL,
// `trace.log/warn/err` go to the console. Shared across the whole plugin.
export const { trace, errSignal } = Tracer("[StarRatings]");
