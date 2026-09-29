import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, LifeBuoy, Search, Share2 } from 'lucide-react';
import { Button, EmptyState, PageHeader } from '../components/ui/index.js';
import BrandLogo from '../components/brand/BrandLogo.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useDebounce } from '../hooks/useDebounce.js';
import { shareContent } from '../platform/index.js';
import FlowIllustration from './FlowIllustration.jsx';
import { findArticle, HELP_ARTICLES, searchArticles } from './articles.js';
import { helpAsset } from '../content/helpCenterAssets.js';

function useBase() {
  // Signed-in members get the Help Center inside the app shell (/app/help); everyone else at /help.
  return useLocation().pathname.startsWith('/app/') ? '/app/help' : '/help';
}

/** Reusable article layout: title, explanation, diagram, steps, problems, related, contact. */
export function HelpArticle({ article }) {
  const base = useBase();
  const { status } = useAuth();
  const asset = helpAsset(article.id);
  const related = article.related.map(findArticle).filter(Boolean);
  const share = async () => {
    await shareContent({ title: article.title, text: article.summary, url: `${(import.meta.env.VITE_PUBLIC_SITE_URL || window.location.origin).replace(/\/$/, '')}/help/${article.id}` });
  };
  return (
    <article className="help-article stack-lg">
      <div>
        <Link className="back-link" to={base}><ArrowLeft size={16} aria-hidden="true" /> Help Center</Link>
        <span className="chip">{article.category}</span>
        <h1 style={{ marginTop: 8 }}>{article.title}</h1>
        <p className="muted" style={{ marginTop: 6 }}>{article.summary}</p>
      </div>
      {asset && <FlowIllustration steps={asset.steps} alt={asset.alt} />}
      <section className="card card-body stack">
        <h2>Steps</h2>
        <ol className="help-steps">
          {article.steps.map(([title, text]) => (
            <li key={title}>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      {article.problems.length > 0 && (
        <section className="card card-body stack-sm">
          <h2>Common problems</h2>
          {article.problems.map(([q, a]) => (
            <details key={q}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{q}</summary>
              <p className="small muted" style={{ marginTop: 6 }}>{a}</p>
            </details>
          ))}
        </section>
      )}
      {related.length > 0 && (
        <section className="stack-sm">
          <h2>Related articles</h2>
          <div className="help-grid">
            {related.map((r) => <ArticleCard key={r.id} article={r} />)}
          </div>
        </section>
      )}
      <section className="card card-body row-between">
        <div>
          <strong>Still need help?</strong>
          <p className="small muted">Our support team replies inside the app, and every case is recorded.</p>
        </div>
        <div className="row-wrap">
          <Button variant="ghost" size="sm" icon={Share2} onClick={share}>Share</Button>
          <Button variant="info" size="sm" icon={LifeBuoy} to={status === 'authenticated' ? '/app/support' : '/support.html'}>Contact support</Button>
        </div>
      </section>
    </article>
  );
}

function ArticleCard({ article }) {
  const base = useBase();
  const asset = helpAsset(article.id);
  return (
    <Link className="help-card" to={`${base}/${article.id}`}>
      <span className="cat">{article.category}</span>
      <strong>{article.title}</strong>
      <p>{article.summary}</p>
      {asset && <FlowIllustration steps={asset.steps.slice(0, 4)} alt="" compact />}
    </Link>
  );
}

export default function HelpCenter() {
  const { articleId } = useParams();
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 150);
  const results = useMemo(() => searchArticles(debounced), [debounced]);
  const article = articleId ? findArticle(articleId) : null;

  if (articleId) {
    return article ? <HelpArticle article={article} /> : <EmptyState title="Article not found" message="Search the Help Center for another topic." />;
  }
  return (
    <div className="stack-lg">
      <section className="help-hero">
        <h1>Help Center</h1>
        <p>Step-by-step guides with pictures for Osusu, collector savings, payments, security and your account.</p>
        <div className="help-search">
          <Search size={18} aria-hidden="true" />
          <input className="input" type="search" placeholder="Search: payment, payout, phone, KYC, refund…" aria-label="Search help articles"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </section>
      <p className="small muted" aria-live="polite">
        {debounced ? `${results.length} article${results.length === 1 ? '' : 's'} for “${debounced}”` : `${HELP_ARTICLES.length} articles`}
      </p>
      {results.length ? (
        <div className="help-grid">{results.map((a) => <ArticleCard key={a.id} article={a} />)}</div>
      ) : (
        <EmptyState title="No articles found" message="Try a different word, or contact support." />
      )}
    </div>
  );
}

/** Public wrapper (no sign-in needed) with a light header. */
export function PublicHelpCenter() {
  const { status } = useAuth();
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-background)' }}>
      <header className="topbar" style={{ position: 'static' }}>
        <BrandLogo variant="mark" width={36} height={36} />
        <span className="topbar-title">Help Center</span>
        <div className="actions">
          <Button size="sm" variant="secondary" to={status === 'authenticated' ? '/app' : '/login'}>{status === 'authenticated' ? 'Open app' : 'Sign in'}</Button>
        </div>
      </header>
      <main className="main" id="main" style={{ paddingBottom: 48 }}>
        <PageHeader title="" />
        <HelpCenter />
      </main>
    </div>
  );
}
