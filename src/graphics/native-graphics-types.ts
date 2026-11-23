import type {NativeProperties} from '../world/native-properties.ts';
import type {NativeGraphicFrames} from './native-graphic-frames.ts';
import type {NativeSpatialScene} from './native-spatial-scene.ts';
import type {NativeLayerPainter} from './native-layer-painter.ts';
import type {NativeTargetLease, NativeTargetPool} from './native-target-pool.ts';
import type {NativeRenderStateStore} from './native-render-state-store.ts';
import type {NativePreparedTransition, NativeTransitionDispatcher} from './native-transition-dispatcher.ts';
import type {NativeTransitionSpec} from './native-transition-state.ts';
import type {WebGlStage} from './webgl-stage.ts';
import type {NativeUiPlanes} from './native-ui-planes.ts';
import type {NativeMotionActionProfile} from './native-frame-stage.ts';
import type {MotionActionOutbox} from './motion/action-events.ts';

export interface Screen{readonly displayOnly?:boolean;readonly before:NativeTargetLease|undefined;readonly spec:NativeTransitionSpec;readonly finished:Promise<void>;readonly resolve:()=>void;plan:NativePreparedTransition|undefined}
export interface NativeGraphicsServices{readonly stage:WebGlStage;readonly frames:NativeGraphicFrames;readonly spatial:NativeSpatialScene;readonly painter:NativeLayerPainter;readonly pool:NativeTargetPool;readonly store:NativeRenderStateStore;readonly transitions:NativeTransitionDispatcher;readonly actions:NativeProperties;readonly now:()=>number;readonly width:number;readonly height:number;readonly effectScale?:()=>number;readonly ui?:NativeUiPlanes;readonly motionActionProfile?:NativeMotionActionProfile;readonly motionActions?:MotionActionOutbox}
