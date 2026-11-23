import {isCompositeBitmap} from './composite-bitmap.ts';
export interface StageTexture { readonly id: number; readonly width: number; readonly height: number; readonly encoding: 'premultiplied' | 'straight' }
export interface StageTarget { readonly texture: StageTexture }
export interface StageQuad { readonly texture: StageTexture; readonly matrix: Float32Array; readonly opacity: number; readonly visible: boolean; readonly order: number; readonly blend: 'normal' | 'add' | 'native-multiply'; readonly tint?: readonly [number,number,number,number]; readonly clipRectangle?: readonly[number,number,number,number]; readonly opaque?:boolean }
const vertexSource = '#version 300 es\nprecision highp float; in vec2 aPosition; uniform mat4 uMatrix; uniform vec2 uSize; uniform float uOutputFlip; out vec2 vUv; void main(){vUv=aPosition; gl_Position=uMatrix*vec4(aPosition*uSize,0.0,1.0); gl_Position.y*=uOutputFlip;}';
const fragmentSource = '#version 300 es\nprecision highp float; in vec2 vUv; uniform sampler2D uTexture; uniform vec4 uTint; uniform float uOpacity; uniform float uOpaque; out vec4 color; void main(){vec4 p=texture(uTexture,vUv); if(uOpaque>0.5)p=vec4(p.a>0.0?p.rgb/p.a:vec3(0.0),1.0); float a=uTint.a*uOpacity; color=vec4(p.rgb*uTint.rgb*a,p.a*a);}';
/** Pixel source and full clip-space matrices are explicit. No approximation of native camera or layer effects. */
export class WebGlStage {
  private readonly gl: WebGL2RenderingContext; private readonly program: WebGLProgram; private readonly vertex: WebGLShader; private readonly fragment: WebGLShader; private readonly buffer: WebGLBuffer; private readonly vao: WebGLVertexArrayObject;
  private readonly matrix: WebGLUniformLocation; private readonly size: WebGLUniformLocation; private readonly tint: WebGLUniformLocation; private readonly opacity: WebGLUniformLocation; private readonly outputFlip: WebGLUniformLocation; private readonly opaque:WebGLUniformLocation;
  private textures = new Map<number, WebGLTexture>(); private readonly owned = new WeakSet<StageTexture>(); private readonly targets = new Map<number, WebGLFramebuffer>(); private next = 1; private closed = false;
  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, preserveDrawingBuffer=false) {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer });
    if (!gl) throw new Error('WebGL2 is required for native stage rendering'); this.gl = gl as WebGL2RenderingContext;
    const shader = (type: number, source: string) => { const value = this.gl.createShader(type); if (!value) throw new Error('Unable to allocate stage shader'); this.gl.shaderSource(value, source); this.gl.compileShader(value); if (!this.gl.getShaderParameter(value, this.gl.COMPILE_STATUS)) { const error = this.gl.getShaderInfoLog(value); this.gl.deleteShader(value); throw new Error('Stage shader compilation failed: ' + error); } return value; };
    this.vertex = shader(this.gl.VERTEX_SHADER, vertexSource); this.fragment = shader(this.gl.FRAGMENT_SHADER, fragmentSource);
    const program = this.gl.createProgram(); if (!program) throw new Error('Unable to allocate stage program'); this.program = program;
    this.gl.attachShader(program, this.vertex); this.gl.attachShader(program, this.fragment); this.gl.linkProgram(program); if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) throw new Error('Unable to link stage program: ' + this.gl.getProgramInfoLog(program));
    const uniform = (name: string) => { const value = this.gl.getUniformLocation(program, name); if (!value) throw new Error('Missing stage uniform: ' + name); return value; };
    this.matrix = uniform('uMatrix'); this.size = uniform('uSize'); this.tint = uniform('uTint'); this.opacity = uniform('uOpacity'); this.outputFlip = uniform('uOutputFlip'); this.opaque = uniform('uOpaque');
    const buffer = this.gl.createBuffer(), vao = this.gl.createVertexArray(); if (!buffer || !vao) throw new Error('Unable to allocate stage geometry'); this.buffer = buffer; this.vao = vao;
    this.gl.bindVertexArray(vao); this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer); this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([0,0,1,0,0,1,0,1,1,0,1,1]), this.gl.STATIC_DRAW);
    const position = this.gl.getAttribLocation(program, 'aPosition'); this.gl.enableVertexAttribArray(position); this.gl.vertexAttribPointer(position, 2, this.gl.FLOAT, false, 0, 0); this.gl.bindVertexArray(null);
  }
  private active(): void { if (this.closed || this.gl.isContextLost()) throw new Error('Stage GPU context is unavailable'); }
  upload(source: TexImageSource, width: number, height: number, linear = true, encoding: 'premultiplied' | 'straight' = 'premultiplied'): StageTexture {
    this.active(); if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) || height > this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)) throw new Error('Invalid stage texture dimensions');
    const texture = this.gl.createTexture(); if (!texture) throw new Error('Unable to allocate stage texture'); const id = this.next++;
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture); this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, encoding === 'premultiplied'); this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, false); this.gl.pixelStorei(this.gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, this.gl.NONE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, linear ? this.gl.LINEAR : this.gl.NEAREST); this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, linear ? this.gl.LINEAR : this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE); this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    let upload = source, scratch:OffscreenCanvas|undefined;
    try {
      // Canvas and ImageData honor unpack flags. ImageBitmap already carries its
      // alpha representation: raw images are straight, 2D composition snapshots premultiplied.
      if(source instanceof ImageBitmap && isCompositeBitmap(source)!==(encoding==='premultiplied')){
        scratch=new OffscreenCanvas(width,height);const context=scratch.getContext('2d');
        if(!context)throw Error('Unable to prepare premultiplied stage pixels');
        context.drawImage(source,0,0,width,height);
        upload=scratch;
      }
      this.gl.texImage2D(this.gl.TEXTURE_2D,0,this.gl.RGBA,this.gl.RGBA,this.gl.UNSIGNED_BYTE,upload);
      if(this.gl.isContextLost())throw new Error('Stage GPU context lost during '+width+'×'+height+' upload');
    }catch(error){this.gl.deleteTexture(texture);throw error;}
    finally{if(scratch)scratch.width=scratch.height=0;}
    this.textures.set(id,texture);const result=Object.freeze({id,width,height,encoding});this.owned.add(result);return result;
  }
  context(): WebGL2RenderingContext { this.active(); return this.gl; }
  texture(texture: StageTexture): WebGLTexture { this.active(); const value = this.textures.get(texture.id); if (!this.owned.has(texture) || !value) throw new Error('Stage texture is not owned/resident'); return value; }
  target(width: number, height: number): StageTarget { this.active(); const gl = this.gl; if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > gl.getParameter(gl.MAX_TEXTURE_SIZE) || height > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error('Invalid stage target dimensions'); const texture = gl.createTexture(), framebuffer = gl.createFramebuffer(); if (!texture || !framebuffer) { if (texture) gl.deleteTexture(texture); if (framebuffer) gl.deleteFramebuffer(framebuffer); throw new Error('Unable to allocate stage target'); } gl.bindTexture(gl.TEXTURE_2D, texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height); gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0); const status=gl.checkFramebufferStatus(gl.FRAMEBUFFER); if (status !== gl.FRAMEBUFFER_COMPLETE) { const error=gl.getError(), lost=gl.isContextLost(); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(framebuffer); gl.deleteTexture(texture); throw new Error('Native stage target is incomplete: '+width+'x'+height+' status=0x'+status.toString(16)+' gl=0x'+error.toString(16)+' lost='+lost+' live='+this.targets.size); } gl.bindFramebuffer(gl.FRAMEBUFFER, null); const id = this.next++, descriptor: StageTexture = Object.freeze({ id, width, height, encoding: 'premultiplied' }); this.textures.set(id, texture); this.targets.set(id, framebuffer); this.owned.add(descriptor); return Object.freeze({ texture: descriptor }); }
  bind(target?: StageTarget): void { this.active(); if (!target) { this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null); return; } this.texture(target.texture); const framebuffer = this.targets.get(target.texture.id); if (!framebuffer) throw new Error('Invalid stage render target'); this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer); }
  shrinkTarget(source:StageTarget,dest:StageTarget):void {
    this.active(); this.texture(source.texture);this.texture(dest.texture);
    const gl=this.gl,from=this.targets.get(source.texture.id),to=this.targets.get(dest.texture.id);
    if(!from||!to||from===to)throw Error('Invalid thumbnail GPU targets');
    gl.disable(gl.SCISSOR_TEST);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,from);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,to);
    gl.blitFramebuffer(0,0,source.texture.width,source.texture.height,0,0,dest.texture.width,dest.texture.height,gl.COLOR_BUFFER_BIT,gl.LINEAR);
    if(gl.getError()!==gl.NO_ERROR)throw Error('GPU thumbnail resize failed');
  }
  readTarget(target:StageTarget):Uint8Array { this.bind(target); const gl=this.gl,width=target.texture.width,height=target.texture.height,bytes=new Uint8Array(width*height*4); gl.pixelStorei(gl.PACK_ALIGNMENT,4); gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,bytes); if(gl.getError()!==gl.NO_ERROR)throw new Error('Unable to capture native render state'); return bytes; }
  writeTarget(target:StageTarget,bytes:Uint8Array):void { this.bind(target); const texture=this.texture(target.texture),gl=this.gl,width=target.texture.width,height=target.texture.height; if(bytes.byteLength!==width*height*4)throw new Error('Saved native render state size mismatch'); gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,bytes); }
  updateRaw(texture: StageTexture, source: ImageData): void { const value = this.texture(texture); if (texture.encoding !== 'straight' || texture.width !== source.width || texture.height !== source.height) throw new Error('Raw stage update dimensions/encoding mismatch'); const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, value); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source); }
  release(texture: StageTexture): void { if (!this.owned.has(texture)) throw new Error('Foreign stage texture'); const framebuffer = this.targets.get(texture.id); if (framebuffer) { this.gl.deleteFramebuffer(framebuffer); this.targets.delete(texture.id); } const value = this.textures.get(texture.id); if (value) { this.gl.deleteTexture(value); this.textures.delete(texture.id); } }
  render(quads: readonly StageQuad[], width: number, height: number, background: readonly [number,number,number,number] | null = [0,0,0,1], target?: StageTarget): void {
    this.active(); if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new Error('Invalid stage viewport');
    const gl = this.gl; if (target && (target.texture.width !== width || target.texture.height !== height)) throw new Error('Stage target size mismatch'); this.bind(target); if (!target && gl.canvas.width !== width) gl.canvas.width = width; if (!target && gl.canvas.height !== height) gl.canvas.height = height; gl.viewport(0,0,width,height); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.STENCIL_TEST); gl.colorMask(true,true,true,true); gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); if(background){gl.clearColor(...background); gl.clear(gl.COLOR_BUFFER_BIT);} gl.useProgram(this.program); gl.bindVertexArray(this.vao); gl.activeTexture(gl.TEXTURE0); gl.uniform1f(this.outputFlip, target ? -1 : 1);
    for (const quad of [...quads].sort((a,b) => a.order-b.order)) {
      if (!quad.visible || quad.opacity <= 0) continue; if (quad.matrix.length !== 16 || [...quad.matrix].some(value => !Number.isFinite(value)) || !Number.isFinite(quad.opacity)) throw new Error('Invalid native stage pose');
      if (quad.clipRectangle) { const [x,y,w,h]=quad.clipRectangle; if (![x,y,w,h].every(Number.isFinite)||w<0||h<0) throw new Error('Invalid native rectangle'); const left=Math.max(0,Math.trunc(x)),top=Math.max(0,Math.trunc(y)),right=Math.min(width,Math.trunc(x+w)),bottom=Math.min(height,Math.trunc(y+h)); if(right<=left||bottom<=top)continue; gl.enable(gl.SCISSOR_TEST); gl.scissor(left,target?top:height-bottom,right-left,bottom-top); } else gl.disable(gl.SCISSOR_TEST);
      const texture = this.texture(quad.texture); if (quad.texture.encoding !== 'premultiplied') throw new Error('Raw mask texture cannot be painted as a color layer'); if (target?.texture.id === quad.texture.id) throw new Error('Stage texture feedback is forbidden');
      if (quad.blend === 'normal') gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      else if (quad.blend === 'add') gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      else if (quad.blend === 'native-multiply') gl.blendFuncSeparate(gl.DST_COLOR,gl.ONE_MINUS_SRC_ALPHA,gl.ZERO,gl.ONE);
      else throw new Error('Unimplemented native stage blend mode');
      gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniformMatrix4fv(this.matrix, false, quad.matrix); gl.uniform2f(this.size, quad.texture.width, quad.texture.height); const tint = quad.tint ?? [1,1,1,1] as const; gl.uniform4f(this.tint, ...tint); gl.uniform1f(this.opacity, Math.min(1, quad.opacity)); gl.uniform1f(this.opaque,quad.opaque?1:0); gl.drawArrays(gl.TRIANGLES,0,6);
    }
    gl.bindVertexArray(null); gl.disable(gl.SCISSOR_TEST);
  }
  close(): void { if (this.closed) return; this.closed = true; for (const framebuffer of this.targets.values()) this.gl.deleteFramebuffer(framebuffer); this.targets.clear(); for (const texture of this.textures.values()) this.gl.deleteTexture(texture); this.textures.clear(); this.gl.deleteBuffer(this.buffer); this.gl.deleteVertexArray(this.vao); this.gl.deleteProgram(this.program); this.gl.deleteShader(this.vertex); this.gl.deleteShader(this.fragment); }
}
