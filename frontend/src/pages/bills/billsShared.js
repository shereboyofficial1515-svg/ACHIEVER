import { Dices, GraduationCap, Lightbulb, Smartphone, Ticket, Tv, Wifi } from 'lucide-react';

export const CATEGORY = {
  airtime: { icon: Smartphone, label: 'Airtime', verb: 'Airtime Purchase', blurb: 'Top up any network',
    banner: 'Top up any Nigerian number', bannerText: 'Airtime is sent straight to the number you enter, on the network you choose.' },
  data: { icon: Wifi, label: 'Data', verb: 'Data Purchase', blurb: 'Daily, weekly and monthly bundles',
    banner: 'Stay connected', bannerText: 'Bundles and prices come from your network’s current list. Any fee is shown before you pay.' },
  recharge_pin: { icon: Ticket, label: 'Recharge PIN', verb: 'Recharge PIN Purchase', blurb: 'Printable recharge PINs',
    banner: 'Recharge PINs', bannerText: 'PINs appear in your transaction details once the provider confirms them.' },
  electricity: { icon: Lightbulb, label: 'Electricity', verb: 'Electricity Payment', blurb: 'Prepaid tokens and postpaid bills',
    banner: 'Pay for power', bannerText: 'We confirm the meter with your distribution company before you pay. Prepaid tokens appear in your transaction details.' },
  tv: { icon: Tv, label: 'Cable TV', verb: 'TV Subscription', blurb: 'DStv, GOtv, StarTimes and more',
    banner: 'Renew or change your package', bannerText: 'For decoders we check your smartcard first, so you can renew your current package or pick a new one.' },
  education: { icon: GraduationCap, label: 'Exam PINs', verb: 'Exam PIN Purchase', blurb: 'WAEC and other result-checker PINs',
    banner: 'Exam and result-checker PINs', bannerText: 'Buy official PINs for exams and result checking. PINs are shown only to you, when you ask.' },
  betting: { icon: Dices, label: 'Betting', verb: 'Betting Wallet Funding', blurb: 'Fund a betting account',
    banner: 'Fund a betting account', bannerText: 'We confirm the customer ID with the provider before you pay.' },
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
  AWAITING_AUTHORIZATION: ['Not approved', 'neutral'],
};
