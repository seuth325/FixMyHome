import { InfoSection, PublicPageShell } from '@/components/marketing/public-page-shell';

export const metadata = {
  title: 'User Security | FixMyHome.pro',
  description: 'Security information for FixMyHome.pro users.',
};

export default function SecurityPage() {
  return (
    <PublicPageShell title="User Security" eyebrow="Protecting your account and project communication">
      <InfoSection title="Account Protection">
        <p>
          Use a strong, unique password for FixMyHome.pro and keep your email account secure. Password reset links are sent to the account email and are designed to expire after a limited time for safety.
        </p>
        <p>
          FixMyHome.pro will never ask you to email your password. If someone asks for your password, reset it and contact support.
        </p>
      </InfoSection>

      <InfoSection title="Safe Messaging">
        <p>
          Keep project communication in the app when possible so job details, bids, and expectations stay organized. Avoid sharing unnecessary personal information, financial account numbers, or sensitive documents in messages.
        </p>
      </InfoSection>

      <InfoSection title="Hiring and Work Safety">
        <p>
          Homeowners should review bids, profile details, messages, timing, and scope before hiring. Handymen should confirm job access, site conditions, payment expectations, and required permits or licenses before work begins.
        </p>
      </InfoSection>

      <InfoSection title="Suspicious Activity">
        <p>
          Report suspicious messages, fake job posts, unusual login activity, harassment, or requests to bypass normal safety practices. Include screenshots or job links when available, but do not include passwords or private financial details.
        </p>
      </InfoSection>

      <InfoSection title="Data and Access">
        <p>
          FixMyHome.pro uses account authentication, secure reset flows, and role-based access so homeowners, handymen, and administrators see the right parts of the app. We continue improving security as the platform grows.
        </p>
      </InfoSection>
    </PublicPageShell>
  );
}