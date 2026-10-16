import { galleryDiagnosticBuild } from './gallery-diagnostics';
// Explicit diagnostic visits only; ordinary production visits retain no samples.
const enabled = galleryDiagnosticBuild && new URLSearchParams(location.search).get('perf') === '1';
const stages: {name: string; startMs: number; durationMs?: number}[] = [];
const longTasks: {startMs: number; durationMs: number}[] = [];
let readyMs: number | null = null;
let resourceTimingOverflow = false;
if (enabled) {
  performance.setResourceTimingBufferSize(2000);
  performance.addEventListener('resourcetimingbufferfull', () => { resourceTimingOverflow = true; });
  stages.push({name: 'gallery-module', startMs: performance.now()});
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (longTasks.length < 1000) longTasks.push({startMs: entry.startTime, durationMs: entry.duration});
    }).observe({type: 'longtask', buffered: true});
  }
}
export function galleryStage(name: string) {
  if (enabled) stages.push({name, startMs: performance.now()});
}
export function measureGalleryStage<T>(name: string, work: () => T): T {
  if (!enabled) return work();
  const startMs = performance.now();
  try { return work(); } finally { stages.push({name, startMs, durationMs: performance.now() - startMs}); }
}
export function galleryLoadSnapshot(ready: boolean) {
  if (!enabled) return null;
  if (ready && readyMs === null) readyMs = performance.now();
  type ResourceTiming = PerformanceResourceTiming & {deliveryType?:string};
  const resources = (performance.getEntriesByType('resource') as ResourceTiming[])
    .filter(r => /^https?:/.test(r.name))
    .map(r => ({url: r.name.replace(location.origin, ''), startMs: r.startTime, durationMs: r.duration, responseEndMs: r.responseEnd, transferBytes: r.transferSize, encodedBytes: r.encodedBodySize, decodedBytes: r.decodedBodySize, initiatorType:r.initiatorType, deliveryType:r.deliveryType, responseStatus:r.responseStatus, protocol:r.nextHopProtocol}));
  const nav=performance.getEntriesByType('navigation')[0] as (PerformanceNavigationTiming & {deliveryType?:string})|undefined;
  const navigation=nav?{url:nav.name,startMs:nav.startTime,responseEndMs:nav.responseEnd,transferBytes:nav.transferSize,encodedBytes:nav.encodedBodySize,decodedBytes:nav.decodedBodySize,deliveryType:nav.deliveryType,responseStatus:nav.responseStatus,type:nav.type}:null;
  const controller = navigator.serviceWorker?.controller;
  return {readyMs, readiness: 'first diagnostic frame with all expected HDR probes and 48 artwork textures; frame-start, not GPU completion', stages, longTasks, resources, navigation, visibility: document.visibilityState,
    resourceTimingOverflow, serviceWorker: {controlled: !!controller, scriptURL: controller?.scriptURL ?? null}};
}
