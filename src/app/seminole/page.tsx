import type { Metadata } from 'next';
import SeminoleCampaignClient from './seminole-campaign-client';

export const metadata: Metadata = {
  title: 'Seminole Home Repair Quotes | FixMyHome.pro',
  description: 'Post a Seminole home repair project in minutes and compare bids from local service professionals.',
};

export default function SeminoleCampaignPage() {
  return <SeminoleCampaignClient />;
}
