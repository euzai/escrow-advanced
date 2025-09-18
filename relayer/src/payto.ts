
import fetch from "node-fetch";

export interface AgreementCreatePayload {
  supplierBusinessCode: string;
  paymentDetails: any;
  paymentTerms: any;
  payerDetails: any;
}

export interface PaymentCreatePayload {
  transactionType: "PAYMENT";
  payToData: {
    endToEndId: string;
    remittanceInformation1?: string;
    finalPayment?: boolean;
    agreementToken: string;
  };
  supplierBusinessCode: string;
  principalAmount: number;
  currency: string;
}

export async function createAgreement(baseUrl: string, customerId: string, auth: string, payload: AgreementCreatePayload) {
  const url = `${baseUrl}/rest/v1/customers/${customerId}/payto-agreements`;
  const res = await fetch(url, { method: 'POST', headers: { 'Authorization': auth, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`Agreement create failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<any>; // shape depends on provider
}

export async function createPayment(baseUrl: string, auth: string, payload: PaymentCreatePayload) {
  const url = `${baseUrl}/rest/v1/transactions`;
  const res = await fetch(url, { method: 'POST', headers: { 'Authorization': auth, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`Payment create failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<any>;
}
