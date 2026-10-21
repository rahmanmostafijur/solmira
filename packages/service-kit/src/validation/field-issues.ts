import type { FieldIssue, FieldIssueRule } from '@solmira/contracts';
import type { z } from 'zod';
import { ValidationError } from '../errors/app-error.js';
import { boundOf, exampleOf, schemaAt } from './schema-at.js';

/** Where a validated value came from; it decides how a message names the field. */
export type RequestPart = 'body' | 'query' | 'param' | 'header';

export interface ValidationTarget {
  readonly part: RequestPart;
  /** The header or parameter name when the schema validates one value, e.g. `Idempotency-Key`. */
  readonly name?: string;
}

type Issue = z.core.$ZodIssue & { readonly input?: unknown };

/**
 * Returned by the per-parse error map, which zod only consults when the schema has no message of
 * its own. It marks the issues this module words; schema messages are kept as written.
 */
const UNWORDED = '\u0000unworded';
const MAX_ECHOED_LENGTH = 40;

const FORMATS: Readonly<Record<string, { readonly noun: string; readonly example?: string }>> = {
  email: { noun: 'a valid email address', example: 'ana@example.com' },
  uuid: { noun: 'a UUID', example: '0190b0a0-7c5e-7000-8000-000000000009' },
  guid: { noun: 'a UUID', example: '0190b0a0-7c5e-7000-8000-000000000009' },
  datetime: { noun: 'an ISO 8601 date-time in UTC', example: '2026-10-01T12:00:00Z' },
  date: { noun: 'a date (YYYY-MM-DD)', example: '2026-10-01' },
  url: { noun: 'a URL', example: 'https://example.com/webhooks' },
};

const EXPECTED: Readonly<Record<string, string>> = {
  string: 'a string',
  number: 'a number',
  int: 'a whole number',
  boolean: 'true or false',
  object: 'a JSON object',
  record: 'a JSON object',
  array: 'a list',
  date: 'a date',
};

const SUMMARY: Readonly<Record<Exclude<FieldIssueRule, 'invalid'>, string>> = {
  required: 'is required',
  invalid_type: 'has the wrong type',
  too_short: 'is too short',
  too_long: 'is too long',
  too_small: 'is too small',
  too_big: 'is too large',
  invalid_format: 'has an invalid format',
  invalid_enum: 'is not one of the allowed values',
  unrecognized_key: 'is not a known field',
};

/**
 * Validates one part of a request and throws a ValidationError whose details say, for each field,
 * which rule failed and what to send instead. The top-level message names the first problem.
 */
export function parseRequestPart<S extends z.ZodType>(
  schema: S,
  value: unknown,
  target: ValidationTarget,
): z.output<S> {
  // `reportInput` lets messages state what was received (a length or a number, never the value).
  const result = schema.safeParse(value, { reportInput: true, error: () => UNWORDED });
  if (result.success) return result.data;
  const issues = toFieldIssues(schema, result.error.issues, target);
  throw new ValidationError(issues, summarize(issues, target));
}

/** Turns zod issues into field issues: one per problem, worded for the person fixing the request. */
function toFieldIssues(
  schema: z.core.$ZodType,
  issues: readonly z.core.$ZodIssue[],
  target: ValidationTarget,
): FieldIssue[] {
  return issues.flatMap((issue) =>
    issue.code === 'unrecognized_keys'
      ? issue.keys.map((key) => describe(schema, { ...issue, path: [...issue.path, key] }, target))
      : [describe(schema, issue, target)],
  );
}

function describe(schema: z.core.$ZodType, issue: Issue, target: ValidationTarget): FieldIssue {
  const path = pathOf(issue.path, target);
  const label = labelOf(path, target);
  const rule = ruleOf(issue);
  const field = schemaAt(schema, issue.path);
  const bounds = boundsOf(issue, field);
  const example = exampleOf(field) ?? defaultExample(issue);
  const message =
    issue.message === UNWORDED ? wordIssue(issue, label, rule, bounds, example) : issue.message;
  return {
    path,
    message,
    rule,
    ...(example === undefined ? {} : { example }),
    ...(bounds.minimum === undefined ? {} : { minimum: bounds.minimum }),
    ...(bounds.maximum === undefined ? {} : { maximum: bounds.maximum }),
  };
}

/** "Idempotency-Key is too short", plus how many other problems the details list. */
function summarize(issues: readonly FieldIssue[], target: ValidationTarget): string {
  const [first] = issues;
  if (!first) return 'Request validation failed';
  const rule = first.rule as FieldIssueRule | undefined;
  const headline =
    rule && rule !== 'invalid'
      ? `${labelOf(first.path, target)} ${SUMMARY[rule]}`
      : first.message.replace(/\.$/, '');
  const others = issues.length - 1;
  return others === 0 ? headline : `${headline} (and ${others} more problem${plural(others)})`;
}

function pathOf(path: readonly PropertyKey[], target: ValidationTarget): string {
  const segments = path.map(String);
  return [target.name, ...segments].filter((segment) => segment !== undefined).join('.');
}

function labelOf(path: string, target: ValidationTarget): string {
  switch (target.part) {
    case 'header':
      return path || 'A header';
    case 'param':
      return path ? `Path parameter ${path}` : 'A path parameter';
    case 'query':
      return path ? `Query parameter ${path}` : 'The query string';
    case 'body':
      return path || 'The request body';
  }
}

