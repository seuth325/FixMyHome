import { InfoSection, PublicPageShell } from '@/components/marketing/public-page-shell';

export const metadata = {
  title: 'Privacy Policy | FixMyHome.pro',
  description: 'Privacy Policy for FixMyHome.pro users.',
};

export default function PrivacyPolicyPage() {
  return (
    <PublicPageShell title="Privacy Policy" eyebrow="Last updated July 16, 2026">
      <InfoSection title="Overview">
        <p>
          FixMyHome.pro is created and operated by FixMyHome Pro LLC as an online home repair marketplace. This Privacy Policy explains how we collect, use, and protect information when homeowners, handymen, and administrators use the platform.
        </p>
      </InfoSection>

      <InfoSection title="Information We Collect">
        <p>
          We may collect account details such as name, email address, role, ZIP code, profile information, job posts, bids, messages, reviews, uploaded images, and support requests. We also collect basic technical information such as device, browser, IP address, session activity, and app usage needed to keep the service secure and reliable.
        </p>
      </InfoSection>

      <InfoSection title="How We Use Information">
        <p>
          We use information to create and manage accounts, show relevant job and bid information, support messaging, send password reset and account emails, improve the platform, prevent misuse, respond to support requests, and maintain security.
        </p>
      </InfoSection>

      <InfoSection title="Sharing and Marketplace Visibility">
        <p>
          Some information is visible to other users as part of the marketplace. For example, homeowners may see handyman bids and profiles, and handymen may see job details needed to decide whether to bid. We do not sell user personal information.
        </p>
      </InfoSection>

      <InfoSection title="Security">
        <p>
          We use account authentication, secure password reset flows, role-based access, HTTPS, and operational safeguards to protect user information. No online service can guarantee perfect security, so users should use strong passwords and keep their email accounts secure.
        </p>
      </InfoSection>

      <InfoSection title="Email and Notifications">
        <p>
          We may send transactional emails such as password reset links, account notices, and service-related messages. Password reset links are designed to expire after a limited time for safety.
        </p>
      </InfoSection>

      <InfoSection title="Your Choices">
        <p>
          You can update account details in the app where available. For account, privacy, or data questions, contact support and include the email address tied to your account. Do not send passwords or sensitive financial information by email.
        </p>
      </InfoSection>

      <InfoSection title="Contact">
        <p>
          Privacy questions may be sent to support@fixmyhome.pro. We may update this Privacy Policy as the app grows, and the updated version will be posted on this page.
        </p>
      </InfoSection>
    </PublicPageShell>
  );
}