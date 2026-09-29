/**
 * Help Center content. Each article: short explanation, an instructional
 * diagram (drawn by <FlowIllustration>, in ACHIEVER colours, rendered only
 * when the article is opened), numbered steps, common problems and related
 * articles. Screen and field names match the app.
 *
 * Diagram icons are lucide icon names (see help/FlowIllustration.jsx).
 */
export const HELP_ARTICLES = [
  {
    id: 'create-osusu-group',
    title: 'How to create an Osusu group',
    category: 'Osusu',
    summary: 'Set the contribution, how often members pay, and how many people join. ACHIEVER then runs the rotation and records every payment.',
    keywords: ['osusu', 'ajo', 'esusu', 'group', 'create', 'organiser', 'rotation', 'start'],
    diagram: [
      { icon: 'UsersRound', label: 'Osusu groups', note: 'Open from the menu' },
      { icon: 'Plus', label: 'New group', note: 'Tap “New group”' },
      { icon: 'ClipboardList', label: 'Group details', note: 'Amount, frequency, members' },
      { icon: 'Share2', label: 'Invite', note: 'Share the group code' },
      { icon: 'PlayCircle', label: 'Start', note: 'Payout order is fixed', tone: 'green' },
    ],
    steps: [
      ['Open Osusu groups', 'From the menu, open Osusu groups and choose New group. Organisers must finish identity verification and accept the organiser undertaking first.'],
      ['Fill in the group details', 'Enter the Group name, Contribution per member, Frequency (daily, weekly or monthly), Number of members, Start date (first due date), Grace period and how the Payout order is decided.'],
      ['Invite members', 'Share the group code or send invitations. People join from Osusu groups → Join a group.'],
      ['Start the group', 'When everyone has joined, start the group. The payout order is fixed at that moment and cycle 1 opens.'],
    ],
    problems: [
      ['“Complete verification first”', 'Organisers need phone or email verification, a verified government ID and the signed undertaking. Open Verification from your dashboard.'],
      ['Someone joined by mistake', 'Before the group starts, the organiser can remove members from the Members tab.'],
    ],
    related: ['join-osusu-group', 'make-contribution', 'payout-order'],
  },
  {
    id: 'join-osusu-group',
    title: 'How to join an Osusu group',
    category: 'Osusu',
    summary: 'Use the group code from the organiser. If the group needs approval, the organiser confirms you before you can contribute.',
    keywords: ['join', 'code', 'invite', 'osusu', 'group', 'member'],
    diagram: [
      { icon: 'UsersRound', label: 'Osusu groups' },
      { icon: 'KeyRound', label: 'Join a group', note: 'Enter the Group code' },
      { icon: 'Hourglass', label: 'Approval', note: 'If the organiser requires it' },
      { icon: 'BadgeCheck', label: 'Member', tone: 'green' },
    ],
    steps: [
      ['Get the code', 'Ask the organiser for the group code or use the invitation link they sent.'],
      ['Join', 'Open Osusu groups → Join a group, enter the Group code and confirm.'],
      ['Wait for approval if needed', 'Some groups need the organiser to approve new members. You get a notification when you are in.'],
    ],
    problems: [['“Invalid code”', 'Codes are case-insensitive but must be complete. Ask the organiser to copy it again from the group page.']],
    related: ['make-contribution', 'create-osusu-group'],
  },
  {
    id: 'make-contribution',
    title: 'How to make a contribution',
    category: 'Payments',
    summary: 'You review the payment first, then pay on Paystack’s secure page. Your contribution counts only after ACHIEVER confirms it with Paystack.',
    keywords: ['payment', 'pay', 'contribution', 'paystack', 'card', 'transfer', 'ussd', 'due'],
    diagram: [
      { icon: 'CalendarClock', label: 'Contribution due', note: 'Dashboard or group' },
      { icon: 'ReceiptText', label: 'Review', note: 'Recipient, amount, fee, total' },
      { icon: 'ShieldCheck', label: 'Confirm payment' },
      { icon: 'CreditCard', label: 'Paystack', note: 'Card, bank transfer or USSD', tone: 'sky' },
      { icon: 'BadgeCheck', label: 'Verified', note: 'Only after server check', tone: 'green' },
    ],
    steps: [
      ['Choose the contribution', 'On your Dashboard or in the group, find the contribution that is due and tap Pay.'],
      ['Review the details', 'Check the recipient (the group pool), the cycle, the amount, the fee (ACHIEVER charges no fee) and the total. Tap Edit or Cancel if anything is wrong.'],
      ['Confirm and pay', 'Tap Confirm payment. You go to Paystack’s secure page to pay by card, bank transfer or USSD.'],
      ['Wait for verification', 'When you return, ACHIEVER checks the payment with Paystack. It shows as paid only after that check succeeds.'],
    ],
    problems: [
      ['I was charged but it still shows unpaid', 'Verification can take a few minutes. If it still shows unpaid after 30 minutes, open Help & disputes → Incorrect payment and include the Paystack reference.'],
      ['I tapped Pay twice', 'Each confirmed payment is sent once. A repeated tap reuses the same request, so you are not charged twice.'],
    ],
    related: ['payout-order', 'report-dispute', 'refund'],
  },
  {
    id: 'payout-order',
    title: 'How Osusu payouts work',
    category: 'Osusu',
    summary: 'Each cycle, one member receives the full pool in the fixed payout order. The organiser approves the payout; money goes to the member’s verified payout account.',
    keywords: ['payout', 'receive', 'pool', 'order', 'turn', 'cycle', 'withdrawal'],
    diagram: [
      { icon: 'UsersRound', label: 'All members pay' },
      { icon: 'PiggyBank', label: 'Pool is complete' },
      { icon: 'Stamp', label: 'Organiser approves' },
      { icon: 'Landmark', label: 'Sent to payout account', tone: 'green' },
    ],
    steps: [
      ['Add a payout account', 'Settings → Payment accounts. Changes need a security code and have a short waiting period for your protection.'],
      ['Wait for your turn', 'Your position is shown on the group page. The pool for a cycle is paid out once every member has contributed.'],
      ['Receive the payout', 'The organiser approves the payout; it is sent to your payout account and recorded for every member to see. Large payouts need a second approval.'],
    ],
    problems: [['My payout is late', 'A payout waits until every member has paid for that cycle. Check the cycle on the group page, or open a case under Help & disputes → Missing payout.']],
    related: ['make-contribution', 'change-payout-account', 'report-dispute'],
  },
  {
    id: 'save-with-collector',
    title: 'How to save with a Collector',
    category: 'Collector',
    summary: 'A collector keeps your savings for an agreed term and returns them at the end, minus the commission agreed before you start.',
    keywords: ['collector', 'savings', 'save', 'plan', 'commission', 'term', 'deposit'],
    diagram: [
      { icon: 'HandCoins', label: 'Collector invites you' },
      { icon: 'FileCheck2', label: 'Accept the plan', note: 'Term + commission' },
      { icon: 'PiggyBank', label: 'Save any amount', tone: 'sky' },
      { icon: 'Landmark', label: 'Return at maturity', tone: 'green' },
    ],
    steps: [
      ['Accept an invitation', 'Your collector invites you. Check the term and commission before accepting.'],
      ['Save', 'Open My savings → the plan → Save into this plan. Review the amount, then Confirm payment on Paystack.'],
      ['Track your balance', 'Total saved, balance and the time elapsed in the term are shown on the plan.'],
      ['Receive your return', 'At maturity the collector returns your savings to your payout account, and the return is recorded.'],
    ],
    problems: [['My collector has not returned my money', 'Open Help & disputes → Collector did not settle. The case is investigated with the recorded plan and payments.']],
    related: ['contact-collector', 'report-dispute', 'change-payout-account'],
  },
  {
    id: 'contact-collector',
    title: 'How to contact your Collector',
    category: 'Collector',
    summary: 'Message or call your collector inside ACHIEVER so the conversation is kept with your plan.',
    keywords: ['collector', 'message', 'contact', 'chat', 'call'],
    diagram: [
      { icon: 'PiggyBank', label: 'My savings' },
      { icon: 'FileText', label: 'Open the plan' },
      { icon: 'MessageSquare', label: 'Message', tone: 'sky' },
      { icon: 'Phone', label: 'Voice or video call', tone: 'sky' },
    ],
    steps: [
      ['Open the plan', 'Go to My savings and open the plan.'],
      ['Message or call', 'Use Message to chat, or start a voice or video call from the conversation.'],
    ],
    problems: [['I can’t hear the other person', 'Allow microphone access when your browser or phone asks. On Android, check ACHIEVER’s permissions in phone Settings → Apps.']],
    related: ['video-call', 'messages'],
  },
  {
    id: 'report-dispute',
    title: 'How to report a dispute',
    category: 'Support',
    summary: 'Open a case with the transaction, group or plan it concerns. Add evidence; it cannot be edited or deleted once added, so the record stays fair to both sides.',
    keywords: ['dispute', 'complaint', 'report', 'case', 'evidence', 'fraud', 'support', 'refund'],
    diagram: [
      { icon: 'LifeBuoy', label: 'Help & disputes' },
      { icon: 'ListChecks', label: 'What is the problem about?' },
      { icon: 'Paperclip', label: 'Add evidence', tone: 'sky' },
      { icon: 'Scale', label: 'Reviewed by ACHIEVER', tone: 'green' },
    ],
    steps: [
      ['Open a case', 'Go to Help & disputes and start a new case.'],
      ['Describe it', 'Choose what the problem is about, link the related transaction, group or savings plan, and explain what happened.'],
      ['Add evidence', 'Upload receipts or screenshots. Each file gets a fingerprint and can’t be changed later.'],
      ['Follow the case', 'Replies and decisions appear in the case. Both sides can respond.'],
    ],
    problems: [['I added the wrong file', 'Upload the correct file with a note; the earlier file stays on record but is marked as replaced.']],
    related: ['refund', 'make-contribution'],
  },
  {
    id: 'refund',
    title: 'Refunds',
    category: 'Payments',
    summary: 'Money that reached ACHIEVER but could not be applied (for example a duplicate payment) is refunded to the original payment method.',
    keywords: ['refund', 'duplicate', 'money back', 'overpaid', 'payment'],
    diagram: [
      { icon: 'CreditCard', label: 'Payment received' },
      { icon: 'SearchCheck', label: 'Can’t be applied', note: 'e.g. already paid' },
      { icon: 'RotateCcw', label: 'Refund started', tone: 'sky' },
      { icon: 'BadgeCheck', label: 'Back to your card/bank', tone: 'green' },
    ],
    steps: [
      ['Automatic refunds', 'Duplicate or late payments that cannot be applied are refunded automatically; you get a notification.'],
      ['Timing', 'Refunds usually reach your bank within 5–10 working days, depending on your bank.'],
      ['Still waiting?', 'Open Help & disputes → Incorrect payment with the payment reference.'],
    ],
    problems: [],
    related: ['report-dispute', 'make-contribution'],
  },
  {
    id: 'change-password',
    title: 'How to change your password',
    category: 'Security',
    summary: 'You confirm a warning, then enter your current password and a security code sent to your email. Other devices are signed out.',
    keywords: ['password', 'change', 'security', 'reset', 'sign in'],
    diagram: [
      { icon: 'Settings', label: 'Settings' },
      { icon: 'KeyRound', label: 'Password' },
      { icon: 'TriangleAlert', label: 'Confirm warning', tone: 'amber' },
      { icon: 'Mail', label: 'Security code', note: 'Sent to your email', tone: 'sky' },
      { icon: 'LockKeyhole', label: 'New password', tone: 'green' },
    ],
    steps: [
      ['Open Settings → Password', 'Tap Change password and read the warning: other devices will be signed out.'],
      ['Verify it’s you', 'Enter your current password. We email you a 6-digit security code.'],
      ['Set the new password', 'Enter the code and your new password twice (at least 10 characters with upper and lower case letters and a number).'],
    ],
    problems: [['I forgot my current password', 'Sign out and use “Forgot password” on the sign-in page to reset it with an emailed code.']],
    related: ['change-email', 'change-phone'],
  },
  {
    id: 'change-phone',
    title: 'How to change your phone number',
    category: 'Security',
    summary: 'A phone change needs your password and an emailed security code. When SMS verification is available the new number is also confirmed by SMS.',
    keywords: ['phone', 'number', 'change', 'sms', 'verification', 'otp'],
    diagram: [
      { icon: 'Settings', label: 'Settings' },
      { icon: 'Phone', label: 'Phone' },
      { icon: 'TriangleAlert', label: 'Confirm warning', tone: 'amber' },
      { icon: 'KeyRound', label: 'Current password' },
      { icon: 'Mail', label: 'Security code', note: 'From your email', tone: 'sky' },
      { icon: 'Smartphone', label: 'New number', note: 'SMS code if available' },
      { icon: 'BadgeCheck', label: 'Phone updated', tone: 'green' },
    ],
    steps: [
      ['Open Settings → Phone', 'Tap Change phone number and confirm the warning.'],
      ['Verify it’s you', 'Enter your current password; a security code is emailed to you.'],
      ['Enter the new number', 'Enter the security code and your new number.'],
      ['Confirm the new number', 'If SMS verification is available, enter the code sent to the new number. If SMS is temporarily unavailable, the emailed code confirms the change and you can verify the number by SMS later.'],
    ],
    problems: [['“SMS verification is temporarily unavailable”', 'Use email verification; your change still goes through securely. You can verify the number by SMS later.']],
    related: ['change-email', 'verify-phone'],
  },
  {
    id: 'change-email',
    title: 'How to change your email address',
    category: 'Security',
    summary: 'Important account and security notices go to your email, so a change needs your password, a code to your current email and a code to the new address.',
    keywords: ['email', 'change', 'address', 'security', 'verification'],
    diagram: [
      { icon: 'Settings', label: 'Settings' },
      { icon: 'Mail', label: 'Email' },
      { icon: 'TriangleAlert', label: 'Confirm warning', tone: 'amber' },
      { icon: 'KeyRound', label: 'Password + code' },
      { icon: 'MailCheck', label: 'Code to new address', tone: 'sky' },
      { icon: 'BadgeCheck', label: 'Email updated', tone: 'green' },
    ],
    steps: [
      ['Open Settings → Email', 'Tap Change email and confirm the warning.'],
      ['Verify it’s you', 'Enter your current password and the security code sent to your current email.'],
      ['Confirm the new address', 'Enter the new address and the code we send to it. Your old address gets a notice.'],
    ],
    problems: [],
    related: ['change-password', 'change-phone'],
  },
  {
    id: 'verify-phone',
    title: 'Verifying your phone number',
    category: 'Account',
    summary: 'When SMS verification is on, you confirm your phone with a code. If SMS is switched off or unavailable, your verified email is used instead.',
    keywords: ['verify', 'phone', 'sms', 'otp', 'code', 'kyc', 'email verification'],
    diagram: [
      { icon: 'MailCheck', label: 'Email verified' },
      { icon: 'MessageSquareText', label: 'SMS code', note: 'When available', tone: 'sky' },
      { icon: 'Mail', label: 'or email fallback', note: 'When SMS is unavailable', tone: 'amber' },
      { icon: 'BadgeCheck', label: 'Level 1', tone: 'green' },
    ],
    steps: [
      ['Open Verification', 'From your dashboard, open the verification steps.'],
      ['Verify', 'Tap Send SMS code and enter it. If you see “SMS verification is temporarily unavailable”, tap Use my verified email.'],
    ],
    problems: [['I never receive the SMS', 'Check the number in Settings → Phone. If SMS keeps failing, use the email option.']],
    related: ['kyc', 'change-phone'],
  },
  {
    id: 'kyc',
    title: 'Identity verification (KYC)',
    category: 'Account',
    summary: 'Higher verification levels unlock more: contributing needs level 1, receiving payouts and withdrawing need a verified government ID (level 2).',
    keywords: ['kyc', 'identity', 'verification', 'nin', 'bvn', 'id', 'passport', 'level'],
    diagram: [
      { icon: 'MailCheck', label: 'Level 0', note: 'Email verified' },
      { icon: 'UserCheck', label: 'Level 1', note: 'Phone + your details' },
      { icon: 'IdCard', label: 'Level 2', note: 'Government ID', tone: 'sky' },
      { icon: 'ShieldCheck', label: 'Level 3', note: 'Liveness + address', tone: 'green' },
    ],
    steps: [
      ['Complete your details', 'Your legal name, date of birth, state, LGA and city are needed for level 1.'],
      ['Verify a government ID', 'Choose NIN, BVN, passport, driver’s licence or voter’s card and enter the Document number exactly as printed. Only a one-way fingerprint of BVN/NIN is stored.'],
      ['Wait for review', 'Some documents are reviewed by our compliance team. You are notified of the result.'],
    ],
    problems: [['My ID was rejected', 'Check the names match your ID exactly, then submit again from Verification.']],
    related: ['verify-phone', 'delete-account'],
  },
  {
    id: 'video-call',
    title: 'Voice and video calls',
    category: 'Messages & calls',
    summary: 'Call group members or your collector from a conversation. Audio-only calls never turn on your camera.',
    keywords: ['video', 'call', 'voice', 'audio', 'microphone', 'camera', 'meeting'],
    diagram: [
      { icon: 'MessageSquare', label: 'Open a conversation' },
      { icon: 'Phone', label: 'Voice call', tone: 'sky' },
      { icon: 'Video', label: 'Video call', tone: 'sky' },
      { icon: 'Mic', label: 'Allow microphone/camera', note: 'Asked only when needed' },
    ],
    steps: [
      ['Start a call', 'In a conversation, tap the phone icon for a voice call or the camera icon for video.'],
      ['Allow access', 'The first time, allow microphone (and camera for video) when asked. ACHIEVER only asks when you start a call.'],
      ['During the call', 'Mute, turn the camera off, or switch the audio output from the call controls.'],
    ],
    problems: [['The call keeps reconnecting', 'Move to a stronger network. The call reconnects automatically when your connection returns.']],
    related: ['messages', 'contact-collector'],
  },
  {
    id: 'messages',
    title: 'Messages',
    category: 'Messages & calls',
    summary: 'Every group has a chat, and you can message members and collectors directly. Messages about money stay on record for disputes.',
    keywords: ['messages', 'chat', 'group chat', 'read receipts', 'notifications'],
    diagram: [
      { icon: 'MessageSquare', label: 'Messages' },
      { icon: 'UsersRound', label: 'Group or person' },
      { icon: 'Send', label: 'Send', tone: 'green' },
    ],
    steps: [
      ['Open Messages', 'Choose a group chat or a person.'],
      ['Settings', 'Settings → Messages controls sounds, previews, photo downloads and read receipts.'],
    ],
    problems: [],
    related: ['video-call'],
  },
  {
    id: 'change-payout-account',
    title: 'Changing your payout account',
    category: 'Payments',
    summary: 'Payouts and collector returns go to your payout account. Changing it needs a security code, and a new account waits briefly before it can receive money.',
    keywords: ['payout account', 'bank', 'account number', 'withdrawal', 'change'],
    diagram: [
      { icon: 'Settings', label: 'Settings' },
      { icon: 'Landmark', label: 'Payment accounts' },
      { icon: 'TriangleAlert', label: 'Confirm warning', tone: 'amber' },
      { icon: 'Mail', label: 'Security code', tone: 'sky' },
      { icon: 'Clock', label: 'Short waiting period', tone: 'green' },
    ],
    steps: [
      ['Open Settings → Payment accounts', 'Enter the bank and account number; the account name is checked with the bank.'],
      ['Confirm with the security code', 'Enter the code sent to your email.'],
      ['Waiting period', 'For your protection, a new account can receive money after a short waiting period.'],
    ],
    problems: [],
    related: ['payout-order', 'save-with-collector'],
  },
  {
    id: 'delete-account',
    title: 'Deleting your account',
    category: 'Account',
    summary: 'You can request deletion of your account or of optional personal data. Some financial and legally required records must be kept.',
    keywords: ['account deletion', 'delete', 'close account', 'privacy', 'data'],
    diagram: [
      { icon: 'Settings', label: 'Settings' },
      { icon: 'Trash2', label: 'Account deletion' },
      { icon: 'OctagonAlert', label: 'Read the warning', note: 'Type DELETE', tone: 'red' },
      { icon: 'KeyRound', label: 'Password + code' },
      { icon: 'Clock', label: '7 days to cancel', tone: 'sky' },
    ],
    steps: [
      ['Open Settings → Account deletion', 'Choose what to delete and read what must be kept.'],
      ['Confirm', 'Type DELETE to continue, then verify with your password and an emailed code, and confirm once more.'],
      ['Change your mind?', 'You can cancel the request for 7 days from the same page.'],
    ],
    problems: [['“Settle open groups first”', 'Accounts with open groups, savings plans or payouts must settle them before deletion.']],
    related: ['kyc'],
  },
];

export function findArticle(id) {
  return HELP_ARTICLES.find((a) => a.id === id) || null;
}

/** Simple ranked search over titles, keywords, summaries and steps. */
export function searchArticles(query) {
  const q = query.trim().toLowerCase();
  if (!q) return HELP_ARTICLES;
  const words = q.split(/\s+/).filter(Boolean);
  return HELP_ARTICLES
    .map((a) => {
      const hay = { title: a.title.toLowerCase(), kw: a.keywords.join(' '), body: `${a.summary} ${a.steps.map((s) => s.join(' ')).join(' ')}`.toLowerCase() };
      let score = 0;
      for (const w of words) {
        if (hay.title.includes(w)) score += 5;
        if (hay.kw.includes(w)) score += 4;
        if (hay.body.includes(w)) score += 1;
      }
      return { a, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .map((x) => x.a);
}
