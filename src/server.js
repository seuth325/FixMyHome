const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const { prisma } = require('./lib/prisma');

const app = express();
const PORT = process.env.PORT || 3000;

const JOB_CATEGORIES = [
  'General Handyman',
  'Painting',
  'Furniture Assembly',
  'Electrical',
  'Plumbing',
  'Yard Help',
  'Installations',
  'Repairs',
];

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: false,
  })
);

function setFlash(req, message) {
  req.session.flash = message;
}

function popFlash(req) {
  const msg = req.session.flash;
  delete req.session.flash;
  return msg;
}

function wrap(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  return next();
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
}

function getRoleLabel(role) {
  return role === 'HOMEOWNER' ? 'Homeowner' : 'Handyman';
}

function getStatusTone(status) {
  switch (status) {
    case 'OPEN':
    case 'PENDING':
      return 'neutral';
    case 'IN_REVIEW':
    case 'SHORTLISTED':
      return 'review';
    case 'AWARDED':
    case 'ACCEPTED':
    case 'COMPLETED':
      return 'success';
    case 'DECLINED':
      return 'muted';
    default:
      return 'neutral';
  }
}

async function currentUser(req) {
  if (!req.session.userId) return null;
  return prisma.user.findUnique({
    where: { id: req.session.userId },
    include: { handymanProfile: true },
  });
}

function baseViewModel(req, user) {
  return {
    flash: popFlash(req),
    user,
    categories: JOB_CATEGORIES,
    formatCurrency,
    getRoleLabel,
    getStatusTone,
  };
}

async function loadDashboardData(user) {
  if (user.role === 'HOMEOWNER') {
    const jobs = await prisma.job.findMany({
      where: { homeownerId: user.id },
      include: {
        bids: {
          include: {
            handyman: {
              include: { handymanProfile: true },
            },
            messages: {
              include: { sender: true },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: [{ status: 'asc' }, { amount: 'asc' }, { createdAt: 'asc' }],
        },
        review: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      roleData: {
        jobs,
        jobCount: jobs.length,
        activeCount: jobs.filter((job) => job.status !== 'COMPLETED').length,
      },
    };
  }

  const [openJobs, myBids, profile] = await Promise.all([
    prisma.job.findMany({
      where: {
        status: { in: ['OPEN', 'IN_REVIEW'] },
        NOT: { homeownerId: user.id },
      },
      include: {
        bids: {
          where: { handymanId: user.id },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.bid.findMany({
      where: { handymanId: user.id },
      include: {
        job: {
          include: {
            homeowner: true,
            review: true,
          },
        },
        messages: {
          include: { sender: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.handymanProfile.findUnique({ where: { userId: user.id } }),
  ]);

  return {
    roleData: {
      openJobs,
      myBids,
      profile,
      awardedCount: myBids.filter((bid) => bid.status === 'ACCEPTED').length,
    },
  };
}

app.get('/', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  return res.redirect('/dashboard');
});

app.get('/mockup', (req, res) => {
  res.render('mockup');
});

app.get('/signup', (req, res) => {
  res.render('signup', { flash: popFlash(req) });
});

app.post('/signup', wrap(async (req, res) => {
  const { email, password, name, role, location } = req.body;
  if (!email || !password || !name || !role) {
    setFlash(req, 'Name, email, password, and role are required.');
    return res.redirect('/signup');
  }

  if (!['HOMEOWNER', 'HANDYMAN'].includes(role)) {
    setFlash(req, 'Select a valid role.');
    return res.redirect('/signup');
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    setFlash(req, 'Email already exists. Log in instead.');
    return res.redirect('/login');
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.create({
    data: {
      email: normalizedEmail,
      name: String(name).trim(),
      passwordHash,
      role,
      location: location ? String(location).trim() : null,
      handymanProfile: role === 'HANDYMAN'
        ? {
            create: {
              skills: [],
              serviceRadius: 15,
            },
          }
        : undefined,
    },
  });

  setFlash(req, 'Account created. Please log in.');
  return res.redirect('/login');
}));

app.get('/login', (req, res) => {
  res.render('login', { flash: popFlash(req) });
});

app.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    setFlash(req, 'Email and password are required.');
    return res.redirect('/login');
  }

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) {
    setFlash(req, 'Invalid email or password.');
    return res.redirect('/login');
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    setFlash(req, 'Invalid email or password.');
    return res.redirect('/login');
  }

  req.session.userId = user.id;
  return res.redirect('/dashboard');
}));

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/dashboard', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) {
    req.session.userId = null;
    return res.redirect('/login');
  }

  const data = await loadDashboardData(user);

  return res.render('dashboard', {
    ...baseViewModel(req, user),
    ...data,
  });
}));

app.post('/profile', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) {
    req.session.userId = null;
    return res.redirect('/login');
  }

  const name = String(req.body.name || '').trim();
  const location = String(req.body.location || '').trim();
  if (!name || !location) {
    setFlash(req, 'Name and location are required.');
    return res.redirect('/dashboard');
  }

  if (user.role === 'HOMEOWNER') {
    await prisma.user.update({
      where: { id: user.id },
      data: { name, location },
    });
    setFlash(req, 'Homeowner profile updated.');
    return res.redirect('/dashboard');
  }

  const skills = String(req.body.skills || '')
    .split(',')
    .map((skill) => skill.trim())
    .filter(Boolean);
  const serviceRadius = parsePositiveInt(req.body.serviceRadius);
  const hourlyGuideline = req.body.hourlyGuideline ? parsePositiveInt(req.body.hourlyGuideline) : null;

  if (!serviceRadius) {
    setFlash(req, 'Service radius must be a positive number.');
    return res.redirect('/dashboard');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      name,
      location,
      handymanProfile: {
        upsert: {
          create: {
            businessName: String(req.body.businessName || '').trim() || null,
            skills,
            bio: String(req.body.bio || '').trim() || null,
            serviceRadius,
            hourlyGuideline,
            insuranceVerified: req.body.insuranceVerified === 'on',
            licenseVerified: req.body.licenseVerified === 'on',
          },
          update: {
            businessName: String(req.body.businessName || '').trim() || null,
            skills,
            bio: String(req.body.bio || '').trim() || null,
            serviceRadius,
            hourlyGuideline,
            insuranceVerified: req.body.insuranceVerified === 'on',
            licenseVerified: req.body.licenseVerified === 'on',
          },
        },
      },
    },
  });

  setFlash(req, 'Handyman profile updated.');
  return res.redirect('/dashboard');
}));

