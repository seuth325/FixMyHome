import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { buildDigestEmail, type DigestEmailData } from '@/lib/email-template';

// Mock data snapshot — mirrors what the notifications page shows for each demo user
const HOMEOWNER_DATA: DigestEmailData = {
  recipientName: 'John Smith',
  recipientEmail: 'john.homeowner@test.com',
  role: 'HOMEOWNER',
  location: 'Miami Beach',
  notifications: [
    { type: 'NEW_BID',    title: 'New bid from Sarah Williams', body: 'Sarah submitted a $140 bid on "Fix Leaky Kitchen Faucet"' },
    { type: 'NEW_BID',    title: 'New bid from Tom Martinez',   body: 'Tom submitted a $180 bid on "Fix Leaky Kitchen Faucet"' },
    { type: 'NEW_MESSAGE',title: 'Message from Tom Martinez',   body: 'Tom replied about the AC repair job' },
  ],
  activeJobs: 2,
  pendingBids: 5,
  inProgress: 1,
};

const HANDYMAN_DATA: DigestEmailData = {
  recipientName: 'Mike Johnson',
  recipientEmail: 'mike.handyman@test.com',
  role: 'HANDYMAN',
  location: 'Miami Beach',
  notifications: [
    { type: 'BID_ACCEPTED', title: 'Your bid was accepted!', body: 'John Smith accepted your $275 bid on "AC Not Cooling - Emergency Repair Needed"' },
  ],
  activeBids: 2,
  jobsWon: 1,
  matchingJobs: [
    { title: 'Fix Leaky Kitchen Faucet',     category: 'Plumbing', budget: 150,  location: '33139' },
    { title: 'Garbage Disposal Replacement', category: 'Plumbing', budget: 250,  location: '33139' },
  ],
};

export async function POST() {
  try {
    // Create an Ethereal test account on the fly — no credentials needed
    const testAccount = await nodemailer.createTestAccount();

    const transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });

    // Send homeowner email
    const homeownerInfo = await transporter.sendMail({
      from: '"FixMyHome" <noreply@fixmyhome.com>',
      to: `"John Smith" <${HOMEOWNER_DATA.recipientEmail}>`,
      subject: 'FixMyHome Weekly Digest — New Bids on Your Jobs',
      html: buildDigestEmail(HOMEOWNER_DATA),
    });

    // Send handyman email
    const handymanInfo = await transporter.sendMail({
      from: '"FixMyHome" <noreply@fixmyhome.com>',
      to: `"Mike Johnson" <${HANDYMAN_DATA.recipientEmail}>`,
      subject: 'FixMyHome Weekly Digest — Jobs Matching Your Skills in Miami Beach',
      html: buildDigestEmail(HANDYMAN_DATA),
    });

    const homeownerPreview = nodemailer.getTestMessageUrl(homeownerInfo);
    const handymanPreview  = nodemailer.getTestMessageUrl(handymanInfo);

    return NextResponse.json({
      success: true,
      homeowner: {
        email: HOMEOWNER_DATA.recipientEmail,
        previewUrl: homeownerPreview,
      },
      handyman: {
        email: HANDYMAN_DATA.recipientEmail,
        previewUrl: handymanPreview,
      },
    });
  } catch (err) {
    console.error('Test email error:', err);
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    );
  }
}
