const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { geocodeLocation } = require('../src/lib/geocode');

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('password123', 10);
  const withLocation = (location) => {
    const geocode = geocodeLocation(location);
    return {
      location,
      locationLat: geocode?.latitude ?? null,
      locationLng: geocode?.longitude ?? null,
    };
  };

  await prisma.message.deleteMany();
  await prisma.supportCaseAttachment.deleteMany();
  await prisma.supportCaseComment.deleteMany();
  await prisma.supportCaseActivity.deleteMany();
  await prisma.supportCase.deleteMany();
  await prisma.paymentWebhookEvent.deleteMany();
  await prisma.checkoutSession.deleteMany();
  await prisma.userNotification.deleteMany();
  await prisma.leadCreditTransaction.deleteMany();
  await prisma.review.deleteMany();
  await prisma.moderationAuditLog.deleteMany();
  await prisma.moderationReport.deleteMany();
  await prisma.dispute.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.bid.deleteMany();
  await prisma.jobPhoto.deleteMany();
  await prisma.job.deleteMany();
  await prisma.savedSearch.deleteMany();
  await prisma.handymanProfile.deleteMany();
  await prisma.user.deleteMany();

  const admin = await prisma.user.create({
    data: {
      email: 'admin@example.com',
      name: 'FixMyHome Admin',
      passwordHash,
      role: 'ADMIN',
      ...withLocation('Columbus, OH'),
    },
  });

  const homeowner = await prisma.user.create({
    data: {
      email: 'homeowner@example.com',
      name: 'Jordan Parker',
      passwordHash,
      role: 'HOMEOWNER',
      ...withLocation('Columbus, OH 43215'),
    },
  });

  const alex = await prisma.user.create({
    data: {
      email: 'alex@example.com',
      name: 'Alex Repairs',
      passwordHash,
      role: 'HANDYMAN',
      ...withLocation('Columbus, OH'),
      handymanProfile: {
        create: {
          businessName: 'Alex Repairs Co.',
          skills: ['Painting', 'Furniture Assembly', 'Drywall'],
          bio: 'Small local crew focused on clean, on-time interior work.',
          serviceRadius: 20,
          hourlyGuideline: 65,
          subscriptionPlan: 'PLUS',
          leadCredits: 12,
          subscriptionRenewsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          insuranceVerified: true,
          licenseVerified: true,
        },
      },
    },
    include: { handymanProfile: true },
  });

  const mia = await prisma.user.create({
    data: {
      email: 'mia@example.com',
      name: 'Mia Torres',
      passwordHash,
      role: 'HANDYMAN',
      ...withLocation('Dublin, OH'),
      handymanProfile: {
        create: {
          businessName: 'Northside Handyman',
          skills: ['TV Mounting', 'Installations', 'Repairs'],
          bio: 'Fast solo operator for installs, wall repairs, and odd jobs.',
          serviceRadius: 15,
          hourlyGuideline: 75,
          subscriptionPlan: 'FREE',
          leadCredits: 2,
          insuranceVerified: true,
          licenseVerified: false,
        },
      },
    },
    include: { handymanProfile: true },
  });

  const job = await prisma.job.create({
    data: {
      homeownerId: homeowner.id,
      title: 'Paint nursery + assemble crib',
      category: 'Painting',
      description: 'Need one accent wall painted sage green, baseboards touched up, and a crib assembled. Small bedroom on second floor.',
      ...withLocation('Columbus, OH 43215'),
      budget: 300,
      preferredDate: 'Mar 15 - Mar 18',
      status: 'IN_REVIEW',
    },
  });

  const acceptedBid = await prisma.bid.create({
    data: {
      jobId: job.id,
      handymanId: alex.id,
      amount: 165,
      etaDays: 1,
      message: 'I can handle the paint touch-up and crib assembly in one visit, and I will bring drop cloths and patch small nail holes.',
      status: 'SHORTLISTED',
      shortlisted: true,
    },
  });

  const secondBid = await prisma.bid.create({
    data: {
      jobId: job.id,
      handymanId: mia.id,
      amount: 175,
      etaDays: 1,
      message: 'Available Saturday morning. Great fit if you want a quick turnaround and tidy finish work.',
      status: 'PENDING',
      shortlisted: false,
    },
  });

  await prisma.leadCreditTransaction.createMany({
    data: [
      {
        handymanProfileId: alex.handymanProfile.id,
        amount: 12,
        type: 'PLAN_GRANT',
        note: 'Plus plan seeded for demo access.',
      },
      {
        handymanProfileId: mia.handymanProfile.id,
        amount: 2,
        type: 'PLAN_GRANT',
        note: 'Free plan starter credits seeded for demo access.',
      },
    ],
  });

  await prisma.savedSearch.create({
    data: {
      userId: alex.id,
      name: 'Columbus painting leads',
      search: 'Columbus',
      category: 'Painting',
      minBudget: 150,
      sort: 'newest',
      nearMeOnly: true,
    },
  });

  await prisma.savedSupportCaseView.createMany({
    data: [
      {
        userId: admin.id,
        name: 'Team open cases',
        scope: 'SHARED',
        isPinned: true,
        isDefaultLanding: true,
        supportCaseQueue: 'team_open',
      },
      {
        userId: admin.id,
        name: 'Unassigned over 24h',
        scope: 'SHARED',
        isPinned: true,
        autoApplyOnCreate: true,
        autoAssignAdminUserId: admin.id,
        supportCaseQueue: 'overdue_24h',
        supportCaseOwner: 'unassigned',
        supportCaseStatus: 'OPEN',
      },
      {
        userId: admin.id,
        name: 'My open cases',
        scope: 'SHARED',
        isPinned: false,
        supportCaseQueue: 'my_open',
        supportCaseStatus: 'OPEN',
      },
    ],
  });

  await prisma.message.createMany({
    data: [
      {
        jobId: job.id,
        bidId: acceptedBid.id,
        senderId: homeowner.id,
        body: 'Can you confirm whether you can bring the paint or if I should have it ready?',
      },
      {
        jobId: job.id,
        bidId: acceptedBid.id,
        senderId: alex.id,
        body: 'I can pick it up if you send the exact color code before Friday morning.',
      },
      {
        jobId: job.id,
        bidId: secondBid.id,
        senderId: mia.id,
        body: 'Happy to adapt if you also want shelves mounted during the same visit.',
      },
    ],
  });

  console.log('Seeded demo users:');
  console.log('Admin: admin@example.com / password123');
  console.log('Homeowner: homeowner@example.com / password123');
  console.log('Handyman: alex@example.com / password123');
  console.log('Handyman: mia@example.com / password123');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