function ruleOf(issue: Issue): FieldIssueRule {
  switch (issue.code) {
    case 'invalid_type':
      return issue.input === undefined ? 'required' : 'invalid_type';
    case 'too_small':
      return issue.origin === 'string' ? 'too_short' : 'too_small';
    case 'too_big':
      return issue.origin === 'string' ? 'too_long' : 'too_big';
    case 'invalid_format':
      return 'invalid_format';
    case 'invalid_value':
      return 'invalid_enum';
    case 'unrecognized_keys':
      return 'unrecognized_key';
    default:
      return 'invalid';
  }
}

interface Bounds {
  readonly minimum?: number;
  readonly maximum?: number;
}

/** Both limits of a size rule: the one that failed from the issue, the other from the schema. */
function boundsOf(issue: Issue, field: z.core.$ZodType | undefined): Bounds {
  if (issue.code === 'too_small' && typeof issue.minimum === 'number')
    return { minimum: issue.minimum, maximum: boundOf(field, 'maximum') };
  if (issue.code === 'too_big' && typeof issue.maximum === 'number')
    return { minimum: boundOf(field, 'minimum'), maximum: issue.maximum };
  return {};
}

function defaultExample(issue: Issue): string | undefined {
  if (issue.code === 'invalid_format') return FORMATS[issue.format]?.example;
  if (issue.code === 'invalid_value') {
    const first = issue.values[0];
    return typeof first === 'string' || typeof first === 'number' ? String(first) : undefined;
  }
  return undefined;
}

function wordIssue(
  issue: Issue,
  label: string,
  rule: FieldIssueRule,
  bounds: Bounds,
  example: string | undefined,
): string {
  const [requirement, received] = requirementOf(issue, label, rule, bounds);
  const got = received === undefined ? '' : `; got ${received}`;
  return `${requirement}${got}.${example === undefined ? '' : ` Example: ${example}`}`;
}

/** What the field must be, and a description of what was sent when that helps. */
function requirementOf(
  issue: Issue,
  label: string,
  rule: FieldIssueRule,
  bounds: Bounds,
): [string, string?] {
  switch (issue.code) {
    case 'invalid_type':
      if (rule === 'required') return [`${label} is required`];
      return [`${label} must be ${EXPECTED[issue.expected] ?? issue.expected}`, received(issue)];
    case 'too_small':
    case 'too_big':
      return sizeRequirement(issue, label, bounds);
    case 'invalid_format':
      return issue.format === 'regex'
        ? [`${label} has an invalid format; it must match ${String(issue.pattern)}`]
        : [`${label} must be ${FORMATS[issue.format]?.noun ?? `a valid ${issue.format}`}`];
    case 'invalid_value':
      return [`${label} must be ${allowedValues(issue)}`, echo(issue.input)];
    case 'unrecognized_keys':
      return [`${label} is not a known field; remove it`];
    case 'not_multiple_of':
      return [`${label} must be a multiple of ${String(issue.divisor)}`];
    default:
      return [`${label} is invalid`];
  }
}

function sizeRequirement(issue: Issue, label: string, bounds: Bounds): [string, string?] {
  const { minimum, maximum } = bounds;
  const origin = 'origin' in issue ? issue.origin : undefined;
  const input = issue.input;
  if (origin === 'string' || origin === 'array') {
    const unit = origin === 'string' ? 'character' : 'item';
    const size = typeof input === 'string' || Array.isArray(input) ? input.length : undefined;
    const got = size === undefined ? undefined : String(size);
    if (origin === 'string' && minimum === 1 && maximum === undefined)
      return [`${label} must not be empty`];
    if (minimum !== undefined && maximum !== undefined)
      return origin === 'string'
        ? [`${label} must be ${minimum} to ${maximum} characters long`, got]
        : [`${label} must have ${minimum} to ${maximum} items`, got];
    if (minimum !== undefined)
      return [`${label} must have at least ${minimum} ${unit}${plural(minimum)}`, got];
    return [`${label} can have at most ${String(maximum)} ${unit}${plural(maximum ?? 0)}`, got];
  }
  const got = typeof input === 'number' && !Number.isNaN(input) ? String(input) : undefined;
  const inclusive = 'inclusive' in issue ? issue.inclusive !== false : true;
  if (minimum !== undefined && maximum !== undefined)
    return [`${label} must be between ${minimum} and ${maximum}`, got];
  if (minimum !== undefined)
    return [`${label} must be ${inclusive ? 'at least' : 'greater than'} ${minimum}`, got];
  return [`${label} must be ${inclusive ? 'at most' : 'less than'} ${String(maximum)}`, got];
}

function allowedValues(issue: Extract<Issue, { code: 'invalid_value' }>): string {
  if ((issue as { expected?: unknown }).expected === 'stringbool') return 'true or false';
  const values = issue.values.map((value) => JSON.stringify(value));
  return values.length === 1 ? String(values[0]) : `one of ${values.join(', ')}`;
}

function received(issue: Issue): string | undefined {
  const { input } = issue;
  if (issue.code === 'invalid_type' && issue.expected === 'int' && typeof input === 'number')
    return String(input);
  if (input === null) return 'null';
  if (Array.isArray(input)) return 'a list';
  if (typeof input === 'number') return Number.isNaN(input) ? 'something else' : 'a number';
  if (typeof input === 'object') return 'a JSON object';
  return `a ${typeof input}`;
}

/** Short strings and numbers are repeated back; anything else could be large or sensitive. */
function echo(input: unknown): string | undefined {
  if (typeof input === 'number' || typeof input === 'boolean') return String(input);
  if (typeof input === 'string' && input.length <= MAX_ECHOED_LENGTH) return JSON.stringify(input);
  return undefined;
}

function plural(count: number): string {
  return count === 1 ? '' : 's';
}
