import type { TraceEvent } from '../models.js';

/**
 * Where a generation reports what it is doing (see Visualization.md). Passed per call rather than injected:
 * a request-scoped provider would make every service that depends on it request-scoped too.
 */
export interface GenerationTrace {
  emit(event: TraceEvent): void;
}

/** The default: nobody is watching. */
export const NO_TRACE: GenerationTrace = { emit: () => undefined };

/** Samples in trace events: enough names to show, few enough to keep a run small. */
export const TRACE_SAMPLE = 8;
/** Artists per bucket in `rank` and `lineup`; track picking rarely gets further down. */
export const TRACE_BUCKET_DEPTH = 40;
