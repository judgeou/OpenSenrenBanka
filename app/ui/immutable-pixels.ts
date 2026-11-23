import type { NativeUiPlane } from '../../src/graphics/native-ui-planes.ts';
import type { NativePixelLease } from './message-types.ts';
let revision = 0;
export class ImmutablePixels {
    private source: ImageBitmap | ImageData | undefined;
    readonly width: number;
    readonly height: number;
    revision = ++revision;
    references = 1;
    retired = false;
    constructor(source: ImageBitmap | ImageData){
        this.source = source;
        this.width=source.width;this.height=source.height;
        if (!Number.isSafeInteger(this.revision)) {
            if(source instanceof ImageBitmap)source.close();
            throw new Error('Native UI pixel revision exhausted');
        }
    }
    static async copy(source: ImageBitmapSource): Promise<ImmutablePixels> {
        const bitmap = await createImageBitmap(source);
        if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width * bitmap.height * 4 > 33554432) {
            bitmap.close();
            throw new Error('Native UI pixel surface exceeds budget');
        }
        return new ImmutablePixels(bitmap);
    }
    pin() {
        if (this.retired || !this.source) throw new Error('Native UI pixel owner is retired');
        this.references++;
        let released = false;
        return {
            source: this.source,
            release: ()=>{
                if (!released) {
                    released = true;
                    this.drop();
                }
            }
        };
    }
    drop() {
        if (--this.references === 0){if(this.source instanceof ImageBitmap)this.source.close();this.source=undefined;}
    }
    close() {
        if (!this.retired) {
            this.retired = true;
            this.drop();
        }
    }
}
export function pixelPlane(pixels: ImmutablePixels | undefined, pose: Omit<NativeUiPlane, 'source' | 'revision' | 'pixelWidth' | 'pixelHeight'>): NativePixelLease {
    const lease = pixels?.pin();
    const plane: NativeUiPlane = Object.freeze({
        ...pose,
        order: Object.freeze({
            ...pose.order
        }),
        clipRectangle: pose.clipRectangle && Object.freeze([
            pose.clipRectangle[0], pose.clipRectangle[1], pose.clipRectangle[2], pose.clipRectangle[3]
        ] as const),
        source: lease?.source,
        revision: pixels?.revision ?? 0,
        pixelWidth: pixels?.width ?? 1,
        pixelHeight: pixels?.height ?? 1
    });
    if (plane.visible && !pixels) {
        lease?.release();
        throw new Error('Visible original UI plane has no immutable pixels: ' + pose.id);
    }
    return {
        plane,
        release: ()=>lease?.release()
    };
}
