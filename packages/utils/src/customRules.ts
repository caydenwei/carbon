// Custom Rules evaluator. AST → JIT-compiled closure with LRU cache.
// Used server-side on transactions (receipt, shipment, stock transfer,
// inventory adjustment, place, pick, operation start/finish, material
// issue/receive) to enforce per-entity validation/guideline rules.
//
// Each rule binds to a single `TargetType` (`item`, `storageUnit`, or
// `workCenter`). The field registry is partitioned by `targetType` so the
// builder UI only surfaces fields valid for the chosen target.

export type Operator =
  | "eq"
  | "neq"
  | "in"
  | "notIn"
  | "isSet"
  | "isNotSet"
  | "gt"
  | "lt";

export type Severity = "error" | "warn";

/**
 * Which entity a rule applies to. Drives the field registry slice the
 * builder shows the author, and the assignment table the loader joins.
 * Mirrors the Postgres ENUM `customRuleTargetType`.
 */
export const TARGET_TYPES = ["item", "storageUnit", "workCenter"] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

/**
 * Transaction surfaces a rule may opt into. Mirrors the Postgres ENUM
 * `transactionSurface`. After `bun run db:types` regenerates the database
 * types, tighten this to:
 *
 *   import type { Database } from "@carbon/database";
 *   ...as const satisfies readonly Database["public"]["Enums"]["transactionSurface"][];
 *
 * The runtime array stays the source of truth for the validator's `z.enum`.
 */
export const TRANSACTION_SURFACES = [
  "receipt",
  "shipment",
  "stockTransfer",
  "warehouseTransfer",
  "inventoryAdjustment",
  "place",
  "pick",
  "operationStart",
  "operationFinish",
  "materialIssue",
  "materialReceive"
] as const;
export type TransactionSurface = (typeof TRANSACTION_SURFACES)[number];

/**
 * Which surfaces are valid for each target type. The form validator narrows
 * a rule's `surfaces` array against this map; the evaluator skips surfaces
 * a rule didn't subscribe to.
 *
 * Transfer surfaces (`stockTransfer`, `warehouseTransfer`) apply to both
 * `item` and `storageUnit` targets — the integration call sites pass each
 * targetType separately, the engine filters by surface intersection.
 */
export const SURFACES_BY_TARGET_TYPE: Record<
  TargetType,
  readonly TransactionSurface[]
> = {
  item: [
    "receipt",
    "shipment",
    "stockTransfer",
    "warehouseTransfer",
    "inventoryAdjustment"
  ],
  storageUnit: ["place", "pick", "stockTransfer", "warehouseTransfer"],
  workCenter: [
    "operationStart",
    "operationFinish",
    "materialIssue",
    "materialReceive"
  ]
};

export type Condition = {
  field: string;
  op: Operator;
  value?: unknown;
};

export type MatchKind = "all" | "any" | "none";

export type ConditionAst = {
  /**
   * - `all`  — every condition must be true (AND)
   * - `any`  — at least one condition must be true (OR)
   * - `none` — no condition may be true (NOR / negate)
   */
  kind: MatchKind;
  conditions: Condition[];
};

export type Violation = {
  ruleId: string;
  severity: Severity;
  message: string;
};

export type RuleContext = {
  item?: Record<string, unknown> & { customFields?: Record<string, unknown> };
  shelf?: Record<string, unknown>;
  storageUnit?: Record<string, unknown>;
  workCenter?: Record<string, unknown>;
  operation?: Record<string, unknown>;
  transaction?: Record<string, unknown>;
};

export type CustomRuleRow = {
  id: string;
  targetType: TargetType;
  severity: Severity;
  message: string;
  conditionAst: ConditionAst;
  /**
   * Surfaces this rule applies to. Empty arrays are not allowed at the DB
   * level (CHECK constraint); treat missing/empty client-side as "all
   * surfaces for this targetType" for forward-compat with rules created
   * before the migration.
   */
  surfaces?: TransactionSurface[];
  updatedAt?: string | null;
  active?: boolean;
};

