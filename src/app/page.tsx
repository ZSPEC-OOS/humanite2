'use client'
import Link from 'next/link'

/* ── App preview card ─────────────────────────────────────────────────── */

const AI_TEXT = `Artificial intelligence has become an essential part of our daily lives. It helps us accomplish tasks quickly and efficiently. From writing emails to generating content, AI tools save time and increase productivity. However, many AI-generated texts lack a human touch and can be easily detected by AI detectors.`

const HUMAN_TEXT = `There's no denying how much artificial intelligence has become a part of our everyday lives. It helps us get things done faster, whether it's drafting an email, brainstorming ideas, or creating content. That said, AI-generated text often feels a little flat or mechanical—and honestly, it's usually pretty easy for detectors to flag.`

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden"
         style={{ background: '#06060f', color: '#fff' }}>

      {/* ── Background glows ─────────────────────────────────────── */}
      <div aria-hidden style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
      }}>
        {/* top-left purple */}
        <div style={{
          position: 'absolute', top: '-15%', left: '-10%',
          width: '55vw', height: '55vw', borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(109,40,217,0.18) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }} />
        {/* bottom-right blue */}
        <div style={{
          position: 'absolute', bottom: '-15%', right: '-10%',
          width: '45vw', height: '45vw', borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(79,70,229,0.12) 0%, transparent 70%)',
          filter: 'blur(60px)',
        }} />
        {/* dot grid at bottom */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: '340px',
          backgroundImage: 'radial-gradient(rgba(139,92,246,0.35) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          WebkitMaskImage: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 100%)',
          maskImage: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 100%)',
        }} />
      </div>

      {/* ── Navbar ───────────────────────────────────────────────── */}
      <header style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
        background: 'rgba(6,6,15,0.85)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        {/* Main bar */}
        <div style={{ display: 'flex', alignItems: 'center',
                      padding: '0 20px', height: '60px', maxWidth: 1200, margin: '0 auto' }}>
          {/* Logo */}
          <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path d="M10 1.5 12.8 8.2 19.5 10 12.8 11.8 10 18.5 7.2 11.8 0.5 10 7.2 8.2Z"
                fill="url(#nav-star)" />
              <defs>
                <linearGradient id="nav-star" x1="0" y1="0" x2="20" y2="20">
                  <stop stopColor="#a78bfa" /><stop offset="1" stopColor="#f472b6" />
                </linearGradient>
              </defs>
            </svg>
            <span style={{
              fontWeight: 800, fontSize: 18,
              background: 'linear-gradient(135deg, #fff 0%, #c084fc 45%, #fb923c 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>Humanite</span>
          </a>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <main style={{ position: 'relative', zIndex: 1, maxWidth: 1200, margin: '0 auto',
                     padding: '120px 40px 80px', display: 'flex',
                     alignItems: 'center', gap: 64, flexWrap: 'wrap' }}>

        {/* Left */}
        <div style={{ flex: '1 1 440px', display: 'flex', flexDirection: 'column', gap: 28 }}>

          {/* Badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '8px 16px', borderRadius: 999,
            border: '1px solid rgba(139,92,246,0.4)',
            background: 'rgba(139,92,246,0.1)',
            width: 'fit-content',
          }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M6 0.5 7.5 4.5 11.5 6 7.5 7.5 6 11.5 4.5 7.5 0.5 6 4.5 4.5Z"
                fill="#a78bfa"/>
            </svg>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
                           color: '#a78bfa', textTransform: 'uppercase' }}>
              AI TEXT. HUMAN IMPACT.
            </span>
          </div>

          {/* Headline */}
          <h1 style={{ margin: 0, lineHeight: 1.08, letterSpacing: '-0.02em' }}>
            <span style={{
              display: 'block', fontSize: 'clamp(52px, 6vw, 80px)', fontWeight: 900,
              background: 'linear-gradient(135deg, #ffffff 0%, #e2d9f3 30%, #c084fc 60%, #f97316 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>AI to Human</span>
            <span style={{
              display: 'block', fontSize: 'clamp(52px, 6vw, 80px)', fontWeight: 900,
              color: '#fff',
            }}>Text Converter</span>
          </h1>

          {/* Tagline */}
          <p style={{
            margin: 0, fontSize: 18, fontWeight: 500,
            background: 'linear-gradient(90deg, rgba(255,255,255,0.5) 0%, #a78bfa 50%, rgba(255,255,255,0.5) 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            — Indistinguishably Human... Text —
          </p>

          {/* Description */}
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7, color: 'rgba(255,255,255,0.5)',
                      maxWidth: 420 }}>
            Humanite transforms AI-generated text into writing that feels naturally
            human—indistinguishable, authentic, and undetectable. Perfect for essays,
            articles, emails, content, and more.
          </p>

          {/* Feature icons */}
          <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', marginTop: 4 }}>
            {[
              {
                icon: (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    <path d="M12 8v4M12 16h.01" stroke="rgba(255,255,255,0.7)" strokeLinecap="round"/>
                  </svg>
                ),
                label: 'Undetectable',
                desc: 'Bypass AI detectors with human-like authenticity.',
              },
              {
                icon: (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5">
                    <path d="M9.5 2a6.5 6.5 0 0 1 5 10.5M14.5 22a6.5 6.5 0 0 1-5-10.5"/>
                    <circle cx="9.5" cy="8.5" r="2.5"/>
                    <circle cx="14.5" cy="15.5" r="2.5"/>
                  </svg>
                ),
                label: 'Context Aware',
                desc: 'Understands meaning, tone, and intent deeply.',
              },
              {
                icon: (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ),
                label: 'Fast & Reliable',
                desc: 'Get humanized results in seconds, every time.',
              },
            ].map(f => (
              <div key={f.label} style={{ display: 'flex', flexDirection: 'column',
                                          alignItems: 'center', gap: 10, textAlign: 'center',
                                          maxWidth: 130 }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 14,
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {f.icon}
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{f.label}</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>{f.desc}</span>
              </div>
            ))}
          </div>

          {/* CTAs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap', marginTop: 4 }}>
            <Link href="/dashboard" style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '14px 28px', borderRadius: 14, fontSize: 15, fontWeight: 700,
              background: 'linear-gradient(135deg, #6d28d9, #a855f7 50%, #ec4899)',
              color: '#fff', textDecoration: 'none', boxShadow: '0 0 32px rgba(139,92,246,0.4)',
            }}>
              Open Humanite Professional
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.6"
                  strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
            <a href="#how-it-works" style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 14, color: 'rgba(255,255,255,0.55)', textDecoration: 'none',
            }}>
              Learn how it works
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M8 10h4M10 8l2 2-2 2" stroke="currentColor" strokeWidth="1.2"
                  strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </a>
          </div>
        </div>

        {/* Right — App Preview Card */}
        <div style={{ flex: '1 1 500px', display: 'flex', justifyContent: 'center' }}>
          <div style={{
            width: '100%', maxWidth: 660,
            background: 'rgba(15,12,32,0.9)',
            border: '1px solid rgba(139,92,246,0.25)',
            borderRadius: 20, padding: 24,
            boxShadow: '0 0 80px rgba(109,40,217,0.2), 0 40px 80px rgba(0,0,0,0.5)',
            animation: 'float 7s ease-in-out infinite',
          }}>
            {/* Card header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          marginBottom: 20, paddingBottom: 16,
                          borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
                  <path d="M10 1.5 12.8 8.2 19.5 10 12.8 11.8 10 18.5 7.2 11.8 0.5 10 7.2 8.2Z"
                    fill="url(#card-star)" />
                  <defs>
                    <linearGradient id="card-star" x1="0" y1="0" x2="20" y2="20">
                      <stop stopColor="#a78bfa" /><stop offset="1" stopColor="#f472b6" />
                    </linearGradient>
                  </defs>
                </svg>
                <span style={{
                  fontWeight: 700, fontSize: 15,
                  background: 'linear-gradient(135deg, #fff 0%, #c084fc 50%, #fb923c 100%)',
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                }}>Humanite</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 11, fontWeight: 600, color: '#a78bfa',
                  background: 'rgba(139,92,246,0.15)',
                  border: '1px solid rgba(139,92,246,0.3)',
                  padding: '4px 10px', borderRadius: 999,
                }}>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                    <path d="M6 0.5 7.5 4.5 11.5 6 7.5 7.5 6 11.5 4.5 7.5 0.5 6 4.5 4.5Z"
                      fill="currentColor"/>
                  </svg>
                  Pro Plan
                </span>
                <div style={{
                  width: 30, height: 30, borderRadius: '50%',
                  background: 'linear-gradient(135deg, #7c3aed, #ec4899)',
                }} />
              </div>
            </div>

            {/* Split panels */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16,
                          position: 'relative', marginBottom: 20 }}>
              {/* AI panel */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <rect x="1" y="1" width="14" height="14" rx="3" stroke="#818cf8" strokeWidth="1.3"/>
                    <path d="M4 6h8M4 9h5" stroke="#818cf8" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>
                    AI-Generated Text
                  </span>
                </div>
                <div style={{
                  background: 'rgba(255,255,255,0.04)', borderRadius: 12,
                  padding: '14px 14px 50px',
                  fontSize: 11, lineHeight: 1.7, color: 'rgba(255,255,255,0.6)',
                  minHeight: 200,
                }}>
                  {AI_TEXT}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between',
                              alignItems: 'center', marginTop: 8, padding: '0 4px' }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>123 Words</span>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
                       style={{ color: 'rgba(255,255,255,0.2)' }} aria-hidden>
                    <path d="M3 4h10M3 8h7M3 12h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                </div>
              </div>

              {/* Humanized panel */}
              <div style={{ position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <circle cx="8" cy="8" r="6.5" stroke="#a855f7" strokeWidth="1.3"/>
                    <path d="M5.5 8l2 2 3-3" stroke="#a855f7" strokeWidth="1.3"
                      strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>
                    Humanized Text
                  </span>
                </div>
                <div style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(168,85,247,0.25)',
                  borderRadius: 12,
                  padding: '14px 14px 50px',
                  fontSize: 11, lineHeight: 1.7, color: 'rgba(255,255,255,0.85)',
                  minHeight: 200,
                }}>
                  {HUMAN_TEXT}
                </div>
                {/* Green check */}
                <div style={{
                  position: 'absolute', top: 40, right: 8,
                  width: 22, height: 22, borderRadius: '50%',
                  background: '#22c55e',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                    <path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.6"
                      strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between',
                              alignItems: 'center', marginTop: 8, padding: '0 4px' }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>123 Words</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[
                      <path key="copy" d="M5 3h7v9H5zM3 5H2V14h8v-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>,
                      <path key="down" d="M8 3v7M5 8l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>,
                    ].map((p, i) => (
                      <svg key={i} width="12" height="12" viewBox="0 0 16 16" fill="none"
                           style={{ color: 'rgba(255,255,255,0.2)' }} aria-hidden>{p}</svg>
                    ))}
                  </div>
                </div>
              </div>

              {/* Center orb */}
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 10,
              }}>
                <div style={{
                  width: 52, height: 52, borderRadius: '50%',
                  background: 'rgba(15,12,32,0.95)',
                  border: '2px solid rgba(168,85,247,0.6)',
                  boxShadow: '0 0 0 8px rgba(139,92,246,0.12), 0 0 40px rgba(139,92,246,0.5)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                    <path d="M4 9h10M10 5l4 4-4 4" stroke="white" strokeWidth="1.8"
                      strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </div>
            </div>

            {/* Score bar */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
              borderTop: '1px solid rgba(255,255,255,0.07)',
              paddingTop: 16, gap: 12,
            }}>
              {/* Human score */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ position: 'relative', width: 44, height: 44, flexShrink: 0 }}>
                  <svg viewBox="0 0 36 36" style={{ width: 44, height: 44, transform: 'rotate(-90deg)' }}>
                    <circle cx="18" cy="18" r="15" fill="none"
                      stroke="rgba(255,255,255,0.08)" strokeWidth="3"/>
                    <circle cx="18" cy="18" r="15" fill="none"
                      stroke="url(#score-ring)" strokeWidth="3"
                      strokeDasharray="94.2 100" strokeLinecap="round"/>
                    <defs>
                      <linearGradient id="score-ring" x1="0" y1="0" x2="1" y2="0">
                        <stop stopColor="#a855f7"/>
                        <stop offset="1" stopColor="#06b6d4"/>
                      </linearGradient>
                    </defs>
                  </svg>
                  <span style={{
                    position: 'absolute', inset: 0, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, fontWeight: 700, color: '#fff',
                  }}>98%</span>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.6)' }}>Human Score</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#4ade80' }}>Excellent</div>
                </div>
              </div>

              {/* AI Detection */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M8 1l2 4.5L14.5 8 10.5 9.5 8 14 5.5 9.5 1.5 8 5.5 6.5Z"
                      stroke="#818cf8" strokeWidth="1.2" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.6)' }}>AI Detection</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#4ade80' }}>Undetectable</div>
                </div>
              </div>

              {/* Readability */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <circle cx="8" cy="8" r="6.5" stroke="#a855f7" strokeWidth="1.2"/>
                    <path d="M5.5 8l2 2 3-3" stroke="#a855f7" strokeWidth="1.2"
                      strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.6)' }}>Readability</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#4ade80' }}>Natural</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ── Trusted by ───────────────────────────────────────────── */}
      <section style={{
        position: 'relative', zIndex: 1,
        borderTop: '1px solid rgba(255,255,255,0.06)',
        padding: '64px 40px 80px', textAlign: 'center',
      }}>
        <p style={{
          fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.3)', marginBottom: 48,
        }}>
          Trusted by Students, Writers, Professionals &amp; Businesses
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 72, flexWrap: 'wrap' }}>
          {[
            { emoji: '🎓', label: 'Students', desc: 'Write better essays and assignments.' },
            { emoji: '✍️', label: 'Writers', desc: 'Create content that connects naturally.' },
            { emoji: '💼', label: 'Professionals', desc: 'Communicate with clarity and authenticity.' },
            { emoji: '🏢', label: 'Businesses', desc: 'Deliver messages that build trust.' },
          ].map(g => (
            <div key={g.label} style={{ display: 'flex', flexDirection: 'column',
                                        alignItems: 'center', gap: 8, maxWidth: 140 }}>
              <span style={{ fontSize: 32 }}>{g.emoji}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{g.label}</span>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)',
                             lineHeight: 1.5, textAlign: 'center' }}>{g.desc}</span>
            </div>
          ))}
        </div>
      </section>

      <style>{`
        @keyframes float {
          0%,100% { transform: translateY(0); }
          50%      { transform: translateY(-12px); }
        }
      `}</style>
    </div>
  )
}