app.post('/jobs', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user || user.role !== 'HOMEOWNER') {
    setFlash(req, 'Only homeowners can post jobs.');
    return res.redirect('/dashboard');
  }

  const title = String(req.body.title || '').trim();
  const category = String(req.body.category || '').trim();
  const description = String(req.body.description || '').trim();
  const location = String(req.body.location || '').trim();
  const budget = parsePositiveInt(req.body.budget);
  const preferredDate = String(req.body.preferredDate || '').trim();

  if (!title || !category || !description || !location || !budget) {
    setFlash(req, 'Title, category, description, location, and budget are required.');
    return res.redirect('/dashboard');
  }

  await prisma.job.create({
    data: {
      homeownerId: user.id,
      title,
      category,
      description,
      location,
      budget,
      preferredDate: preferredDate || null,
      status: 'OPEN',
    },
  });

  setFlash(req, 'Job posted successfully.');
  return res.redirect('/dashboard');
}));

app.post('/jobs/:id/status', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  const job = await prisma.job.findUnique({ where: { id: req.params.id }, include: { bids: true, review: true } });
  if (!user || !job || job.homeownerId !== user.id) {
    setFlash(req, 'Job not found.');
    return res.redirect('/dashboard');
  }

  const action = String(req.body.action || '');
  if (action === 'review' && job.status === 'OPEN') {
    await prisma.job.update({ where: { id: job.id }, data: { status: 'IN_REVIEW' } });
    setFlash(req, 'Job moved to In Review.');
    return res.redirect('/dashboard');
  }

  if (action === 'complete' && job.status === 'AWARDED') {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    setFlash(req, 'Job marked completed. Leave a review below.');
    return res.redirect('/dashboard');
  }

  setFlash(req, 'That job update is not available right now.');
  return res.redirect('/dashboard');
}));

app.post('/jobs/:id/bids', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user || user.role !== 'HANDYMAN') {
    setFlash(req, 'Only handymen can submit bids.');
    return res.redirect('/dashboard');
  }

  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job || !['OPEN', 'IN_REVIEW'].includes(job.status)) {
    setFlash(req, 'This job is not accepting bids right now.');
    return res.redirect('/dashboard');
  }

  const amount = parsePositiveInt(req.body.amount);
  const etaDays = parsePositiveInt(req.body.etaDays);
  const message = String(req.body.message || '').trim();

  if (!amount || !etaDays || !message) {
    setFlash(req, 'Amount, ETA, and message are required to submit a bid.');
    return res.redirect('/dashboard');
  }

  await prisma.bid.upsert({
    where: {
      jobId_handymanId: {
        jobId: job.id,
        handymanId: user.id,
      },
    },
    create: {
      jobId: job.id,
      handymanId: user.id,
      amount,
      etaDays,
      message,
    },
    update: {
      amount,
      etaDays,
      message,
      status: 'PENDING',
      shortlisted: false,
    },
  });

  const bidCount = await prisma.bid.count({ where: { jobId: job.id } });
  if (job.status === 'OPEN' && bidCount > 0) {
    await prisma.job.update({ where: { id: job.id }, data: { status: 'IN_REVIEW' } });
  }

  setFlash(req, 'Bid saved. You can update it until the homeowner awards the job.');
  return res.redirect('/dashboard');
}));

