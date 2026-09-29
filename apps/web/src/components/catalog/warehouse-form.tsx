'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  warehouseCodeSchema,
  type CreateWarehouseRequest,
  type Warehouse,
} from '@solmira/contracts';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { usePermissions } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useCreateWarehouse, useUpdateWarehouse } from '@/lib/catalog-queries';
import { applyServerError, pickDirty } from '@/lib/forms';
import { useMembers } from '@/lib/queries';

const text = (max: number) => z.string().trim().max(max);

const warehouseFormSchema = z
  .object({
    code: z.string().trim().toUpperCase(),
    name: z.string().trim().min(1, 'Enter a name').max(120),
    description: text(500),
    addressLine: text(200),
    city: text(100),
    country: z.string().trim().toUpperCase(),
    managerMemberId: z.string(),
  })
  .superRefine((values, ctx) => {
    const codeIssue = warehouseCodeSchema.safeParse(values.code).error?.issues[0]?.message;
    if (codeIssue) ctx.addIssue({ code: 'custom', path: ['code'], message: codeIssue });
    if (values.country && !/^[A-Z]{2}$/.test(values.country)) {
      ctx.addIssue({
        code: 'custom',
        path: ['country'],
        message: 'Use a 2-letter country code, e.g. BD',
      });
    }
  });

type FormInput = z.input<typeof warehouseFormSchema>;
type FormValues = z.output<typeof warehouseFormSchema>;
const orNull = (value: string) => (value === '' ? null : value);

function defaults(warehouse?: Warehouse): FormInput {
  return {
    code: warehouse?.code ?? '',
    name: warehouse?.name ?? '',
    description: warehouse?.description ?? '',
    addressLine: warehouse?.addressLine ?? '',
    city: warehouse?.city ?? '',
    country: warehouse?.country ?? '',
    managerMemberId: warehouse?.manager?.memberId ?? '',
  };
}

function toRequest(values: FormValues): CreateWarehouseRequest {
  return {
    code: values.code,
    name: values.name,
    description: orNull(values.description),
    addressLine: orNull(values.addressLine),
    city: orNull(values.city),
    country: orNull(values.country),
    managerMemberId: orNull(values.managerMemberId),
  };
}

interface WarehouseFormProps {
  organizationId: string;
  warehouse?: Warehouse;
  readOnly?: boolean;
  onSaved: (warehouse: Warehouse) => void;
  onCancel?: () => void;
}

/**
 * The manager list comes from identity (members of this organization). Picking from it is a
 * convenience: operations re-checks with identity that the member is active in this
 * organization before saving, whatever id is submitted.
 */
export function WarehouseForm({
  organizationId,
  warehouse,
  readOnly,
  onSaved,
  onCancel,
}: WarehouseFormProps) {
  const notify = useToast();
  const { can } = usePermissions();
  const canListMembers = can('users.read');
  const members = useMembers(organizationId, canListMembers && !readOnly);
  const create = useCreateWarehouse(organizationId);
  const update = useUpdateWarehouse(organizationId, warehouse?.id ?? '');
  const form = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(warehouseFormSchema),
    defaultValues: defaults(warehouse),
  });
  const { errors, isSubmitting, isDirty, dirtyFields } = form.formState;

  const managerChoices = useMemo(() => {
    const active = (members.data ?? [])
      .filter((m) => m.status === 'active')
      .map((m) => ({ id: m.id, label: `${m.fullName} (${m.email})` }));
    const current = warehouse?.manager;
    return current && !active.some((m) => m.id === current.memberId)
      ? [{ id: current.memberId, label: `${current.fullName} (${current.email})` }, ...active]
      : active;
  }, [members.data, warehouse?.manager]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (!warehouse) {
        onSaved(await create.mutateAsync(toRequest(values)));
        return;
      }
      const change = pickDirty(toRequest(values), dirtyFields);
      if (!change) return notify('Nothing to save', 'info');
      const saved = await update.mutateAsync(change);
      form.reset(defaults(saved));
      onSaved(saved);
    } catch (error) {
      applyServerError(error, form.setError);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
      <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Code"
          autoComplete="off"
          maxLength={20}
          hint="Printed on labels, e.g. WH-DHK"
          error={errors.code?.message}
          {...form.register('code')}
        />
        <TextField
          label="Name"
          autoComplete="off"
          error={errors.name?.message}
          {...form.register('name')}
        />
        <TextField
          label="Address"
          autoComplete="street-address"
          error={errors.addressLine?.message}
          {...form.register('addressLine')}
        />
        <TextField label="City" error={errors.city?.message} {...form.register('city')} />
        <TextField
          label="Country"
          maxLength={2}
          hint="2-letter code, e.g. BD"
          error={errors.country?.message}
          {...form.register('country')}
        />
        {canListMembers ? (
          <SelectField
            label="Manager"
            error={errors.managerMemberId?.message}
            disabled={members.isPending}
            {...form.register('managerMemberId')}
          >
            <option value="">No manager</option>
            {managerChoices.map((member) => (
              <option key={member.id} value={member.id}>
                {member.label}
              </option>
            ))}
          </SelectField>
        ) : (
          <TextField
            label="Manager"
            readOnly
            value={warehouse?.manager?.fullName ?? 'No manager'}
            hint="Assigning a manager requires access to members"
          />
        )}
        <div className="sm:col-span-2">
          <TextAreaField
            label="Description"
            error={errors.description?.message}
            {...form.register('description')}
          />
        </div>
      </fieldset>
      {!readOnly && (
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          {onCancel && (
            <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
              Cancel
            </Button>
          )}
          <Button type="submit" loading={isSubmitting} disabled={Boolean(warehouse) && !isDirty}>
            {warehouse ? 'Save changes' : 'Create warehouse'}
          </Button>
        </div>
      )}
    </form>
  );
}
