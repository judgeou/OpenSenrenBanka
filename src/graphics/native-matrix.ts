/** Original row-major projective coordinates. Scalar operations intentionally preserve the native homogeneous row rules. */
export class NativeMatrix{
 readonly values:Float64Array;
 constructor(values?:ArrayLike<number>){if(values&&values.length!==16)throw new Error('Native matrix requires 16 scalars');this.values=values?Float64Array.from(values):new Float64Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);if([...this.values].some(value=>!Number.isFinite(value)))throw new Error('Non-finite native matrix');}
 copy():NativeMatrix{return new NativeMatrix(this.values);}
 multiply(other:NativeMatrix):this{const left=this.values.slice(),right=other.values.slice();for(let row=0;row<4;row++)for(let column=0;column<4;column++){let value=0;for(let inner=0;inner<4;inner++)value+=left[row*4+inner]*right[inner*4+column];this.values[row*4+column]=value;}return this;}
 translate(x:number,y:number,z=0):this{const m=this.values;for(let row=0;row<4;row++){const at=row*4;m[at+3]+=m[at]*x+m[at+1]*y+m[at+2]*z;}return this;}
 translateInteger(x:number,y:number,z=0):this{const m=this.values;for(let row=0;row<4;row++){const at=row*4;m[at+3]+=Math.trunc(m[at]*x+m[at+1]*y+m[at+2]*z);}return this;}
 scale(x:number,y:number,z=1):this{for(let row=0;row<3;row++){const at=row*4;this.values[at]*=x;this.values[at+1]*=y;this.values[at+2]*=z;}return this;}
 rotate(degrees:number):this{const angle=degrees*Math.PI*2/360,sine=Math.sin(angle),cosine=Math.cos(angle),m=this.values;for(let row=0;row<3;row++){const at=row*4,x=m[at],y=m[at+1];m[at]=x*cosine+y*sine;m[at+1]=y*cosine-x*sine;}return this;}
 slant(x:number,y:number):this{for(let row=0;row<3;row++){const at=row*4,a=this.values[at],b=this.values[at+1];this.values[at]=a+b*y;this.values[at+1]=a*x+b;}return this;}
 flipX():this{for(let row=0;row<4;row++)this.values[row*4]*=-1;return this;}flipY():this{for(let row=0;row<4;row++)this.values[row*4+1]*=-1;return this;}
 project(x=0,y=0,z=0):{readonly x:number;readonly y:number;readonly z:number;readonly w:number}{const m=this.values,w=m[12]*x+m[13]*y+m[14]*z+m[15];return{x:(m[0]*x+m[1]*y+m[2]*z+m[3])/w,y:(m[4]*x+m[5]*y+m[6]*z+m[7])/w,z:(m[8]*x+m[9]*y+m[10]*z+m[11])/w,w};}
 projectedZoom():number{const origin=this.project(),x=this.project(1),y=this.project(0,1);return Math.trunc(Math.max(Math.sqrt((x.x-origin.x)**2+(y.x-origin.x)**2),Math.sqrt((x.y-origin.y)**2+(y.y-origin.y)**2))*100)/100;}
 /** Preserve homogeneous W while converting top-left screen pixels into WebGL clip space. */
 clipSpace(width:number,height:number):Float32Array{if(!Number.isFinite(width)||width<=0||!Number.isFinite(height)||height<=0)throw new Error('Invalid native stage viewport');const m=this.values,output=new Float32Array(16);for(let column=0;column<4;column++){output[column*4]=2/width*m[column]-m[12+column];output[column*4+1]=m[12+column]-2/height*m[4+column];output[column*4+2]=0;output[column*4+3]=m[12+column];}if([...output].some(value=>!Number.isFinite(value)))throw new Error('Invalid native clip matrix');return output;}
}