app.post('/bids/:id/shortlist', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  const bid = await prisma.bid.findUnique({
    where: { id: req.params.id },
    include: { job: true },
  });

  if (!user || !bid || bid.job.homeownerId !== user.id) {
    setFlash(req, 'Bid not found.');
    return res.redirect('/dashboard');
  }

  await prisma.bid.update({
    where: { id: bid.id },
    data: { shortlisted: true, status: 'SHORTLISTED' },
  });

  if (bid.job.status === 'OPEN') {
    await prisma.job.update({ where: { id: bid.jobId }, data: { status: 'IN_REVIEW' } });
  }

  setFlash(req, 'Bid shortlisted.');
  return res.redirect('/dashboard');
}));

app.post('/bids/:id/accept', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  const bid = await prisma.bid.findUnique({
    where: { id: req.params.id },
    include: { job: { include: { bids: true } } },
  });

  if (!user || !bid || bid.job.homeownerId !== user.id) {
    setFlash(req, 'Bid not found.');
    return res.redirect('/dashboard');
  }

  if (bid.job.status === 'COMPLETED') {
    setFlash(req, 'Completed jobs cannot be re-awarded.');
    return res.redirect('/dashboard');
  }

  await prisma.$transaction([
    prisma.bid.updateMany({
      where: { jobId: bid.jobId, NOT: { id: bid.id } },
      data: { status: 'DECLINED', shortlisted: false },
    }),
    prisma.bid.update({
      where: { id: bid.id },
      data: { status: 'ACCEPTED', shortlisted: true },
    }),
    prisma.job.update({
      where: { id: bid.jobId },
      data: {
        status: 'AWARDED',
        acceptedBidId: bid.id,
        awardedAt: new Date(),
      },
    }),
  ]);

  setFlash(req, 'Bid accepted and job awarded.');
  return res.redirect('/dashboard');
}));

app.post('/bids/:id/messages', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) {
    req.session.userId = null;
    return res.redirect('/login');
  }

  const bid = await prisma.bid.findUnique({
    where: { id: req.params.id },
    include: { job: true },
  });
  if (!bid) {
    setFlash(req, 'Conversation not found.');
    return res.redirect('/dashboard');
  }

  const allowed = bid.job.homeownerId === user.id || bid.handymanId === user.id;
  if (!allowed) {
    setFlash(req, 'You do not have access to that conversation.');
    return res.redirect('/dashboard');
  }

  const body = String(req.body.body || '').trim();
  if (!body) {
    setFlash(req, 'Message cannot be empty.');
    return res.redirect('/dashboard');
  }

  await prisma.message.create({
    data: {
      jobId: bid.jobId,
      bidId: bid.id,
      senderId: user.id,
      body,
    },
  });

  setFlash(req, 'Message sent.');
  return res.redirect('/dashboard');
}));

app.post('/jobs/:id/reviews', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: { acceptedBid: true, review: true },
  });

  if (!user || !job || job.homeownerId !== user.id) {
    setFlash(req, 'Job not found.');
    return res.redirect('/dashboard');
  }

  if (job.status !== 'COMPLETED' || !job.acceptedBid || job.review) {
    setFlash(req, 'Review is not available for this job.');
    return res.redirect('/dashboard');
  }

  const stars = parsePositiveInt(req.body.stars);
  const text = String(req.body.text || '').trim();
  if (!stars || stars > 5 || !text) {
    setFlash(req, 'Provide a 1-5 star rating and a short review.');
    return res.redirect('/dashboard');
  }

  await prisma.review.create({
    data: {
      jobId: job.id,
      reviewerId: user.id,
      handymanId: job.acceptedBid.handymanId,
      stars,
      text,
    },
  });

  const reviews = await prisma.review.findMany({
    where: { handymanId: job.acceptedBid.handymanId },
    select: { stars: true },
  });
  const ratingCount = reviews.length;
  const ratingAvg = ratingCount === 0
    ? 0
    : reviews.reduce((sum, review) => sum + review.stars, 0) / ratingCount;

  await prisma.handymanProfile.update({
    where: { userId: job.acceptedBid.handymanId },
    data: { ratingAvg, ratingCount },
  });

  setFlash(req, 'Review submitted.');
  return res.redirect('/dashboard');
}));

app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
  setFlash(req, 'Server error. Please try again.');
  if (res.headersSent) return next(err);
  return res.redirect('/dashboard');
});

app.listen(PORT, () => {
  console.log(`FixMyHome web app running at http://localhost:${PORT}`);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
