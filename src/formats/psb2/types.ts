export interface PsbHeader {
  readonly version: 2 | 3;
  readonly headerSize: number;
  readonly checksum: number | undefined;
  readonly flags: 0;
  readonly names: number;
  readonly strings: number;
  readonly stringsData: number;
  readonly chunkOffsets: number;
  readonly chunkLengths: number;
  readonly chunkData: number;
  readonly root: number;
}

interface NodeBase { readonly offset: number; readonly code: number }
export interface PsbResourceRange { readonly index: number; readonly dataOffset: number; readonly length: number }
export interface PsbProperty {
  readonly keyId: number;
  readonly key: string;
  readonly valueOffset: number;
}
export type PsbNode =
  | (NodeBase & { readonly kind: 'null' })
  | (NodeBase & { readonly kind: 'boolean'; readonly value: boolean })
  | (NodeBase & { readonly kind: 'integer'; readonly storageBytes: number;
      readonly rawBits: bigint; readonly value: bigint; readonly nativeValue: bigint })
  | (NodeBase & { readonly kind: 'real'; readonly storageBytes: 0 | 4 | 8; readonly value: number })
  | (NodeBase & { readonly kind: 'string'; readonly index: number; readonly value: string })
  | (NodeBase & { readonly kind: 'resource'; readonly index: number;
      readonly dataOffset: number; readonly length: number })
  | (NodeBase & { readonly kind: 'array'; readonly items: readonly number[] })
  | (NodeBase & { readonly kind: 'object'; readonly entries: readonly PsbProperty[] });

export interface PsbLimits {
  readonly maxInputBytes: number;
  readonly maxArrayItems: number;
  readonly maxNames: number;
  readonly maxNameBytes: number;
  readonly maxStringBytes: number;
  readonly maxWalkNodes: number;
}
