import {NativeGpuPass} from '../native-gpu-pass.ts';
import type {StageTexture,StageTarget,WebGlStage} from '../webgl-stage.ts';

// Original doGrayScale operates on source pixels before scene projection.
const fragment = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uTexture0;
out vec4 color;
void main() {
  vec4 s=texelFetch(uTexture0,ivec2(gl_FragCoord.xy),0);
  if(s.a==0.0){color=vec4(0.0);return;}
  uvec3 rgb=uvec3(round(clamp(s.rgb/s.a,0.0,1.0)*255.0));
  float y=float((54u*rgb.r+183u*rgb.g+19u*rgb.b)>>8u)/255.0;
  color=vec4(vec3(y*s.a),s.a);
}`;
export class MotionGrayscale {
  private readonly pass:NativeGpuPass;
  constructor(stage:WebGlStage) { this.pass=new NativeGpuPass(stage,fragment,1,{}); }
  apply(input:StageTexture,target:StageTarget):void { this.pass.render([input],{},target); }
  close():void { this.pass.close(); }
}
