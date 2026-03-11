const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('password123', 10);

  await prisma.message.deleteMany();
  await prisma.review.deleteMany();
  await prisma.bid.deleteMany();
  await prisma.job.deleteMany();
  await prisma.handymanProfile.deleteMany();
  await prisma.user.deleteMany();

  const homeowner = await prisma.user.create({
    data: {
      email: 'homeowner@example.com',
      name: 'Jordan Parker',
      passwordHash,
      role: 'HOMEOWNER',
      location: 'Columbus, OH 43215',
    },
  });

  const alex = await prisma.user.create({
    data: {
      email: 'alex@example.com',
      name: 'Alex Repairs',
      passwordHash,
      role: 'HANDYMAN',
      location: 'Columbus, OH',
      handymanProfile: {
        create: {
          businessName: 'Alex Repairs Co.',
          skills: ['Painting', 'Furniture Assembly', 'Drywall'],
          bio: 'Small local crew focused on clean, on-time interior work.',
          serviceRadius: 20,
          hourlyGuideline: 65,
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
      location: 'Dublin, OH',
      handymanProfile: {
        create: {
          businessName: 'Northside Handyman',
          skills: ['TV Mounting', 'Installations', 'Repairs'],
          bio: 'Fast solo operator for installs, wall repairs, and odd jobs.',
          serviceRadius: 15,
          hourlyGuideline: 75,
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
      location: 'Columbus, OH 43215',
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
