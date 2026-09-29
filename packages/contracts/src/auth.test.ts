import { describe, expect, it } from 'vitest';
import { loginRequestSchema, registerRequestSchema } from './auth.js';
import {
  createOrganizationRequestSchema,
  updateOrganizationRequestSchema,
} from './organizations.js';

describe('registerRequestSchema', () => {
  it('normalises email to lower case and trims names', () => {
    const parsed = registerRequestSchema.parse({
      email: '  Ana.Lopez@Northwind.Example ',
      password: 'correct horse battery',
      fullName: '  Ana Lopez ',
    });

    expect(parsed).toEqual({
      email: 'ana.lopez@northwind.example',
      password: 'correct horse battery',
      fullName: 'Ana Lopez',
    });
  });

  it('rejects short passwords and overly long ones', () => {
    const base = { email: 'a@b.example', fullName: 'A' };
    expect(registerRequestSchema.safeParse({ ...base, password: 'short' }).success).toBe(false);
    expect(registerRequestSchema.safeParse({ ...base, password: 'x'.repeat(129) }).success).toBe(
      false,
    );
  });

  it('strips unexpected fields such as a client-supplied role', () => {
    const parsed = registerRequestSchema.parse({
      email: 'a@b.example',
      password: 'long enough password',
      fullName: 'A',
      role: 'OWNER',
    });

    expect(parsed).not.toHaveProperty('role');
  });
});

describe('loginRequestSchema', () => {
  it('does not apply the registration password policy', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.example', password: 'old' }).success).toBe(
      true,
    );
  });
});

describe('organization schemas', () => {
  it('validates slugs', () => {
    expect(
      createOrganizationRequestSchema.safeParse({ name: 'Northwind', slug: 'northwind-traders' })
        .success,
    ).toBe(true);
    expect(
      createOrganizationRequestSchema.safeParse({ name: 'Northwind', slug: '-bad-' }).success,
    ).toBe(false);
  });

  it('rejects unknown time zones and empty updates', () => {
    expect(updateOrganizationRequestSchema.safeParse({ timezone: 'Europe/Berlin' }).success).toBe(
      true,
    );
    expect(updateOrganizationRequestSchema.safeParse({ timezone: 'Mars/Olympus' }).success).toBe(
      false,
    );
    expect(updateOrganizationRequestSchema.safeParse({}).success).toBe(false);
  });
});
