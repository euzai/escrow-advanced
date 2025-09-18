
import type { Router } from 'express';
import { Router as NewRouter } from 'express';
import { ethers } from 'ethers';

export function buildWebhookRouter(provider: ethers.Provider, wallet: ethers.Wallet, escrow: ethers.Contract, correlationToId: Map<string, bigint>) : Router {
  const router = NewRouter();

  // Adjust schema based on actual QuickStream webhook payload
  router.post('/payto/webhook', async (req, res) => {
    try {
      const { correlationId, receiptNumber, amountCents, currency } = req.body ?? {};
      if (!correlationId) return res.status(400).send('missing correlationId');
      const id = correlationToId.get(String(correlationId));
      if (!id) return res.status(404).send('unknown correlation');

      const tx = await escrow.connect(wallet).confirmPayment(id, String(receiptNumber||''), Number(amountCents||0), String(currency||'AUD'));
      await tx.wait();
      res.sendStatus(200);
    } catch (e) {
      console.error(e);
      res.status(500).send(String(e));
    }
  });

  return router;
}
