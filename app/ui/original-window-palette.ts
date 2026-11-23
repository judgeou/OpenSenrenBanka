import {ImmutablePixels} from './immutable-pixels.ts';

// Active patch Config.tjs: DefaultColors.win / .owin. Retain the original
// panel alpha and its PIMG luminance structure when changing perspective.
const normal=[0xb7,0x5e,0x74], another=[0x6d,0xa7,0x9f];

// custom.tjs:onRedrawMessageFrame executes omPsOverlay with a solid source
// before removing opacity. Keep the panel mask: no tint on the underlying stage.
export async function pcWindowPixels(source: OffscreenCanvas, perspective: boolean): Promise<ImmutablePixels> {
  const canvas = new OffscreenCanvas(source.width, source.height);
  const context = canvas.getContext('2d', {willReadFrequently:true});
  if (!context) throw Error('Missing PC message frame compositor');
  try {
    context.drawImage(source, 0, 0);
    const image = context.getImageData(0, 0, canvas.width, canvas.height), data = image.data;
    const tint = perspective ? another : normal;
    for (let i=0; i<data.length; i+=4) if (data[i+3]) {
      for (let c=0; c<3; c++) {
        const base=data[i+c], color=tint[c];
        data[i+c] = base<128 ? 2*base*color/255 : 255-2*(255-base)*(255-color)/255;
      }
    }
    context.putImageData(image, 0, 0);
    return await ImmutablePixels.copy(canvas);
  } finally { canvas.width=canvas.height=0; }
}
export async function alternateWindowPixels(source:OffscreenCanvas):Promise<ImmutablePixels>{
  const canvas=new OffscreenCanvas(source.width,source.height),ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)throw Error('Missing original perspective window compositor');
  try{
    ctx.drawImage(source,0,0);const p=ctx.getImageData(0,0,canvas.width,canvas.height),d=p.data;
    for(let i=0;i<d.length;i+=4)if(d[i+3])for(let j=0;j<3;j++)d[i+j]=Math.round(d[i+j]*another[j]/normal[j]);
    ctx.putImageData(p,0,0);return await ImmutablePixels.copy(canvas);
  }finally{canvas.width=canvas.height=0;}
}
