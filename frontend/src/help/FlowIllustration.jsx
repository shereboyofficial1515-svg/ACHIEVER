import {
  BadgeCheck, CalendarClock, ClipboardList, Clock, CreditCard, FileCheck2, FileText, HandCoins, Hourglass, IdCard, KeyRound,
  Landmark, LifeBuoy, ListChecks, LockKeyhole, Mail, MailCheck, MessageSquare, MessageSquareText, Mic, OctagonAlert, Paperclip,
  Phone, PiggyBank, PlayCircle, Plus, ReceiptText, RotateCcw, Scale, SearchCheck, Send, Settings, Share2, ShieldCheck, Smartphone,
  Stamp, Trash2, TriangleAlert, UserCheck, UsersRound, Video,
} from 'lucide-react';

const ICONS = {
  BadgeCheck, CalendarClock, ClipboardList, Clock, CreditCard, FileCheck2, FileText, HandCoins, Hourglass, IdCard, KeyRound,
  Landmark, LifeBuoy, ListChecks, LockKeyhole, Mail, MailCheck, MessageSquare, MessageSquareText, Mic, OctagonAlert, Paperclip,
  Phone, PiggyBank, PlayCircle, Plus, ReceiptText, RotateCcw, Scale, SearchCheck, Send, Settings, Share2, ShieldCheck, Smartphone,
  Stamp, Trash2, TriangleAlert, UserCheck, UsersRound, Video,
};

/**
 * Instructional diagram in ACHIEVER colours: each step is a small app
 * "screen" (icon, label, note) joined by arrows. It is real text, so it
 * scales, works in dark mode and reads naturally with a screen reader; the
 * figure also has a one-sentence description (alt).
 */
export default function FlowIllustration({ steps, alt, compact = false }) {
  return (
    <figure className={`flow ${compact ? 'flow-compact' : ''}`} aria-label={alt}>
      <ol className="flow-steps">
        {steps.map((s, i) => {
          const Icon = ICONS[s.icon] || BadgeCheck;
          return (
            <li key={`${s.label}-${i}`} className={`flow-step tone-${s.tone || 'default'}`}>
              <span className="flow-screen" aria-hidden="true">
                <span className="flow-bar" />
                <span className="flow-icon"><Icon size={compact ? 18 : 22} /></span>
              </span>
              <span className="flow-num" aria-hidden="true">{i + 1}</span>
              <span className="flow-text">
                <span className="flow-label">{s.label}</span>
                {s.note && !compact && <span className="flow-note">{s.note}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
