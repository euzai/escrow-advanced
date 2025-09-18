
import 'dotenv/config';
import express from 'express';
import { ethers } from 'ethers';
import { createAgreement, createPayment } from './payto.js';
import { buildWebhookRouter } from './webhook.js';
import fs from 'fs';

const QUICKSTREAM_BASE = 'https://api.quickstream.support.qvalent.com';

const RPC_URL = process.env.RPC_URL!;
const OPERATOR_PK = process.env.OPERATOR_PK!;
const ESCROW_ADDRESS = process.env.ESCROW_ADDRESS!;
const QUICKSTREAM_BASIC = process.env.QUICKSTREAM_BASIC!;
const QUICKSTREAM_CUSTOMER_ID = process.env.QUICKSTREAM_CUSTOMER_ID!; // 83719009 from Postman
const SUPPLIER_BUSINESS_CODE = process.env.SUPPLIER_BUSINESS_CODE || 'C01791';
const PORT = Number(process.env.PORT || 3000);

if (!RPC_URL || !OPERATOR_PK || !ESCROW_ADDRESS || !QUICKSTREAM_BASIC || !QUICKSTREAM_CUSTOMER_ID) {
  console.error('Missing env');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(OPERATOR_PK, provider);

// Load ABI: try artifacts first, else fallback to a local copy
let abi: any;
const artifactsPath = new URL('../../artifacts/contracts/Escrow.sol/Escrow.json', import.meta.url);
try {
  const raw = fs.readFileSync(artifactsPath, 'utf-8');
  abi = JSON.parse(raw).abi;
} catch {
  const raw = fs.readFileSync(new URL('./abi/Escrow.json', import.meta.url), 'utf-8');
  abi = JSON.parse(raw);
}

const escrow = new ethers.Contract(ESCROW_ADDRESS, abi, provider);
const app = express();
app.use(express.json());

// Correlation -> id (in-memory). In production, persist.
const correlationToId = new Map<string, bigint>();

// 1) When NFT arrives (depositNFT), contract emits PayToAgreementRequested -> create agreement
escrow.on('PayToAgreementRequested', async (id: bigint, correlationRaw: string) => {
  console.log('PayToAgreementRequested', id.toString(), correlationRaw);
  correlationToId.set(String(correlationRaw), id);

  const agreementPayload = {
    supplierBusinessCode: SUPPLIER_BUSINESS_CODE,
    paymentDetails: {
      purpose: 'PERS',
      description: 'Payment for your digital asset',
      startDate: '2025-07-02',
      automaticRenewal: true,
    },
    paymentTerms: {
      frequency: 'ADHO',
      agreementType: 'VARI',
      paymentAmount: '100.00',
      maximumPaymentAmount: '1000.00',
      currency: 'AUD',
    },
    payerDetails: {
      payerType: 'PERS',
      payerId: 'IM999',
      payerName: 'Jo Bloggs',
      bsb: '062692',
      accountNumber: '123456',
    },
  } as const;

  const agreement = await createAgreement(QUICKSTREAM_BASE, QUICKSTREAM_CUSTOMER_ID, QUICKSTREAM_BASIC, agreementPayload);
  const agreementToken = (agreement && (agreement.agreementToken || agreement.token || agreement.agreement?.token)) as string;
  if (!agreementToken) throw new Error('agreementToken not found in response');

  const tx = await escrow.connect(wallet).confirmAgreement(id, agreementToken);
  await tx.wait();
});

// 2) After confirmAgreement, we emit PayToPaymentRequested -> create payment
escrow.on('PayToPaymentRequested', async (id: bigint, correlationRaw: string, _hash: string, agreementToken: string) => {
  console.log('PayToPaymentRequested', id.toString(), correlationRaw, agreementToken);
  const paymentPayload = {
    transactionType: 'PAYMENT',
    payToData: {
      endToEndId: correlationRaw,
      remittanceInformation1: 'Payment to Imperium Markets',
      finalPayment: false,
      agreementToken,
    },
    supplierBusinessCode: SUPPLIER_BUSINESS_CODE,
    principalAmount: 1000.00,
    currency: 'AUD',
  } as const;

  await createPayment(QUICKSTREAM_BASE, QUICKSTREAM_BASIC, paymentPayload);
  // Final confirmation will arrive via webhook -> confirmPayment
});

// 3) Webhook endpoint
app.use('/', buildWebhookRouter(provider, wallet, escrow, correlationToId));

app.listen(PORT, () => console.log(`Relayer listening on :${PORT}`));
