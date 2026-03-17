// utils/efficiencyScore.js
'use strict';
export function calculateEfficiencyScore(tabStats) {
  if (!tabStats) return 100;
  const { totalBytes=0, requestCount=0, resourceTypes={} } = tabStats;
  if (!requestCount) return 100;
  let score = 100;
  const avg = totalBytes/requestCount;
  if(avg>800000)score-=40; else if(avg>400000)score-=30; else if(avg>200000)score-=20; else if(avg>100000)score-=10;
  if(requestCount>400)score-=25; else if(requestCount>250)score-=15; else if(requestCount>150)score-=8;
  const mB=(resourceTypes.media||0)+(resourceTypes.image||0)+(resourceTypes.font||0);
  const mR=totalBytes>0?mB/totalBytes:0;
  if(mR>0.7)score-=15; else if(mR>0.5)score-=10;
  const sR=totalBytes>0?(resourceTypes.script||0)/totalBytes:0;
  if(sR>0.6)score-=10;
  return Math.round(Math.min(100,Math.max(0,score)));
}
export function getEfficiencyLabel(score) {
  if(score>=85)return'Excellent'; if(score>=70)return'Good';
  if(score>=50)return'Average';   if(score>=30)return'Poor';
  return'Very Poor';
}
