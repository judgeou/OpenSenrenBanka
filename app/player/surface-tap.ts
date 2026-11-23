const tapTravel = 12; // CSS pixels on the physical screen, independent of rotation.
const tapTime = 650;

/** Bind only touch taps on a playback surface, not taps on overlaid controls. */
export function bindSurfaceTap(root: HTMLElement, surface: (target: EventTarget | null) => Element | null, advance: () => void): () => void {
  let press: { id: number; x: number; y: number; at: number; target: Element } | undefined;
  const clear = () => { press = undefined; };
  const cancel = (event: PointerEvent) => { if (press?.id === event.pointerId) clear(); };
  root.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch') return;
    clear();
    const target = surface(event.target);
    if (event.isPrimary && event.button === 0 && target) press = { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp, target };
  });
  root.addEventListener('pointermove', event => {
    if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > tapTravel) clear();
  });
  root.addEventListener('pointerup', event => {
    const start = press;
    if (!start || event.pointerId !== start.id) return;
    clear();
    if (event.button !== 0 || event.timeStamp - start.at > tapTime || Math.hypot(event.clientX - start.x, event.clientY - start.y) > tapTravel) return;
    // Touch may implicitly capture the pointer. Check the actual release point as well.
    if (surface(event.target) === start.target && surface(root.ownerDocument.elementFromPoint(event.clientX, event.clientY)) === start.target) advance();
  });
  root.addEventListener('pointercancel', cancel);
  root.addEventListener('lostpointercapture', cancel);
  return clear;
}

/** Only a pointer pressed on the game can advance it on release. */
export function bindMouseAdvance(canvas:HTMLCanvasElement,advance:()=>void){
  let pointer:number|undefined;
  canvas.onpointerdown=e=>{pointer=e.pointerType!=='touch'&&e.button===0?e.pointerId:undefined;};
  canvas.onpointercancel=canvas.onpointerleave=()=>{pointer=undefined;};
  canvas.onpointerup=e=>{const owns=e.pointerId===pointer;pointer=undefined;if(owns&&e.button===0)advance();};
}
