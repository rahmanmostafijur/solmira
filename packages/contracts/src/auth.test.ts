import { describe, expect, it } from 'vitest';
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  updateProfileRequestSchema,
} from './auth.js';
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

describe('updateProfileRequestSchema', () => {
  it('trims the name and applies the registration bounds', () => {
    expect(updateProfileRequestSchema.parse({ fullName: '  Ana Lopez ' })).toEqual({
      fullName: 'Ana Lopez',
    });
    expect(updateProfileRequestSchema.safeParse({ fullName: '   ' }).success).toBe(false);
    expect(updateProfileRequestSchema.safeParse({ fullName: 'x'.repeat(121) }).success).toBe(false);
    expect(updateProfileRequestSchema.safeParse({}).success).toBe(false);
  });

  it('does not accept an email change', () => {
    const parsed = updateProfileRequestSchema.parse({ fullName: 'A', email: 'new@b.example' });

    expect(parsed).not.toHaveProperty('email');
  });
});

describe('changePasswordRequestSchema', () => {
  const issuesOf = (body: unknown) => {
    const result = changePasswordRequestSchema.safeParse(body);
    return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
  };

  it('accepts any current password but holds the new one to the registration policy', () => {
    expect(issuesOf({ currentPassword: 'old', newPassword: 'a long enough passphrase' })).toEqual(
      [],
    );
    expect(issuesOf({ currentPassword: 'old', newPassword: 'short' })).toEqual(['newPassword']);
    expect(issuesOf({ currentPassword: 'old', newPassword: 'x'.repeat(129) })).toEqual([
      'newPassword',
    ]);
    expect(issuesOf({ currentPassword: '', newPassword: 'a long enough passphrase' })).toEqual([
      'currentPassword',
    ]);
  });

  it('rejects a new password equal to the current one, on the new password field', () => {
    const same = 'the same passphrase twice';

    expect(issuesOf({ currentPassword: same, newPassword: same })).toEqual(['newPassword']);
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
