import type { NativeUiPlane } from '../../src/graphics/native-ui-planes.ts';
import type { ImmutablePixels } from './immutable-pixels.ts';
export interface NativeTextAtom { readonly text: string; readonly ruby?: string; readonly size: number; readonly sourceEnd: number }
export interface NativeTextProgram { readonly atoms: readonly NativeTextAtom[]; readonly sourceLength: number; readonly finalSize: number; readonly pendingBefore: number | null; readonly pendingAfter: number | null }
export interface NativeTextConversion { readonly sequence: number; readonly program: NativeTextProgram }
export interface NativeMessagePresentation { readonly body: string; readonly displayName: string; readonly wasRead: boolean; readonly flags: bigint }
export interface NativeMessageRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface NativeMessageGeometry extends NativeMessageRect { readonly imageWidth: number }
export interface MeasuredMessageCell extends NativeTextAtom { readonly advance: number; readonly rubyAdvance: number }
export interface LaidMessageCell extends MeasuredMessageCell { readonly x: number; readonly originY: number; readonly rubyX: number; readonly initialLineSize: number; readonly line: number; readonly page: number; readonly step: number; readonly revealAt: number }
export interface MessageLayoutStep { readonly page: number; readonly units: number; readonly sourceEnd: number; readonly size: number; readonly character: boolean }
export interface MessageLayout { readonly cells: readonly LaidMessageCell[]; readonly steps: readonly MessageLayoutStep[]; readonly units: number; readonly pageCount: number }
export interface NativeTextStyle { readonly color: number; readonly size: number; readonly weight?: 400 | 700; readonly align?: number; readonly valign?: number; readonly edgeColor: number; readonly edgeExtent: number; readonly edgeEmphasis: number; readonly shadowWidth?: number; readonly shadowLevel?: number; readonly shadowX?: number; readonly shadowY?: number; readonly shadowColor?: number }
export type NativeInkStyle = Pick<NativeTextStyle, 'color' | 'edgeColor' | 'edgeExtent' | 'edgeEmphasis' | 'shadowWidth' | 'shadowLevel' | 'shadowX' | 'shadowY' | 'shadowColor'>;
export interface NativeGlyphTile { readonly advance: number; readonly left: number; readonly top: number; readonly background: ImmutablePixels; readonly face: ImmutablePixels; close(): void }
export interface NativePixelLease { readonly plane: NativeUiPlane; release(): void }
export interface NativeChoiceItem { readonly index: number; readonly text: string; readonly disabled: boolean; readonly render: boolean; readonly visited: boolean }
export type NativeMusicEventKind = 'play' | 'stop' | 'pause' | 'resume';
export interface NativeMusicEvent { readonly name: string; readonly event: NativeMusicEventKind; readonly storage?: string }
