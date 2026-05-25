'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { searchFamiliesClient } from '@/features/setu/search/search-families-client';
import type { FamilySearchHit } from '@/features/setu/search/search-families-client';

export function WelcomeSearch() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<FamilySearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic sequence counter — drops responses from older queries when a
  // newer one has already fired. Without this, a slow response from "patel"
  // could clobber the screen after the user typed "patel-extended" and got
  // its fresher results back.
  const seqRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (!trimmed) {
      setHits([]);
      setSearched(false);
      setError(null);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const mySeq = ++seqRef.current;
      setLoading(true);
      setError(null);
      try {
        const results = await searchFamiliesClient(trimmed);
        if (mySeq !== seqRef.current) return; // stale — newer query has fired
        setHits(results);
        setSearched(true);
      } catch {
        if (mySeq !== seqRef.current) return;
        setError('Search failed. Please try again.');
        setHits([]);
        setSearched(true);
      } finally {
        if (mySeq === seqRef.current) setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div>
      {/* Search input */}
      <div style={{ position: 'relative', marginBottom: 20 }}>
        <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }}>
          <SetuIcon.search/>
        </div>
        <input
          data-testid="welcome-search-input"
          type="search"
          placeholder="Name, email, phone, or FID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: '100%', padding: '12px 14px 12px 40px',
            fontSize: 15, border: '1px solid var(--line)',
            borderRadius: 'var(--radius)', background: 'var(--surface)',
            color: 'var(--ink)', outline: 'none', boxSizing: 'border-box',
          }}
        />
        {loading && (
          <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 12 }}>
            Searching…
          </div>
        )}
      </div>

      {/* Error toast */}
      {error && (
        <div style={{ padding: '10px 14px', background: '#fff3ec', border: '1px solid var(--err)', borderRadius: 'var(--radiusSm)', marginBottom: 14, fontSize: 13, color: 'var(--err)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <SetuIcon.warn color="var(--err)"/> {error}
        </div>
      )}

      {/* Empty state */}
      {!query.trim() && (
        <p style={{ fontSize: 14, color: 'var(--muted)', textAlign: 'center', marginTop: 32 }}>
          Start typing a name, email, phone, or FID to search.
        </p>
      )}

      {/* No results */}
      {searched && !loading && !error && hits.length === 0 && query.trim() && (
        <p style={{ fontSize: 14, color: 'var(--muted)', textAlign: 'center', marginTop: 32 }}>
          No matching families found.
        </p>
      )}

      {/* Results */}
      {hits.length > 0 && (
        <div className="col" style={{ gap: 8 }} data-testid="search-results">
          {hits.map((hit) => (
            <Link
              key={hit.fid}
              href={`/welcome/family/${hit.fid}`}
              className="focus-ring"
              style={{
                display: 'block', padding: 16,
                background: 'var(--surface)', border: '1px solid var(--line)',
                borderRadius: 'var(--radius)', textDecoration: 'none', color: 'inherit',
              }}
            >
              <div className="between">
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{hit.name} Family</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>
                    FID {hit.fid}{hit.legacyFid ? ` · Legacy ${hit.legacyFid}` : ''} · {hit.location}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{hit.memberCount} member{hit.memberCount !== 1 ? 's' : ''}</div>
                  <SetuIcon.chevron color="var(--muted)"/>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
