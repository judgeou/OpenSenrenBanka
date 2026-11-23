export type ScriptValue = undefined | null | boolean | number | bigint | string | ScriptValue[] | { [key: string]: ScriptValue };
export interface ScriptContext {
  read(name: string): ScriptValue; write(name: string, value: ScriptValue): void;
  call(name: string, args: readonly ScriptValue[]): ScriptValue;
  setMember?(base: object, key: string, value: ScriptValue): void;
}
export type Expression =
  | { kind: 'literal'; value: ScriptValue } | { kind: 'name'; name: string }
  | { kind: 'member'; base: Expression; key: Expression } | { kind: 'call'; target: Expression; args: Expression[] }
  | { kind: 'unary'; op: string; value: Expression } | { kind: 'binary'; op: string; left: Expression; right: Expression }
  | { kind: 'conditional'; condition: Expression; yes: Expression; no: Expression }
  | { kind: 'assign'; op: string; target: Expression; value: Expression }
  | { kind: 'array'; items: Expression[] } | { kind: 'sequence'; items: Expression[] };
