import { Prisma, CommissionStatus, LedgerType, NotificationType } from '@prisma/client';
import { prisma } from '../prisma';

export async function releaseMaturedCommissions(batchSize = 100): Promise<number> {
  const matured = await prisma.commission.findMany({
    where: { status: CommissionStatus.PENDING, availableAt: { lte: new Date() } },
    select: { id: true, affiliateId: true, commissionAmount: true, currency: true, affiliate: { select: { userId: true } } },
    orderBy: { availableAt: 'asc' },
    take: batchSize,
  });
  let released = 0;
  for (const commission of matured) {
    const didRelease = await prisma.$transaction(async (tx) => {
      const claimed = await tx.commission.updateMany({
        where: { id: commission.id, status: CommissionStatus.PENDING, availableAt: { lte: new Date() } },
        data: { status: CommissionStatus.AVAILABLE },
      });
      if (claimed.count !== 1) return false;
      await tx.walletEntry.createMany({
        data: [
          {
            affiliateId: commission.affiliateId,
            type: LedgerType.PENDING_DEBIT,
            amount: commission.commissionAmount,
            currency: commission.currency,
            referenceType: 'COMMISSION_RELEASE',
            referenceId: commission.id,
            description: 'Pending commission released',
          },
          {
            affiliateId: commission.affiliateId,
            type: LedgerType.AVAILABLE_CREDIT,
            amount: commission.commissionAmount,
            currency: commission.currency,
            referenceType: 'COMMISSION_RELEASE',
            referenceId: commission.id,
            description: 'Commission available for withdrawal',
          },
        ],
        skipDuplicates: true,
      });
      const userId = commission.affiliate.userId;
      const preference = await tx.notificationPreference.findUnique({ where: { userId } });
      if (!preference || (preference.inAppEnabled && !preference.mutedTypes.includes(NotificationType.COMMISSION))) {
        await tx.notification.create({
          data: {
            userId,
            type: NotificationType.COMMISSION,
            title: 'Commission is now available',
            message: `Your commission ${commission.id} has completed its validation period and is available for withdrawal.`,
          },
        });
      }
      return true;
    });
    if (didRelease) released += 1;
  }
  return released;
}
