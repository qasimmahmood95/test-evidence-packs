export const TRANSFER_LIMIT = 10_000;

export type TransferState = 'created' | 'settled' | 'failed';
export type Role = 'initiator' | 'approver' | 'viewer';

export interface Actor {
  name: string;
  role: Role;
}

export class TransferError extends Error {}

interface Transfer {
  amount: number;
  state: TransferState;
  approvedBy?: string;
  audit: string[];
}

/** Tiny in-memory policy engine the demo suite tests against. */
export class TransferService {
  private seq = 0;
  private readonly transfers = new Map<string, Transfer>();

  submit(amount: number): string {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new TransferError('amount must be a positive number');
    }
    if (amount > TRANSFER_LIMIT) {
      throw new TransferError(`amount exceeds the transfer limit of ${TRANSFER_LIMIT}`);
    }
    const id = `tr-${++this.seq}`;
    this.transfers.set(id, { amount, state: 'created', audit: ['transfer.created'] });
    return id;
  }

  approve(id: string, actor: Actor): void {
    const transfer = this.get(id);
    if (actor.role !== 'approver') {
      throw new TransferError(`role "${actor.role}" may not approve transfers`);
    }
    transfer.approvedBy = actor.name;
    transfer.audit.push('transfer.approved');
  }

  settle(id: string): void {
    const transfer = this.get(id);
    if (!transfer.approvedBy) {
      throw new TransferError('transfer must be approved before settlement');
    }
    transfer.state = 'settled';
    transfer.audit.push('transfer.settled');
  }

  reject(id: string, reason: string): void {
    const transfer = this.get(id);
    transfer.state = 'failed';
    transfer.audit.push(`transfer.failed:${reason}`);
  }

  state(id: string): TransferState {
    return this.get(id).state;
  }

  auditTrail(id: string): string[] {
    return [...this.get(id).audit];
  }

  private get(id: string): Transfer {
    const transfer = this.transfers.get(id);
    if (!transfer) throw new TransferError(`unknown transfer ${id}`);
    return transfer;
  }
}
