---
name: forms
description: Use when building, editing, or adding forms in the Carbon ERP/MES codebase - covers ValidatedForm, zod validators, form components, and action handlers
---

# Carbon Forms

Forms in Carbon follow a three-part pattern: **zod validator** in the module's `.models.ts`, **form component** in the module's `ui/` directory, and **action handler** in the route file.

## File Locations

| Piece | ERP Location | MES Location |
|-------|-------------|-------------|
| Validator | `app/modules/{module}/{module}.models.ts` | `app/services/models.ts` |
| Form UI | `app/modules/{module}/ui/{Feature}/{Feature}Form.tsx` | Inline in route or `app/components/` |
| Route action | `app/routes/x+/{module}+/{resource}.new.tsx` | `app/routes/x+/{resource}.tsx` |
| Form components | `~/components/Form` (re-exports `@carbon/form` + domain selectors) | `@carbon/form` directly |

## 1. Validator (zod schema)

Define in the module's `.models.ts`. Use `z` from `zod` and `zfd` from `zod-form-data`.

```typescript
import { z } from "zod";
import { zfd } from "zod-form-data";

export const thingValidator = z.object({
  id: zfd.text(z.string().optional()),              // optional ID for create/edit
  name: z.string().min(1, { message: "Name is required" }),
  type: z.enum(thingTypes, {                         // enum with custom error
    errorMap: () => ({ message: "Type is required" })
  }),
  quantity: zfd.numeric(z.number().min(0)),           // numeric from FormData
  isActive: zfd.checkbox(),                           // checkbox boolean
  notes: zfd.text(z.string().optional()),             // optional text
  items: z.array(z.string().min(1)).min(1, {          // required array
    message: "At least one item is required"
  }),
});
```

**Key rules:**

- Use `zfd.text()` for optional strings from FormData
- Use `zfd.numeric()` for numbers from FormData
- Use `zfd.checkbox()` for boolean checkboxes
- Use `z.enum()` with `errorMap` for enum fields
- Use `.refine()` for cross-field validation

## 2. Form Component

The core of any form is `ValidatedForm` wrapping your fields. The surrounding container varies by context — Drawers, Cards, inline sections, modals, etc. Look at neighboring routes to match the existing pattern.

Import form fields from `~/components/Form` (ERP) or `@carbon/form` (MES).

```typescript
import { ValidatedForm } from "@carbon/form";
import { Button, HStack, VStack } from "@carbon/react";
import { useNavigate } from "react-router";
import type { z } from "zod";
import { Hidden, Input, Select, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { thingValidator } from "~/modules/things";
import { path } from "~/utils/path";

type ThingFormProps = {
  initialValues: z.infer<typeof thingValidator>;
};

const ThingForm = ({ initialValues }: ThingFormProps) => {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const isEditing = !!initialValues.id;
  const isDisabled = isEditing
    ? !permissions.can("update", "things")
    : !permissions.can("create", "things");

  return (
    <ValidatedForm
      validator={thingValidator}
      method="post"
      action={isEditing ? path.to.thing(initialValues.id!) : path.to.newThing}
      defaultValues={initialValues}
    >
      <Hidden name="id" />
      <VStack spacing={4}>
        <Input name="name" label="Name" />
        <Select name="type" label="Type" options={typeOptions} />
      </VStack>
      <HStack>
        <Submit isDisabled={isDisabled}>Save</Submit>
        <Button size="md" variant="solid" onClick={onClose}>Cancel</Button>
      </HStack>
    </ValidatedForm>
  );
};
```

**Key rules:**

- Always include `<Hidden name="id" />` for edit support
- Use `VStack spacing={4}` for vertical field layout
- Use `grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4` for multi-column layouts
- Permission check determines `isDisabled` on Submit
- Type props with `z.infer<typeof validator>`

## 3. Route Action

```typescript
import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { thingValidator, insertThing } from "~/modules/things";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "things"
  });

  const validation = await validator(thingValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await insertThing(client, {
    ...validation.data,
    companyId,
    createdBy: userId
  });

  if (result.error) {
    return data({}, await flash(request, error(result.error, "Failed to create thing")));
  }

  throw redirect(path.to.things, await flash(request, success("Thing created")));
}
```

