import { expect, test } from '@playwright/test';
import { TransferError, TransferService } from '../src/transfer-service.js';

test.describe('segregation of duties', () => {
  test(
    'a viewer cannot approve a transfer',
    { tag: ['@compliance', '@control:AC-003', '@style:negative'] },
    () => {
      const service = new TransferService();
      const id = service.submit(100);
      expect(() => service.approve(id, { name: 'vik', role: 'viewer' })).toThrow(TransferError);
    },
  );

  test(
    'settlement without a prior approval is refused',
    { tag: ['@compliance', '@control:AC-003', '@style:negative'] },
    () => {
      const service = new TransferService();
      const id = service.submit(100);
      expect(() => service.settle(id)).toThrow(TransferError);
    },
  );

  test(
    'an approver can approve a transfer',
    { tag: ['@compliance', '@control:AC-003'] },
    () => {
      const service = new TransferService();
      const id = service.submit(100);
      expect(() => service.approve(id, { name: 'amina', role: 'approver' })).not.toThrow();
    },
  );

  // Deliberate: AC-999 is not declared in controls.yaml. The generated pack
  // flags it as an unmapped control tag — this demonstrates typo detection.
  test(
    'approvals are attributed to a named actor',
    { tag: ['@compliance', '@control:AC-999'] },
    () => {
      const service = new TransferService();
      const id = service.submit(100);
      service.approve(id, { name: 'amina', role: 'approver' });
      expect(service.auditTrail(id)).toContain('transfer.approved');
    },
  );
});