export type CompiledRule = {
  id: string;
  targetType: TargetType;
  severity: Severity;
  rawMessage: string;
  surfaces: TransactionSurface[];
  conditions: Condition[];
  requiredFieldChecks: {
    field: string;
    resolve: (ctx: RuleContext) => unknown;
  }[];
  predicate: (ctx: RuleContext) => boolean;
};

// ---------------------------------------------------------------------------
// Field path resolver
// ---------------------------------------------------------------------------

type Resolver = (ctx: RuleContext) => unknown;

const ROOT_KEYS = new Set([
  "item",
  "shelf",
  "storageUnit",
  "workCenter",
  "operation",
  "transaction"
]);

const buildResolver = (path: string): Resolver => {
  const segments = path.split(".");
  if (segments.length < 2 || !ROOT_KEYS.has(segments[0]!)) {
    return () => undefined;
  }
  return (ctx: RuleContext) => {
    let cur: unknown = (ctx as Record<string, unknown>)[segments[0]!];
    for (let i = 1; i < segments.length; i++) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[segments[i]!];
    }
    return cur;
  };
};

// ---------------------------------------------------------------------------
// Operator implementations (pure)
// ---------------------------------------------------------------------------

const isNullish = (v: unknown): boolean => v === null || v === undefined;

const eqAnyArrayLeft = (l: unknown[], r: unknown): boolean => {
  for (let i = 0; i < l.length; i++) if (l[i] === r) return true;
  return false;
};
const inAnyArrayLeft = (l: unknown[], r: unknown[]): boolean => {
  for (let i = 0; i < l.length; i++) if (r.includes(l[i])) return true;
  return false;
};

const operatorFns: Record<
  Operator,
  (left: unknown, right: unknown) => boolean
> = {
  eq: (l, r) => (Array.isArray(l) ? eqAnyArrayLeft(l, r) : l === r),
  neq: (l, r) => (Array.isArray(l) ? !eqAnyArrayLeft(l, r) : l !== r),
  in: (l, r) =>
    Array.isArray(r) &&
    (Array.isArray(l) ? inAnyArrayLeft(l, r) : r.includes(l)),
  notIn: (l, r) =>
    Array.isArray(r) &&
    (Array.isArray(l) ? !inAnyArrayLeft(l, r) : !r.includes(l)),
  isSet: (l) => (Array.isArray(l) ? l.length > 0 : !isNullish(l) && l !== ""),
  isNotSet: (l) =>
    Array.isArray(l) ? l.length === 0 : isNullish(l) || l === "",
  gt: (l, r) => typeof l === "number" && typeof r === "number" && l > r,
  lt: (l, r) => typeof l === "number" && typeof r === "number" && l < r
};

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

const compileCondition = (cond: Condition): ((ctx: RuleContext) => boolean) => {
  const resolve = buildResolver(cond.field);
  const op = operatorFns[cond.op];
  if (!op) return () => false;
  const value = cond.value;
  return (ctx) => op(resolve(ctx), value);
};

const compilePredicate = (
  ast: ConditionAst
): ((ctx: RuleContext) => boolean) => {
  if (!ast || !Array.isArray(ast.conditions)) return () => false;
  const kind = ast.kind;
  if (kind !== "all" && kind !== "any" && kind !== "none") return () => false;
  if (ast.conditions.length === 0) {
    return kind === "all" || kind === "none" ? () => true : () => false;
  }
  const fns = ast.conditions.map(compileCondition);
  if (kind === "all") {
    return (ctx) => {
      for (let i = 0; i < fns.length; i++) {
        if (!fns[i]!(ctx)) return false;
      }
      return true;
    };
  }
  if (kind === "any") {
    return (ctx) => {
      for (let i = 0; i < fns.length; i++) {
        if (fns[i]!(ctx)) return true;
      }
      return false;
    };
  }
  return (ctx) => {
    for (let i = 0; i < fns.length; i++) {
      if (fns[i]!(ctx)) return false;
    }
    return true;
  };
};

const defaultSurfacesFor = (
  targetType: TargetType
): readonly TransactionSurface[] => SURFACES_BY_TARGET_TYPE[targetType];

