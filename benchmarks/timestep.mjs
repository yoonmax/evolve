// How do timestep and solver iterations trade joint error against cost?
import { World, Vec2, Box, Circle, Edge, RevoluteJoint } from 'planck'
const STEPS_S = 15
const bodies = [[0,1.1,.5,.15,-1],[-.35,.8,.07,.25,0,-.35,1.05],[-.35,.35,.06,.22,1,-.35,.57],[.35,.8,.07,.25,0,.35,1.05],[.35,.35,.06,.22,3,.35,.57],[-.7,1.1,.2,.06,0,-.5,1.1],[-1.05,1.1,.15,.05,5,-.9,1.1]]
function run(hz, vi, pi, torque) {
  const dt = 1/hz, world = new World({ gravity: new Vec2(0,-9.81), allowSleep:false })
  world.createBody().createFixture({ shape:new Edge(new Vec2(-100,0),new Vec2(200,0)), friction:.9 })
  const b = bodies.map(([x,y,hw,hh])=>{ const body=world.createBody({type:'dynamic',position:new Vec2(x,y)}); body.createFixture({shape:new Box(hw,hh),density:20,friction:.9,filterGroupIndex:-1}); return body })
  const js = bodies.slice(1).map(([, , , ,p,ax,ay],i)=>world.createJoint(new RevoluteJoint({enableMotor:true,maxMotorTorque:torque,enableLimit:true,lowerAngle:-1.2,upperAngle:1.2},b[p],b[i+1],new Vec2(ax,ay))))
  const errs=[]; const t0=performance.now()
  const n=hz*STEPS_S
  for(let s=0;s<n;s++){ const t=s*dt; js.forEach((j,i)=>j.setMotorSpeed(8*(.7*Math.sin(5*t+i*1.3)-j.getJointAngle()))); world.step(dt,vi,pi); let e=0; for(const j of js){const a=j.getAnchorA(),c=j.getAnchorB(); e=Math.max(e,Math.hypot(a.x-c.x,a.y-c.y))} errs.push(e)}
  const ms=performance.now()-t0; errs.sort((a,b)=>a-b)
  return {ms,p50:errs[n>>1],p99:errs[Math.floor(n*.99)],max:errs[n-1]}
}
for(let warm=0;warm<8;warm++)run(60,8,3,15)
for(const [hz,vi,pi] of [[60,8,3],[60,12,6],[120,6,2],[120,8,3],[240,4,2]]){
  const r=run(hz,vi,pi,15),r2=run(hz,vi,pi,60)
  console.log(`${hz}Hz v${vi} p${pi}`.padEnd(14),`${r.ms.toFixed(1)}ms/15s`.padEnd(14),`err p50 ${(r.p50*1000).toFixed(2)} p99 ${(r.p99*1000).toFixed(1)} max ${(r.max*1000).toFixed(1)} mm`.padEnd(38),`@60Nm p99 ${(r2.p99*1000).toFixed(1)} max ${(r2.max*1000).toFixed(1)} mm`)
}
