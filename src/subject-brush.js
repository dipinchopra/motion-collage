export const SUBJECT_TOOLS = new Set(['brush', 'bend', 'cutline']);
const TAU = Math.PI * 2;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const distance = (a, b) => Math.hypot((b.x - a.x) * 9 / 16, b.y - a.y);

export function resampleStrokes(strokes, spacing = 0.022, budget = 80) {
  const paths = strokes.filter(s => s.points.length).map(stroke => {
    const cumulative = [0];
    for (let i = 1; i < stroke.points.length; i++) cumulative.push(cumulative.at(-1) + distance(stroke.points[i - 1], stroke.points[i]));
    return { stroke, cumulative, length: cumulative.at(-1) };
  });
  if (!paths.length) return [];
  const total = paths.reduce((n, p) => n + p.length, 0);
  const wanted = Math.min(budget, Math.max(paths.length, Math.ceil(total / Math.max(0.004, spacing)) + paths.length));
  const counts = paths.map(p => Math.max(1, Math.floor(wanted * (total ? p.length / total : 1 / paths.length))));
  while (counts.reduce((a,b)=>a+b,0) > budget) { const i = counts.indexOf(Math.max(...counts)); if (counts[i] <= 1) break; counts[i]--; }
  const output = [];
  for (let p = 0; p < paths.length && output.length < budget; p++) {
    const {stroke,cumulative,length} = paths[p];
    let segment = 1;
    let previousAngle = 0;
    for (let i = 0; i < counts[p] && output.length < budget; i++) {
      const d = counts[p] === 1 ? length : i / (counts[p] - 1) * length;
      while (segment < cumulative.length - 1 && cumulative[segment] < d) segment++;
      const a = stroke.points[Math.max(0, segment - 1)];
      const b = stroke.points[Math.min(segment, stroke.points.length - 1)];
      const span = (cumulative[segment] || 0) - (cumulative[segment - 1] || 0);
      const t = span > 0 ? clamp((d - cumulative[segment - 1]) / span, 0, 1) : 0;
      let angle = Math.atan2(-(b.y - a.y), (b.x - a.x) * 9 / 16);
      while (angle - previousAngle > Math.PI) angle -= TAU;
      while (angle - previousAngle < -Math.PI) angle += TAU;
      previousAngle = angle;
      output.push({ asset:stroke.asset,layer:stroke.layer,x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,angle,rotation:stroke.rotation||0 });
    }
  }
  return output;
}

export function demoStrokes(tool, asset, layer) {
  if (!asset || !layer) return [];
  if (tool === 'cutline') return [
    {asset,layer,rotation:0,points:Array.from({length:32},(_,i)=>{const t=i/31;return{x:.16+.65*t,y:.24+.12*Math.sin(t*Math.PI)}})},
    {asset,layer,rotation:-1.3,points:Array.from({length:32},(_,i)=>{const t=i/31;return{x:.82-.65*t,y:.68+.12*Math.sin(t*Math.PI)}})},
  ];
  return [{asset,layer,points:Array.from({length:48},(_,i)=>{const t=i/47;return{x:.5+.28*Math.sin(t*TAU),y:.15+.7*t}})}];
}

export function paintPose(sample, index, count, phase, {size=1,turn=.18}={}, drawing=false) {
  const t=((phase/TAU)%1+1)%1;
  const reveal=clamp(t/.72,0,1);
  const visible=drawing || index/Math.max(1,count-1)<=reveal;
  const fade=drawing?1:(1-clamp((t-.9)/.09,0,1))*clamp(t/.025,0,1);
  return {x:(sample.x-.5)*1.98,y:(.5-sample.y)*3.52,z:index*.0005,rx:0,ry:0,rz:sample.rotation+sample.angle*turn,scale:size,opacity:visible?fade:0};
}

export function bendPose(copy,copies,phase,{bend=.65,depth=.25}={}) {
  const u=copy/Math.max(1,copies-1);
  const wave=phase-u*2.4;
  return {x:Math.sin(wave)*depth+u*.12,y:-.95+Math.cos(wave)*.09,z:copy*.001,rx:0,ry:Math.cos(wave)*depth,rz:Math.sin(wave)*bend,scale:1.15+u*.12,opacity:1};
}
