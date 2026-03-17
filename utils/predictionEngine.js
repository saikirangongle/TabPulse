// utils/predictionEngine.js
'use strict';
const FIVE_MIN_MS=5*60*1000, TEN_MIN_MS=10*60*1000, MAX_HISTORY=60;
let usageHistory=[];
export function recordUsageSample(totalBytes) {
  usageHistory.push({ts:Date.now(),bytes:totalBytes});
  if(usageHistory.length>MAX_HISTORY)usageHistory.shift();
}
export function predictNext5Minutes(currentTotalBytes,sessionStart) {
  const elapsed=Date.now()-sessionStart;
  return elapsed<=0?0:Math.round((currentTotalBytes/elapsed)*FIVE_MIN_MS);
}
export function predictFromHistory() {
  if(usageHistory.length<5)return 0;
  const f=usageHistory[0],l=usageHistory[usageHistory.length-1],dt=l.ts-f.ts;
  return dt<=0?0:Math.round(((l.bytes-f.bytes)/dt)*FIVE_MIN_MS);
}
export function predictNext10Minutes(currentTotalBytes,sessionStart) {
  const elapsed=Date.now()-sessionStart;
  return elapsed<=0?0:Math.round((currentTotalBytes/elapsed)*TEN_MIN_MS);
}
export function clearPredictionHistory(){ usageHistory=[]; }
