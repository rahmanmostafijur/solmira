import { describe, expect, it } from 'vitest';
import { actionLabel, actorLabel, describeDetails, targetLabel } from './audit-format';

describe('audit formatting', () => {
  it('turns an action into a sentence', () => {
    expect(actionLabel('endpoint_secret.revealed')).toBe('Endpoint secret revealed');
    expect(actionLabel('member.role_changed')).toBe('Member role changed');
  });

  it('names the target type', () => {
    expect(targetLabel('api_key')).toBe('API key');
    expect(targetLabel('endpoint')).toBe('Endpoint');
  });

  it('names the platform for system actions and shortens a person id', () => {
    expect(actorLabel({ actorType: 'system', actorId: null })).toBe('Platform');
    expect(actorLabel({ actorType: 'user', actorId: '0190a000-0000-7000-8000-000000000001' })).toBe(
      '0190a000',
    );
  });

  it('prints details as indented JSON', () => {
    expect(describeDetails({ fields: ['name'] })).toBe('{\n  "fields": [\n    "name"\n  ]\n}');
  });
});