export const compileRule = (row: CustomRuleRow): CompiledRule => ({
  id: row.id,
  targetType: row.targetType,
  severity: row.severity,
  rawMessage: row.message,
  surfaces:
    row.surfaces && row.surfaces.length > 0
      ? row.surfaces
      : [...defaultSurfacesFor(row.targetType)],
  conditions:
    row.conditionAst && Array.isArray(row.conditionAst.conditions)
      ? row.conditionAst.conditions
      : [],
  requiredFieldChecks: (row.conditionAst &&
  Array.isArray(row.conditionAst.conditions)
    ? row.conditionAst.conditions
    : []
  )
    .filter((c) => c.op !== "isSet" && c.op !== "isNotSet")
    .map((c) => ({ field: c.field, resolve: buildResolver(c.field) })),
  predicate: compilePredicate(row.conditionAst)
});

// ---------------------------------------------------------------------------
// LRU cache (process-scoped, FIFO eviction at cap)
// ---------------------------------------------------------------------------

const CACHE_CAP = 256;
const cache = new Map<string, CompiledRule>();

const fnv1a = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36);
};

const cacheKey = (row: CustomRuleRow): string => {
  // Hash bits that drive compilation output, including targetType so two
  // rules with identical AST but different targets cannot collide.
  const contentHash = fnv1a(
    `${row.targetType}|${row.message}|${JSON.stringify(row.conditionAst)}|${(row.surfaces ?? []).join(",")}`
  );
  return `${row.id}:${row.updatedAt ?? ""}:${contentHash}`;
};

export const compileWithCache = (row: CustomRuleRow): CompiledRule => {
  const key = cacheKey(row);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const compiled = compileRule(row);
  cache.set(key, compiled);
  if (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return compiled;
};

export const __resetCustomRulesCache = (): void => {
  cache.clear();
};

export const __customRulesCacheSize = (): number => cache.size;

// ---------------------------------------------------------------------------
// Message interpolation
// ---------------------------------------------------------------------------

const TOKEN_RE =
  /\{(condition\[\d+\]\.(?:field|operator|value)|[a-zA-Z_][\w.]*)\}/g;

const CONDITION_TOKEN_RE = /^condition\[(\d+)\]\.(field|operator|value)$/;

const OPERATOR_LABELS: Record<Operator, string> = {
  eq: "equals",
  neq: "not equals",
  in: "is one of",
  notIn: "is none of",
  isSet: "is set",
  isNotSet: "is not set",
  gt: "greater than",
  lt: "less than"
};

export type InterpolateMessageOptions = {
  conditions?: Condition[];
  resolveConditionValue?: (
    cond: Condition,
    index: number
  ) => string | undefined;
};

const formatConditionValue = (value: unknown): string => {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return value.map((v) => String(v)).join(", ");
  }
  return String(value);
};

export const interpolateMessage = (
  template: string,
  ctx: RuleContext,
  options: InterpolateMessageOptions = {}
): string => {
  const { conditions, resolveConditionValue } = options;
  return template.replace(TOKEN_RE, (_match, raw: string) => {
    const condMatch = CONDITION_TOKEN_RE.exec(raw);
    if (condMatch) {
      const idx = Number(condMatch[1]);
      const prop = condMatch[2] as "field" | "operator" | "value";
      const cond = conditions?.[idx];
      if (!cond) return "—";
      switch (prop) {
        case "field":
          return getFieldDef(cond.field)?.label ?? cond.field;
        case "operator":
          return OPERATOR_LABELS[cond.op] ?? cond.op;
        case "value":
          if (cond.op === "isSet" || cond.op === "isNotSet") return "—";
          if (resolveConditionValue) {
            const resolved = resolveConditionValue(cond, idx);
            if (resolved !== undefined) return resolved;
          }
          return formatConditionValue(cond.value);
      }
    }

    const value = buildResolver(raw)(ctx);
    if (value == null || value === "") return "—";
    return String(value);
  });
};

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

