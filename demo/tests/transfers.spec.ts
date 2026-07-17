import { expect, test } from '@playwright/test';
import { TRANSFER_LIMIT, TransferError, TransferService } from '../src/transfer-service.js';

test.describe('transfer limits', () => {
  test(
    'accepts a transfer exactly at the limit',
    {
      tag: ['@compliance', '@control:TR-001', '@style:boundary'],
      annotation: [{ type: 'boundary', description: `T=${TRANSFER_LIMIT}` }],
    },
    () => {
      const service = new TransferService();
      expect(() => service.submit(TRANSFER_LIMIT)).not.toThrow();
    },
  );

  test(
    'accepts a transfer one cent below the limit',
    {
      tag: ['@compliance', '@control:TR-001', '@style:boundary'],
      annotation: [{ type: 'boundary', description: `T-0.01=${TRANSFER_LIMIT - 0.01}` }],
    },
    () => {
      const service = new TransferService();
      expect(() => service.submit(TRANSFER_LIMIT - 0.01)).not.toThrow();
    },
  );

  test(
    'rejects a transfer one cent above the limit',
    {
      tag: ['@compliance', '@control:TR-001', '@style:negative'],
      annotation: [{ type: 'boundary', description: `T+0.01=${TRANSFER_LIMIT + 0.01}` }],
    },
    () => {
      const service = new TransferService();
      expect(() => service.submit(TRANSFER_LIMIT + 0.01)).toThrow(TransferError);
    },
  );

  test(
    'rejects zero and negative amounts',
    { tag: ['@compliance', '@control:TR-001', '@style:negative'] },
    () => {
      const service = new TransferService();
      expect(() => service.submit(0)).toThrow(TransferError);
      expect(() => service.submit(-50)).toThrow(TransferError);
    },
  );
});

test.describe('transfer lifecycle', () => {
  test(
    'a settled transfer leaves a complete, ordered audit trail',
    { tag: ['@compliance', '@control:TR-002', '@style:lifecycle'] },
    () => {
      const service = new TransferService();
      const id = service.submit(250);
      service.approve(id, { name: 'amina', role: 'approver' });
      service.settle(id);
      expect(service.state(id)).toBe('settled');
      expect(service.auditTrail(id)).toEqual([
        'transfer.created',
        'transfer.approved',
        'transfer.settled',
      ]);
    },
  );

  test(
    'a rejected transfer records the failure reason in its audit trail',
    { tag: ['@compliance', '@control:TR-002', '@style:lifecycle'] },
    () => {
      const service = new TransferService();
      const id = service.submit(250);
      service.reject(id, 'sanctions-screening');
      expect(service.state(id)).toBe('failed');
      expect(service.auditTrail(id)).toEqual([
        'transfer.created',
        'transfer.failed:sanctions-screening',
      ]);
    },
  );
});
