import { InfoSection, PublicPageShell } from '@/components/marketing/public-page-shell';

export const metadata = {
  title: 'About FixMyHome.pro',
  description: 'Learn about FixMyHome Pro LLC and the FixMyHome.pro home repair marketplace.',
};

export default function AboutPage() {
  return (
    <PublicPageShell title="About FixMyHome.pro" eyebrow="Florida home repair marketplace">
      <InfoSection title="Who We Are">
        <p>
          FixMyHome.pro is created and operated by FixMyHome Pro LLC to help homeowners and local handymen connect through a clear, organized home repair marketplace.
        </p>
        <p>
          The app is built for everyday home repair and improvement projects: homeowners can explain the job, set a budget, compare bids, message local pros, and keep project communication in one place.
        </p>
      </InfoSection>

      <InfoSection title="For Homeowners">
        <p>
          FixMyHome.pro helps homeowners post repair requests with useful details, review bids side by side, and choose a handyman with more confidence. The goal is to make pricing, timing, and communication easier to understand before work begins.
        </p>
      </InfoSection>

      <InfoSection title="For Handymen">
        <p>
          Handymen can browse local jobs, submit competitive bids, message homeowners, and build a reputation through completed work and reviews. The platform is designed to reduce vague leads and make real job opportunities easier to manage.
        </p>
      </InfoSection>

      <InfoSection title="Our Standard">
        <p>
          We want FixMyHome.pro to feel professional, local, and trustworthy. That means clear project details, respectful communication, account security, and practical tools that help both sides make better decisions.
        </p>
      </InfoSection>
    </PublicPageShell>
  );
}