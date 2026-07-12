// Job categories for Florida home repair market
export const JOB_CATEGORIES = [
  'Plumbing',
  'Electrical',
  'HVAC & Air Conditioning',
  'Painting',
  'Carpentry',
  'Fence Repair',
  'Landscaping & Irrigation',
  'General Handyman',
  'Appliance Repair',
  'Flooring',
  'Roofing',
  'Drywall',
  'Stucco Cracks and Repairs',
  'Pool Maintenance & Repair',
  'Screen Enclosures',
  'Pressure Washing',
  'Hurricane Shutters & Storm Prep',
  'Termite Infestations',
] as const;

export type JobCategory = (typeof JOB_CATEGORIES)[number];

// Job statuses
export const JOB_STATUSES = {
  OPEN: 'Open',
  IN_REVIEW: 'In Review',
  AWARDED: 'Awarded',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
} as const;

// Bid statuses
export const BID_STATUSES = {
  PENDING: 'Pending',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  WITHDRAWN: 'Withdrawn',
} as const;

// User roles
export const USER_ROLES = {
  HOMEOWNER: 'Homeowner',
  HANDYMAN: 'Handyman',
} as const;

// File upload limits
export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
export const MAX_FILES_PER_JOB = 5;
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Message polling interval (in milliseconds)
export const MESSAGE_POLL_INTERVAL = 3000; // 3 seconds

// Pagination
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// Budget limits
export const MIN_BUDGET = 1;
export const MAX_BUDGET = 50000;

// Rating
export const MIN_RATING = 1;
export const MAX_RATING = 5;
