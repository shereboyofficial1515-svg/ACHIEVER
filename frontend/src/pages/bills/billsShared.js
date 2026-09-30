import { Dices, GraduationCap, Lightbulb, Smartphone, Ticket, Tv, Wifi } from 'lucide-react';

export const CATEGORY = {
  airtime: { icon: Smartphone, label: 'Airtime', verb: 'Airtime Purchase', blurb: 'Top up any network' },
  data: { icon: Wifi, label: 'Data', verb: 'Data Purchase', blurb: 'Daily, weekly and monthly bundles' },
  recharge_pin: { icon: Ticket, label: 'Recharge PIN', verb: 'Recharge PIN Purchase', blurb: 'Printable recharge PINs' },
  electricity: { icon: Lightbulb, label: 'Electricity', verb: 'Electricity Payment', blurb: 'Prepaid tokens and postpaid bills' },
  tv: { icon: Tv, label: 'Cable TV', verb: 'TV Subscription', blurb: 'DStv, GOtv, StarTimes and more' },
  education: { icon: GraduationCap, label: 'Exam PINs', verb: 'Exam PIN Purchase', blurb: 'WAEC and other result-checker PINs' },
  betting: { icon: Dices, label: 'Betting', verb: 'Betting Wallet Funding', blurb: 'Fund a betting account' },
};

export const CATEGORY_ORDER = ['airtime', 'data', 'electricity', 'tv', 'education', 'recharge_pin', 'betting'];

/** Why a category is not available, in plain words (never raw provider errors). */
export const UNAVAILABLE_REASON = {
  NOT_CONFIGURED: 'Bill payment is temporarily unavailable. Please try again shortly.',
  DISABLED: 'Currently unavailable.',
  MAINTENANCE: 'Temporarily paused for maintenance.',
  PROVIDER_UNAVAILABLE: 'Bill payment is temporarily unavailable. Please try again shortly.',
  NOT_OFFERED: 'Currently unavailable.',
  NO_SERVICES: 'Currently unavailable.',
};

export const STATUS_TEXT = {
  SUCCESS: ['Successful', 'success'],
  PROCESSING: ['Processing', 'info'],
  PENDING: ['Pending', 'warning'],
  UNKNOWN: ['Awaiting confirmation', 'info'],
  FAILED: ['Not completed', 'danger'],
  REVERSED: ['Reversed', 'warning'],
  REFUNDED: ['Refunded', 'neutral'],
  CANCELLED: ['Cancelled', 'neutral'],
};
