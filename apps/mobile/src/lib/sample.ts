import type { BusinessProfile, Client, Invoice, Payment } from './shared';

/** Made-up invoice used only to preview a design in the business profile. Never saved. */
export function sampleInvoiceDoc(business: BusinessProfile): { invoice: Invoice; business: BusinessProfile; client: Client; payments: Payment[] } {
  const today = new Date().toISOString().slice(0, 10);
  const unit = 10 ** business.currencyPrecision;
  const line = (name: string, description: string, qty: number, price: number) => ({
    serviceId: null, name, description, qty: qty * 1000, unit: '', unitPrice: price * unit, discountType: 'percent' as const, discountValue: 0, taxRateBp: 0, lineTotal: qty * price * unit,
  });
  const lines = [
    line('Consultancy', 'Planning session and written recommendations', 2, 15000),
    line('Laboratory Testing', 'Sample analysis with report', 6, 2500),
    line('Transportation', 'Delivery to site', 1, 8000),
    line('Maintenance', 'Quarterly service visit', 1, 3500),
  ];
  const subtotal = lines.reduce((a, l) => a + l.lineTotal, 0);
  const tax = Math.round(subtotal * 0.1);
  const client: Client = {
    id: 'sample', name: 'Sample Client (Pvt) Ltd', contactPerson: 'Ayesha Khan', phone: '+92 300 0000000', whatsapp: '', email: 'accounts@client.example', cnic: '', ntn: '',
    address: '14 Canal Road', city: 'Lahore', province: 'Punjab', country: 'Pakistan', extraAddresses: [], extraContacts: [], category: '', openingBalance: 0, creditLimit: 0, notes: '', status: 'active',
  };
  const invoice: Invoice = {
    id: 'sample', number: `${business.invoicePrefix}00042`, status: 'final', displayStatus: 'unpaid', businessId: business.id, businessName: business.tradingName || business.legalName,
    clientId: 'sample', clientName: client.name, issueDate: today, dueDate: today, reference: 'PRJ-108', billingAddress: '', lines,
    overallDiscountType: 'percent', overallDiscountValue: 0, charges: [], notes: 'This is a sample to preview the design.', paymentTerms: 'Payment due within 15 days of the invoice date.', installments: [],
    currency: business.currency, currencyPrecision: business.currencyPrecision, taxInclusive: false, rounding: 'none',
    subtotal, itemDiscounts: 0, overallDiscount: 0, taxableAmount: subtotal, taxAmount: tax, chargesTotal: 0, roundingAdjustment: 0, total: subtotal + tax,
    paid: 0, balance: subtotal + tax, createdAt: today, finalizedAt: today,
  };
  return { invoice, business, client, payments: [] };
}
