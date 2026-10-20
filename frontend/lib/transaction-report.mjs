import { jsPDF } from 'jspdf';

const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
const dateTime = (value) => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export function createTransactionReport(rows, vendorName, createdAt = new Date()) {
  const pdf = new jsPDF();
  pdf.setFontSize(18);
  pdf.text('Transaction review report', 14, 18);
  pdf.setFontSize(10);
  pdf.text(`Business: ${vendorName}`, 14, 27);
  pdf.text(`Created: ${createdAt.toLocaleString('en-IN')}`, 14, 33);
  let y = 44;
  for (const item of rows) {
    const lines = [
      `UTR: ${item.utr}  |  Amount: ${money(item.amount)}`,
      `Date: ${dateTime(item.occurredAt)}  |  Risk: ${item.riskLevel} (${item.riskScore})  |  Review: ${item.status}  |  Payment verification: ${item.paymentVerificationStatus || 'unverified'}`,
      `Signals: ${(item.riskFactors || []).map((factor) => factor.description || factor.rule_code).join('; ') || 'No configured risk signals'}`,
      `Alert review history: ${(item.alerts || []).map((alert) => `${alert.alertType} — ${alert.reviewedAt ? `reviewed ${dateTime(alert.reviewedAt)}` : 'not reviewed'}`).join('; ') || 'No alerts'}`,
      `Evidence image attached in app: ${item.evidenceUrl ? 'Yes' : 'No'}`,
    ];
    const wrapped = lines.flatMap((line) => pdf.splitTextToSize(line, 180));
    if (y + wrapped.length * 5 + 8 > 280) { pdf.addPage(); y = 18; }
    pdf.text(wrapped, 14, y);
    y += wrapped.length * 5 + 8;
  }
  pdf.setFontSize(8);
  pdf.text('Risk indicators support review. UTR entries are unverified unless explicitly confirmed by a payment provider.', 14, 289);
  return pdf;
}

export function downloadTransactionReport(rows, vendorName) {
  createTransactionReport(rows, vendorName).save('transaction-review-report.pdf');
}
