import type { Quote, QuoteRequest } from "../../../../../docs/contracts/domain.generated";
import domainSchema from "../../../../../docs/contracts/pos-domain.schema.json";

/**
 * Runtime evaluator for the frozen v1 JSON Schema subset used by
 * `scripts/verify_control_plane.py`. It reads `docs/contracts/pos-domain.schema.json`
 * directly; do not copy QuoteRequest/Quote field lists here.
 */
type SchemaNode = {
  readonly $ref?: string;
  readonly type?: string;
  readonly properties?: Record<string, SchemaNode>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly items?: SchemaNode;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly oneOf?: readonly SchemaNode[];
};

const ALLOWED_KEYWORDS = new Set([
  "$ref",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "enum",
  "const",
  "oneOf",
]);

const defs = (domainSchema as unknown as { readonly $defs: Record<string, SchemaNode> }).$defs;
const patternCache = new Map<string, RegExp>();

function walkKeywords(schema: SchemaNode): void {
  for (const key of Object.keys(schema)) {
    if (!ALLOWED_KEYWORDS.has(key)) {
      throw new Error(`Unsupported canonical schema keyword: ${key}`);
    }
  }
  if (schema.properties) {
    for (const child of Object.values(schema.properties)) {
      walkKeywords(child);
    }
  }
  if (schema.items) {
    walkKeywords(schema.items);
  }
  if (schema.oneOf) {
    for (const child of schema.oneOf) {
      walkKeywords(child);
    }
  }
}

for (const schema of Object.values(defs)) {
  walkKeywords(schema);
}

function matchesPattern(pattern: string, value: string): boolean {
  let compiled = patternCache.get(pattern);
  if (!compiled) {
    compiled = new RegExp(pattern);
    patternCache.set(pattern, compiled);
  }
  return compiled.test(value);
}

function validate(schema: SchemaNode, value: unknown): boolean {
  if (schema.$ref !== undefined) {
    const name = schema.$ref.split("/").at(-1);
    if (!name) {
      return false;
    }
    const resolved = defs[name];
    if (!resolved) {
      return false;
    }
    return validate(resolved, value);
  }
  if (schema.oneOf) {
    let matches = 0;
    for (const option of schema.oneOf) {
      if (validate(option, value)) {
        matches += 1;
        if (matches > 1) {
          return false;
        }
      }
    }
    return matches === 1;
  }
  if ("const" in schema) {
    return typeof value === typeof schema.const && value === schema.const;
  }
  if (schema.enum && !schema.enum.some((allowed) => allowed === value)) {
    return false;
  }
  const type = schema.type;
  if (type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const record = value as Record<string, unknown>;
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!(key in record)) {
        return false;
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (properties[key] === undefined) {
          return false;
        }
      }
    }
    for (const [key, child] of Object.entries(record)) {
      const childSchema = properties[key];
      if (childSchema === undefined || !validate(childSchema, child)) {
        return false;
      }
    }
    return true;
  }
  if (type === "array") {
    if (!Array.isArray(value) || !schema.items) {
      return false;
    }
    const minItems = schema.minItems ?? 0;
    const maxItems = schema.maxItems ?? Number.POSITIVE_INFINITY;
    if (value.length < minItems || value.length > maxItems) {
      return false;
    }
    return value.every((item) => validate(schema.items as SchemaNode, item));
  }
  if (type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return false;
    }
    const minimum = schema.minimum ?? Number.NEGATIVE_INFINITY;
    const maximum = schema.maximum ?? Number.POSITIVE_INFINITY;
    return value >= minimum && value <= maximum;
  }
  if (type === "string") {
    if (typeof value !== "string") {
      return false;
    }
    const minLength = schema.minLength ?? 0;
    const maxLength = schema.maxLength ?? Number.POSITIVE_INFINITY;
    const characterCount = Array.from(value).length;
    if (characterCount < minLength || characterCount > maxLength) {
      return false;
    }
    return schema.pattern === undefined || matchesPattern(schema.pattern, value);
  }
  if (type === "boolean") {
    return typeof value === "boolean";
  }
  if (type === "null") {
    return value === null;
  }
  return false;
}

export function validateCanonicalDef(name: string, value: unknown): boolean {
  const schema = defs[name];
  if (!schema) {
    return false;
  }
  return validate(schema, value);
}

export function isQuoteRequest(value: unknown): value is QuoteRequest {
  return validateCanonicalDef("QuoteRequest", value);
}

export function isQuote(value: unknown): value is Quote {
  return validateCanonicalDef("Quote", value);
}
