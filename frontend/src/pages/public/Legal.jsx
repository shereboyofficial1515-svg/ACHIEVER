import { Link } from 'react-router-dom';
import { Alert } from '../../components/ui/index.js';
import { AlertTriangle } from 'lucide-react';

const SUPPORT = import.meta.env.VITE_SUPPORT_EMAIL || 'support@example.com';

export default function Legal() {
  return (
    <div className="section" style={{ maxWidth: 820 }}>
      <Link to="/" className="brand-mark dark">
        ACHIEVER<span className="dot">.</span>
      </Link>
      <div className="stack-lg" style={{ marginTop: 32 }}>
        <h1>Terms, privacy and how money is handled</h1>
        <Alert tone="warning" icon={AlertTriangle}>
          These notices describe how the ACHIEVER software works. They are a plain-language summary and must be reviewed and replaced by
          counsel-approved Terms of Service and a Privacy Policy before public launch.
        </Alert>

        <section className="stack-sm">
          <h2>Regulatory status</h2>
          <p>
            ACHIEVER is not a bank, microfinance bank or other licensed financial institution. It does not claim approval from the Central
            Bank of Nigeria or any other regulator, and money recorded in ACHIEVER is not covered by NDIC deposit insurance. The compliance
            framework for handling pooled member funds is under review, and features may change to meet regulatory requirements.
          </p>
        </section>

        <section className="stack-sm">
          <h2>How payments are recorded</h2>
          <p>
            Card, transfer and USSD payments are processed by Paystack. A contribution is only marked as paid after our servers confirm the
            payment directly with Paystack — never because a browser says it succeeded. Every confirmed payment creates a permanent ledger
            entry that cannot be edited.
          </p>
          <p>
            Payouts and savings returns follow two separate steps: an organiser or collector approves the payout, then the funds are sent
            and confirmed. A payout is only shown as paid once that transfer is confirmed.
          </p>
        </section>

        <section className="stack-sm">
          <h2>Organiser and collector accountability</h2>
          <p>
            Anyone who organises an Osusu group or collects savings must verify their phone number and identity (BVN or NIN) and accept a
            written undertaking that they are responsible for funds they handle and that misappropriation may carry legal consequences.
          </p>
        </section>

        <section className="stack-sm">
          <h2>Your data</h2>
          <p>
            We collect only what is needed to run your account: your name, contact details, and — for organisers and collectors — identity
            verification details. BVN and NIN numbers are never stored in readable form; we keep a one-way fingerprint and the last four
            digits. Identity documents are stored privately and viewed only by authorised staff. Payment card details are handled by
            Paystack and never reach our servers.
          </p>
        </section>

        <section className="stack-sm">
          <h2>Disputes</h2>
          <p>
            If a payment, balance or payout looks wrong, open a case from Help &amp; disputes in the app. Every case receives a reference
            number and is tracked until resolved. Contact: {SUPPORT}.
          </p>
        </section>
      </div>
    </div>
  );
}
