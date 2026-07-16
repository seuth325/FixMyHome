import { InfoSection, PublicPageShell } from '@/components/marketing/public-page-shell';

export const metadata = {
  title: 'Terms of Service | FixMyHome.pro',
  description: 'Terms of Service for FixMyHome.pro users.',
};

export default function TermsPage() {
  return (
    <PublicPageShell title="Terms of Service" eyebrow="Last updated July 16, 2026">
      <InfoSection title="Agreement to These Terms">
        <p>
          These Terms of Service govern your use of FixMyHome.pro, created and operated by FixMyHome Pro LLC as an online home repair marketplace. By creating an account or using the platform, you agree to use the service responsibly and comply with applicable laws.
        </p>
      </InfoSection>

      <InfoSection title="Marketplace Role">
        <p>
          FixMyHome.pro provides tools for homeowners and handymen to connect, post jobs, submit bids, exchange messages, and manage repair-related communication. FixMyHome.pro is not a party to the separate work agreement between a homeowner and a handyman unless a future written agreement states otherwise.
        </p>
      </InfoSection>

      <InfoSection title="User Responsibilities">
        <p>
          Users are responsible for providing accurate account information, truthful job details, fair bid information, and respectful communication. Handymen are responsible for any required licenses, permits, insurance, tax obligations, and professional qualifications related to their services.
        </p>
        <p>
          Homeowners are responsible for choosing a provider, confirming scope, price, schedule, access, and completion expectations before work begins.
        </p>
      </InfoSection>

      <InfoSection title="Payments, Bids, and Work Quality">
        <p>
          Unless payment processing is separately added to the platform, bids and payments are arranged directly between the homeowner and handyman. FixMyHome.pro does not guarantee bid acceptance, job completion, workmanship, pricing, availability, or user conduct.
        </p>
      </InfoSection>

      <InfoSection title="Prohibited Use">
        <p>
          You may not use the platform for fraud, harassment, spam, unlawful services, misleading claims, unauthorized account access, or attempts to interfere with the app, database, security, or other users.
        </p>
      </InfoSection>

      <InfoSection title="Reviews and Content">
        <p>
          Users may submit messages, job details, photos, bids, and reviews. Content should be accurate, lawful, and respectful. FixMyHome.pro may remove content or restrict accounts when content appears unsafe, unlawful, abusive, or misleading.
        </p>
      </InfoSection>

      <InfoSection title="Account Changes, Suspension, and Termination">
        <p>
          FixMyHome.pro may update, restrict, suspend, remove, or terminate a user account, profile, listing, bid, message, review, or other content if FixMyHome.pro believes, in its judgment, that the account or activity violates these Terms, creates a security or safety risk, misuses the service, appears misleading, inappropriate, abusive, unlawful, fraudulent, spam-like, or inconsistent with the purpose of the site or service.
        </p>
        <p>
          Handyman profiles may also be suspended or removed if FixMyHome.pro believes the handyman is impersonating another business or person, making false licensing or insurance claims, attempting to scam users, requesting unsafe off-platform activity, repeatedly receiving credible complaints, or otherwise presenting a risk to homeowners, other handymen, FixMyHome.pro, or the marketplace.
        </p>
        <p>
          Users may stop using the service at any time. Registered homeowners and handymen may request self-service account deletion from dashboard account settings, subject to records that may need to be retained for security, fraud prevention, legal compliance, dispute handling, backups, or legitimate business purposes. Account suspension, deletion, or removal does not waive any rights or remedies available to FixMyHome.pro or affected users.
        </p>
      </InfoSection>

      <InfoSection title="Disclaimers and Limits">
        <p>
          The platform is provided as available. To the fullest extent permitted by law, FixMyHome.pro disclaims warranties and is not liable for indirect, incidental, special, consequential, or punitive damages related to use of the service or work arranged through the platform.
        </p>
      </InfoSection>

      <InfoSection title="Contact">
        <p>
          Questions about these Terms may be sent through the Contact page. If you have legal questions about your rights or obligations, consult a qualified attorney.
        </p>
      </InfoSection>
    </PublicPageShell>
  );
}