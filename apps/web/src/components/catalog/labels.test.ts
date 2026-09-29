import { PRODUCT_STATUSES, canTransitionProduct } from '@solmira/contracts';
import { describe, expect, it } from 'vitest';
import { productStatusActions, variantStatusActions } from './labels';

describe('status actions', () => {
  it('offers exactly the transitions the API allows', () => {
    for (const from of PRODUCT_STATUSES) {
      for (const action of productStatusActions(from)) {
        expect(canTransitionProduct(from, action.to), `${from} -> ${action.to}`).toBe(true);
        expect(action.to).not.toBe(from);
      }
    }
    expect(productStatusActions('DRAFT').map((a) => a.label)).toEqual(['Activate', 'Archive']);
  });

  it('never offers a way back to draft', () => {
    for (const from of PRODUCT_STATUSES) {
      expect(productStatusActions(from).map((a) => a.to)).not.toContain('DRAFT');
    }
  });

  it('restores archived records to inactive, not straight to active', () => {
    expect(productStatusActions('ARCHIVED')).toEqual([
      { to: 'INACTIVE', label: 'Restore', destructive: false },
    ]);
    expect(variantStatusActions('ARCHIVED')).toEqual([
      { to: 'INACTIVE', label: 'Restore', destructive: false },
    ]);
  });

  it('marks archiving as destructive', () => {
    expect(productStatusActions('ACTIVE').find((a) => a.to === 'ARCHIVED')?.destructive).toBe(true);
  });
});
