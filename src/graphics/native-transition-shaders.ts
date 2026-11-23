export const nativeTransitionFragment=`#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uTexture0;
uniform sampler2D uTexture1;
uniform sampler2D uTexture2;
uniform int uMethod;
uniform int uPhase;
uniform int uComplete;
uniform int uVague;
uniform int uBlockSize;
uniform ivec2 uBlockOrigin;
uniform ivec2 uSize;
uniform int uToScreen;
out vec4 color;
ivec4 pixel(sampler2D image,ivec2 point){return ivec4(round(texelFetch(image,point,0)*255.0));}
vec4 blend(ivec4 a,ivec4 b,int phase){return vec4(a+(((b-a)*phase)>>8))/255.0;}
vec4 transitionAt(ivec2 point){
    if(uComplete!=0)return texelFetch(uTexture1,point,0);
    if(uMethod==2){
        ivec2 block=(point-uBlockOrigin)/uBlockSize;
        point=clamp(block*uBlockSize+uBlockOrigin+ivec2(uBlockSize/2),ivec2(0),uSize-1);
    }
    ivec4 a=pixel(uTexture0,point),b=pixel(uTexture1,point);
    if(uMethod==1){
        ivec3 rgb=pixel(uTexture2,point).rgb;
        int rule=(rgb.r*54+rgb.g*183+rgb.b*19)>>8;
        int lower=uPhase-uVague;
        if(rule>=uPhase)return vec4(a)/255.0;
        if(uVague<512&&rule<lower)return vec4(b)/255.0;
        int weight=rule<lower?255:clamp(255-((rule-lower)*255/max(uVague,1)),0,255);
        return blend(a,b,weight);
    }
    return blend(a,b,uPhase);
}
void main(){
    ivec2 point=ivec2(gl_FragCoord.xy);
    // Native texture row 0 is top; the default framebuffer's row 0 is bottom.
    if(uToScreen!=0)point.y=uSize.y-1-point.y;
    vec4 p=transitionAt(point);
    // Match the existing opaque presentation quad, not the premultiplied texture output.
    color=uToScreen!=0?vec4(p.a>0.0?p.rgb/p.a:vec3(0.0),1.0):p;
}
`;