**Key rules:**
- `assertIsPost(request)` first
- `requirePermissions` with appropriate module/action
- `validator(schema).validate(formData)` - NOT `schema.parse()`
- Return `validationError(validation.error)` on failure (422 status)
- `throw redirect()` on success (not `return redirect()`)
- Return plain objects from actions, never `Response.json()`

## 4. Route Default Export

```typescript
export default function NewThingRoute() {
  const initialValues = {
    id: "",
    name: "",
    type: "Default" as const,
  };
  return <ThingForm initialValues={initialValues} />;
}
```

For edit routes, load data in the loader and pass to the form:

```typescript
export default function EditThingRoute() {
  const { thing } = useLoaderData<typeof loader>();
  return <ThingForm initialValues={thing} />;
}
```

## Available Form Components

**From `@carbon/form` (base):**

| Component | Props | Use for |
|-----------|-------|---------|
| `Input` | `name, label, prefix?, suffix?, helperText?` | Text fields |
| `Number` | `name, label, formatOptions?` | Numeric fields with steppers |
| `TextArea` | `name, label, characterLimit?` | Multi-line text |
| `Select` | `name, label, options: {label, value}[]` | Dropdown |
| `Combobox` | `name, label, options: {label, value}[]` | Searchable dropdown |
| `CreatableCombobox` | `name, label, options, onCreateOption?` | Searchable + create new |
| `MultiSelect` | `name, label, options` | Multi-select |
| `Boolean` | `name, label, description?` | Switch/toggle |
| `DatePicker` | `name, label, minValue?, maxValue?` | Date selection |
| `DateTimePicker` | `name, label` | Date + time |
| `TimePicker` | `name, label` | Time only |
| `Hidden` | `name, value?` | Hidden fields |
| `Password` | `name, label` | Password with toggle |
| `Radios` | `name, label, options, orientation?` | Radio buttons |
| `Submit` | `isDisabled?, withBlocker?` | Submit with unsaved changes warning |
| `Array` | `name, label` | Dynamic list fields |

**From `~/components/Form` (ERP domain selectors):**

`Customer`, `Supplier`, `Employee`, `Employees`, `Users`, `Item`, `Part`, `Location`, `Account`, `AccountCategory`, `AccountSubcategory`, `Currency`, `Department`, `WorkCenter`, `UnitOfMeasure`, `PaymentTerm`, `ShippingMethod`, `Shift`, `Sequence`, `Process`, `Procedure`, `Tool`, `Tags`, `CustomFormFields`

These are `Combobox`/`CreatableCombobox` wrappers that auto-load options from stores. Use them instead of raw Combobox when the entity type matches.

## Common Patterns

**Dependent fields** (value of one field changes options of another):
```typescript
const [categoryId, setCategoryId] = useState(initialValues.categoryId ?? "");

<AccountCategory name="categoryId" onChange={(cat) => setCategoryId(cat?.id ?? "")} />
<AccountSubcategory name="subcategoryId" accountCategoryId={categoryId} />
```

**Enum options from const array:**
```typescript
const typeOptions = thingTypes.map((t) => ({ label: t, value: t }));
<Select name="type" label="Type" options={typeOptions} />
```

**Client action for cache invalidation:**
```typescript
export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  const companyId = getCompanyId();
  window.clientCache?.invalidateQueries({
    predicate: (query) => {
      const queryKey = query.queryKey as string[];
      return queryKey[0] === "things" && queryKey[1] === companyId;
    }
  });
  return await serverAction();
}
```

## Checklist

When building a new form:

1. Define zod validator in `{module}.models.ts`
2. Export validator from module index
3. Create form component in `ui/{Feature}/{Feature}Form.tsx`
4. Create route file with action + default export
5. Add `clientAction` if the entity is cached client-side
6. Add path helpers in `~/utils/path` if needed
7. Check neighboring routes to match the container pattern (Drawer, Card, inline, etc.)
