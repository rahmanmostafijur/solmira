import { z } from 'zod';

type Schema = z.core.$ZodType;

interface LooseDef {
  readonly type: string;
  readonly innerType?: Schema;
  readonly in?: Schema;
  readonly out?: Schema;
  readonly shape?: Readonly<Record<string, Schema>>;
  readonly element?: Schema;
  readonly valueType?: Schema;
}

/** Wrappers that change how a value is defaulted or nulled, not what a valid value looks like. */
const WRAPPERS = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'nonoptional',
  'readonly',
]);
const MAX_LAYERS = 16;

const defOf = (schema: Schema): LooseDef => schema._zod.def as unknown as LooseDef;

/**
 * The schema and everything it wraps, outermost first: `name.optional()` yields the optional and
 * the name schema, a pipe yields both of its sides. Metadata and bounds live on one of these.
 */
function layersOf(schema: Schema): Schema[] {
  const layers: Schema[] = [];
  const pending: Schema[] = [schema];
  while (pending.length > 0 && layers.length < MAX_LAYERS) {
    const current = pending.shift() as Schema;
    layers.push(current);
    const def = defOf(current);
    if (WRAPPERS.has(def.type) && def.innerType) pending.push(def.innerType);
    if (def.type === 'pipe')
      pending.push(...[def.out, def.in].filter((side) => side !== undefined));
  }
  return layers;
}

function childOf(schema: Schema, key: PropertyKey): Schema | undefined {
  for (const layer of layersOf(schema)) {
    const def = defOf(layer);
    if (def.shape) return def.shape[String(key)];
    if (def.element) return def.element;
    if (def.valueType) return def.valueType;
  }
  return undefined;
}

/** The schema that validates the value at `path`, when the path goes through objects, arrays and records. */
export function schemaAt(root: Schema, path: readonly PropertyKey[]): Schema | undefined {
  let current: Schema | undefined = root;
  for (const key of path) {
    if (!current) return undefined;
    current = childOf(current, key);
  }
  return current;
}

/** The first example declared with `.meta({ examples: [...] })` on the schema or what it wraps. */
export function exampleOf(schema: Schema | undefined): string | undefined {
  if (!schema) return undefined;
  for (const layer of layersOf(schema)) {
    const examples = z.globalRegistry.get(layer)?.examples;
    if (Array.isArray(examples) && examples.length > 0) {
      const [example] = examples as unknown[];
      return typeof example === 'string' ? example : JSON.stringify(example);
    }
  }
  return undefined;
}

interface CheckDef {
  readonly check?: string;
  readonly minimum?: unknown;
  readonly maximum?: unknown;
  readonly value?: unknown;
  readonly inclusive?: boolean;
}

/** The value of an inclusive size or range check, the kind `.min()` and `.max()` add. */
function boundOfCheck(check: CheckDef, bound: 'minimum' | 'maximum'): unknown {
  if (bound === 'minimum' && check.check === 'min_length') return check.minimum;
  if (bound === 'maximum' && check.check === 'max_length') return check.maximum;
  const range = bound === 'minimum' ? 'greater_than' : 'less_than';
  return check.check === range && check.inclusive ? check.value : undefined;
}

/** A declared inclusive bound (`.min()` / `.max()`) of the schema or what it wraps. */
export function boundOf(
  schema: Schema | undefined,
  bound: 'minimum' | 'maximum',
): number | undefined {
  if (!schema) return undefined;
  for (const layer of layersOf(schema)) {
    for (const check of layer._zod.def.checks ?? []) {
      const value = boundOfCheck(check._zod.def as CheckDef, bound);
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
  }
  return undefined;
}