export type EvaluateRulesOptions = {
  resolveConditionValue?: (
    cond: Condition,
    index: number
  ) => string | undefined;
};

const findFirstMissingRequiredField = (
  rule: CompiledRule,
  ctx: RuleContext
): string | null => {
  const checks = rule.requiredFieldChecks;
  for (let i = 0; i < checks.length; i++) {
    const c = checks[i]!;
    const value = c.resolve(ctx);
    if (
      value === null ||
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0)
    ) {
      return c.field;
    }
  }
  return null;
};

const buildRequiredFieldMessage = (
  _rule: CompiledRule,
  fieldPath: string
): string => {
  const label = getFieldDef(fieldPath)?.label ?? fieldPath;
  return `${label} is required`;
};

export const evaluateRules = (
  rules: CompiledRule[],
  ctx: RuleContext,
  surface: TransactionSurface,
  opts?: EvaluateRulesOptions
): Violation[] => {
  const out: Violation[] = [];
  const resolveConditionValue = opts?.resolveConditionValue;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!;
    if (!rule.surfaces.includes(surface)) continue;

    const missing = findFirstMissingRequiredField(rule, ctx);
    if (missing !== null) {
      out.push({
        ruleId: rule.id,
        severity: rule.severity,
        message: buildRequiredFieldMessage(rule, missing)
      });
      continue;
    }

    if (rule.predicate(ctx)) continue;
    out.push({
      ruleId: rule.id,
      severity: rule.severity,
      message: interpolateMessage(rule.rawMessage, ctx, {
        conditions: rule.conditions,
        resolveConditionValue
      })
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Field resolver registry — single source of truth for builder UI + evaluator
// ---------------------------------------------------------------------------

import type { Database } from "@carbon/database";

type Tables = Database["public"]["Tables"];

type IsNullable<T> = null extends T ? true : false;

type ExpectedNullable<
  T extends keyof Tables,
  C extends keyof Tables[T]["Row"]
> = IsNullable<Tables[T]["Row"][C]>;

export type FieldType =
  | "string"
  | "number"
  | "enum"
  | "id"
  /**
   * Special-cased id picker: the rule builder renders a hierarchical
   * (location → drill-down) storage-unit selector instead of a flat combobox.
   * Values stored as the chosen storage unit's UUID.
   */
  | "storageUnit";

export type ValueOptionsLoader =
  | "locations"
  | "storageTypes"
  | "itemTypes"
  | "replenishmentSystems"
  | "itemTrackingTypes"
  | "itemPostingGroups";

export type FieldContext =
  | "item"
  | "storage"
  | "workCenter"
  | "operation"
  | "transaction";

export type FieldDef = {
  path: string;
  label: string;
  type: FieldType;
  operators: Operator[];
  context: FieldContext;
  /**
   * Which rule `targetType`(s) may reference this field.
   * - `"shared"`            → visible to every targetType (e.g. `transaction.*`)
   * - `TargetType`          → visible only to that one targetType
   * - `readonly TargetType[]` → visible to each targetType in the list (e.g.
   *   `["item", "storageUnit"]` for storage-unit fields that make sense on
   *   both item-target and storageUnit-target rules)
   */
  targetType: TargetType | "shared" | readonly TargetType[];
  valueOptionsLoader?: ValueOptionsLoader;
  /**
   * `true` (default) — column is nullable; `isSet`/`isNotSet` are valid.
   * `false`           — column is NOT NULL at the DB level; presence ops are
   *                     stripped from the available operator list.
   */
  nullable?: boolean;
  /**
   * Human-readable note on where this field's value originates. Surfaced in
   * the rule-builder UI under the field selector so authors understand what
   * they're testing against. Synthetic fields receive their `derivedFrom`
   * string here automatically.
   */
  description?: string;
};

const PRESENCE_OPS = new Set<Operator>(["isSet", "isNotSet"]);

const SCALAR_OPS: Operator[] = ["eq", "neq", "isSet", "isNotSet"];
const ENUM_OPS: Operator[] = ["eq", "neq", "in", "notIn", "isSet", "isNotSet"];
const ID_OPS: Operator[] = ["eq", "neq", "in", "notIn", "isSet", "isNotSet"];
const NUMBER_OPS: Operator[] = ["eq", "neq", "gt", "lt", "isSet", "isNotSet"];
const BOOL_OPS: Operator[] = ["eq", "neq"];

export const availableOperators = (def: FieldDef): Operator[] =>
  def.nullable === false
    ? def.operators.filter((op) => !PRESENCE_OPS.has(op))
    : def.operators;

export const isOperatorAllowed = (def: FieldDef, op: Operator): boolean =>
  availableOperators(def).includes(op);

const fields = {
  database: <
    T extends keyof Tables,
    C extends Extract<keyof Tables[T]["Row"], string>,
    N extends ExpectedNullable<T, C>
  >(args: {
    table: T;
    column: C;
    nullable: N;
    label: string;
    type: FieldType;
    operators: Operator[];
    context: FieldContext;
    targetType: FieldDef["targetType"];
    ctxKey?: string;
    valueOptionsLoader?: ValueOptionsLoader;
    description?: string;
  }): FieldDef => ({
    path: `${args.ctxKey ?? args.table}.${args.column}`,
    label: args.label,
    type: args.type,
    operators: args.operators,
    context: args.context,
    targetType: args.targetType,
    valueOptionsLoader: args.valueOptionsLoader,
    nullable: args.nullable,
    description: args.description
  }),

  synthetic: (args: {
    path: string;
    derivedFrom: string;
    nullable: boolean;
    label: string;
    type: FieldType;
    operators: Operator[];
    context: FieldContext;
    targetType: FieldDef["targetType"];
    valueOptionsLoader?: ValueOptionsLoader;
  }): FieldDef => ({
    path: args.path,
    label: args.label,
    type: args.type,
    operators: args.operators,
    context: args.context,
    targetType: args.targetType,
    valueOptionsLoader: args.valueOptionsLoader,
    nullable: args.nullable,
    description: args.derivedFrom
  })
};

// FIELD_REGISTRY holds ONLY fields the evaluator guarantees in ctx for every
// surface within a given targetType. Fields that may be null or are only
// populated for a subset of surfaces are intentionally excluded — rule
// authors should never write a predicate that silently no-ops on some surface.
//
// Cross-target fields (e.g. storageUnit.* visible to both item + storageUnit
// rules) use the array form of `targetType`. For item-target surfaces the
// storageUnit ctx may be undefined when `line.storageUnitId` is null
// (inventoryAdjustment without a bin, warehouseTransfer with no destination
// yet); we mark such fields `nullable: true` so `availableOperators` exposes
// `isSet`/`isNotSet` and authors can guard explicitly.
//
// Dropped vs. earlier drafts (kept here as audit trail):
//   - shelf.locationId         → `shelf` is not a RuleContext root key
//   - transaction.locationId   → sometimes null per surface
//   - operation.itemId         → null at operationStart (no item bound yet)
//   - operation.workInstructionId → may be null on operations
//
// Re-added: `item.itemPostingGroupId` — the evaluator now embeds the 1:1
// `itemCost` row and flattens its `itemPostingGroupId` onto the item ctx, so
// the value is guaranteed for every item-target surface (all carry an itemId).
export const FIELD_REGISTRY: FieldDef[] = [
  // ── Item context (item + storageUnit targets) ─────────────────────────────
  // All storageUnit-target surfaces (place, pick, stockTransfer,
  // warehouseTransfer) carry a `line.itemId`, so the evaluator loads item
  // ctx and these fields resolve. Item DB columns are NOT NULL so no
  // nullable change.
  fields.database({
    table: "item",
    column: "type",
    nullable: false,
    label: "Item type",
    type: "enum",
    operators: ENUM_OPS,
    context: "item",
    targetType: ["item", "storageUnit"],
    valueOptionsLoader: "itemTypes"
  }),
  fields.database({
    table: "item",
    column: "replenishmentSystem",
    nullable: false,
    label: "Replenishment system",
    type: "enum",
    operators: ENUM_OPS,
    context: "item",
    targetType: ["item", "storageUnit"],
    valueOptionsLoader: "replenishmentSystems"
  }),
  fields.database({
    table: "item",
    column: "itemTrackingType",
    nullable: false,
    label: "Item tracking type",
    type: "enum",
    operators: ENUM_OPS,
    context: "item",
    targetType: ["item", "storageUnit"],
    valueOptionsLoader: "itemTrackingTypes"
  }),
  // Posting group lives on the 1:1 `itemCost` row, not `item`. The evaluator
  // embeds it (see server.ts item SELECT) and flattens it onto the item ctx.
  // Nullable because an item may have no posting group assigned.
  fields.synthetic({
    path: "item.itemPostingGroupId",
    derivedFrom: "The item's posting group (from its itemCost row).",
    nullable: true,
    label: "Item posting group",
    type: "id",
    operators: ID_OPS,
    context: "item",
    targetType: ["item", "storageUnit"],
    valueOptionsLoader: "itemPostingGroups"
  }),

  // ── StorageUnit context (item + storageUnit targets) ──────────────────────
  // Always loaded by the evaluator for storageUnit-target rules; loaded when
  // `line.storageUnitId` is set for item-target rules. `nullable: true` on
  // every entry so item rules can guard with `isSet`/`isNotSet`.
  fields.synthetic({
    path: "storageUnit.id",
    derivedFrom: "The bin chosen on this transaction line.",
    nullable: true,
    label: "Storage unit",
    // `"storageUnit"` triggers the hierarchical drill-down picker in the
    // rule-builder UI (Location → drilldown). No flat loader needed.
    type: "storageUnit",
    // Drill picker selects a single bin — `in`/`notIn` would require a
    // multi-select UI that doesn't exist. Restrict to scalar ops.
    operators: SCALAR_OPS,
    context: "storage",
    targetType: ["item", "storageUnit"]
  }),
  fields.synthetic({
    path: "storageUnit.storageTypeId",
    derivedFrom: "The bin's primary storage type (e.g. cold, hazmat, dry).",
    nullable: true,
    label: "Storage type",
    type: "id",
    operators: ID_OPS,
    context: "storage",
    targetType: ["item", "storageUnit"],
    valueOptionsLoader: "storageTypes"
  }),
  // Useful for `appliesToAll` rules that want to scope by physical location —
  // e.g. "block pick from any unit in the quarantine warehouse". Declared as
  // synthetic (not database) so `nullable: true` overrides the DB NOT NULL —
  // ctx itself can be undefined for item-target rules when `line.storageUnitId`
  // is null.
  fields.synthetic({
    path: "storageUnit.locationId",
    derivedFrom:
      "Physical location (warehouse or site) holding the chosen bin.",
    nullable: true,
    label: "Storage unit location",
    type: "id",
    operators: ID_OPS,
    context: "storage",
    targetType: ["item", "storageUnit"],
    valueOptionsLoader: "locations"
  }),

  // ── WorkCenter target ─────────────────────────────────────────────────────
  // workCenter is the target — always loaded by the evaluator.
  fields.database({
    table: "workCenter",
    column: "locationId",
    nullable: true,
    label: "Work center location",
    type: "id",
    operators: ID_OPS,
    context: "workCenter",
    targetType: "workCenter",
    valueOptionsLoader: "locations"
  }),
  fields.database({
    table: "workCenter",
    column: "active",
    nullable: false,
    label: "Work center active",
    type: "enum",
    operators: BOOL_OPS,
    context: "workCenter",
    targetType: "workCenter"
  }),

  // ── Transaction (shared across all targets) ───────────────────────────────
  // transaction.quantity is set by every trigger handler. No other transaction
  // field is guaranteed across all surfaces.
  fields.synthetic({
    path: "transaction.quantity",
    derivedFrom:
      "Quantity moved or applied by this transaction. Meaning shifts per surface — see per-surface notes below.",
    nullable: false,
    label: "Transaction quantity",
    type: "number",
    operators: NUMBER_OPS,
    context: "transaction",
    targetType: "shared"
  })
];

/**
 * Subset of the registry visible to a rule of a given `targetType`. Includes
 * all fields explicitly declared for that target plus the `shared` set, plus
 * any field whose `targetType` is an array containing the requested target.
 * Builder UI filters its field dropdown through this helper.
 */
export const getFieldsForTargetType = (targetType: TargetType): FieldDef[] =>
  FIELD_REGISTRY.filter((f) => {
    if (f.targetType === "shared") return true;
    if (Array.isArray(f.targetType)) return f.targetType.includes(targetType);
    return f.targetType === targetType;
  });

export const getFieldDef = (path: string): FieldDef | undefined => {
  // Custom fields are dynamic — accept any item.customFields.* path.
  if (path.startsWith("item.customFields.")) {
    return {
      path,
      label: path.slice("item.customFields.".length),
      type: "string",
      operators: SCALAR_OPS,
      context: "item",
      targetType: "item",
      description: "Custom field on the item record."
    };
  }
  return FIELD_REGISTRY.find((f) => f.path === path);
};

// ---------------------------------------------------------------------------
// Per-surface field semantics
// ---------------------------------------------------------------------------
//
// Some fields carry different meaning depending on which surface fires the
// rule. `transaction.quantity` is the prime example — it's the line qty on a
// receipt, the planned op qty on `operationStart`, the scan delta on
// `operationFinish`, etc. Surface this so rule authors don't write predicates
// that work on one surface and silently misfire on another.

const TRANSACTION_QUANTITY_NOTES: Record<TransactionSurface, string> = {
  receipt: "Quantity received on this receipt line.",
  shipment: "Quantity shipped on this shipment line.",
  stockTransfer: "Quantity moved on this stock-transfer line.",
  warehouseTransfer: "Quantity moved on this warehouse-transfer line.",
  inventoryAdjustment: "Signed delta applied by this adjustment.",
  place: "Quantity placed into the storage unit (= receipt line qty).",
  pick: "Quantity taken from the storage unit (= shipment line qty).",
  operationStart:
    "Planned operation quantity (full target, not a delta this scan).",
  operationFinish: "Quantity completed by this scan (a delta, not cumulative).",
  materialIssue: "Material quantity consumed by this issue.",
  materialReceive: "Material quantity returned to stock."
};

// StorageUnit fields shift meaning between source bin (pick / shipment) and
// destination bin (place / receipt / transfer). On operation surfaces they
// aren't populated at all.
const STORAGE_UNIT_NOTES: Record<TransactionSurface, string> = {
  receipt: "Destination bin (where receiving line lands).",
  shipment: "Source bin (where shipped line was picked from).",
  stockTransfer: "Destination bin (TO storage unit).",
  warehouseTransfer: "Destination bin (TO storage unit).",
  inventoryAdjustment: "Bin the adjustment applies to (may be unset).",
  place: "Destination bin (mirrors receipt).",
  pick: "Source bin (mirrors shipment).",
  operationStart: "Not populated.",
  operationFinish: "Not populated.",
  materialIssue: "Not populated.",
  materialReceive: "Not populated."
};

const SURFACE_FIELD_NOTES: Record<
  string,
  Partial<Record<TransactionSurface, string>>
> = {
  "transaction.quantity": TRANSACTION_QUANTITY_NOTES,
  "storageUnit.id": STORAGE_UNIT_NOTES,
  "storageUnit.locationId": STORAGE_UNIT_NOTES,
  "storageUnit.storageTypeId": STORAGE_UNIT_NOTES
};

/**
 * Per-surface note for a given field path. Returns `undefined` when the field
 * carries the same meaning across every surface it applies to (no clarification
 * needed). Returns a partial map keyed by surface otherwise.
 *
 * Builder UI renders these under the field selector when the user picks a
 * field whose semantics shift between surfaces.
 */
export const getFieldSurfaceNotes = (
  path: string
): Partial<Record<TransactionSurface, string>> | undefined =>
  SURFACE_FIELD_NOTES[path];
