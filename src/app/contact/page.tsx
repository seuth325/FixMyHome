import { InfoSection, PublicPageShell } from '@/components/marketing/public-page-shell';
import { Mail, MapPin, MessageSquare } from 'lucide-react';
import { ContactForm } from '@/components/marketing/contact-form';

export const metadata = {
  title: 'Contact FixMyHome.pro',
  description: 'Contact FixMyHome Pro LLC for support, account, and marketplace questions.',
};

export default function ContactPage() {
  return (
    <PublicPageShell title="Contact FixMyHome.pro" eyebrow="Support and business inquiries">
      <InfoSection title="Contact Information">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <Mail className="size-5 text-cyan-300" />
            <p className="mt-3 font-semibold text-white">Email</p>
            <a href="mailto:support@fixmyhome.pro" className="mt-1 block text-sm text-cyan-200 hover:text-cyan-100">support@fixmyhome.pro</a>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <MapPin className="size-5 text-cyan-300" />
            <p className="mt-3 font-semibold text-white">Service Area</p>
            <p className="mt-1 text-sm text-slate-300">Florida</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <MessageSquare className="size-5 text-cyan-300" />
            <p className="mt-3 font-semibold text-white">Platform</p>
            <p className="mt-1 text-sm text-slate-300">Homeowners and handymen</p>
          </div>
        </div>
      </InfoSection>

      <InfoSection title="Contact Form">
        <ContactForm />
      </InfoSection>

      <InfoSection title="What to Include">
        <p>
          For faster support, include your name, account email, role, job title or job link if applicable, and a clear description of the issue. Do not send passwords, payment card details, or sensitive private documents by email.
        </p>
      </InfoSection>

      <InfoSection title="Business Name">
        <p>
          FixMyHome.pro is created and operated by FixMyHome Pro LLC. The platform helps homeowners post repair and improvement jobs, compare bids, message local handymen, and choose who to hire. Handymen can create profiles, submit bids, and manage customer opportunities.
        </p>
      </InfoSection>
    </PublicPageShell>
  );
}