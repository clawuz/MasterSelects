[Back to Feature Docs](./README.md)

# Landing Page

**Kaynak:** `src/marketing/LandingPage.tsx` + `src/marketing/landing.css`
**Deployment:** `https://masterselects-25u.pages.dev/`
**Dev URL:** `http://landing.localhost:5173/` veya `http://localhost:5173/landing`

---

## Amaç

MasterSelects editörünü ziyaret eden yeni kullanıcılar için ön yüz. Editörün kendisi doğrudan `/` root'ta kalır; landing page ayrı bir subdomain üzerinden sunulur. Kullanıcıya ürünü tanıtır, tek CTA ile editöre yönlendirir.

---

## Sayfa Yapısı

```
LandingPage
├── <header>           — Logo + "Open Editor" linki
├── <main>
│   ├── .landing-hero      — Sol: metin + CTA + signal chips
│   │                          Sağ: 3 yüzen kart (stage)
│   ├── .landing-metrics   — 3 metric kartı (entry split, dev mode, version)
│   ├── .landing-section   — "Why this split works" + 3 kolon
│   └── .landing-routes    — Dev URL tablosu (#routes anchor)
└── .landing-noise     — Arka plan grid texture (aria-hidden)
```

---

## Bölümler

### Header
- **Sol:** `MS` logo mark (turuncu gradient, rounded) + "MasterSelects" yazısı + "Landing Preview" subtitle
- **Sağ:** `Open Editor` linki → `buildEditorHref(window.location)` ile editöre yönlenir
- Pill border, hover'da `-1px translateY`

### Hero
İki sütun grid (`1.08fr / 0.92fr`):

**Sol (Copy):**
| Element | İçerik |
|---|---|
| Kicker | "Front Website Concept" |
| H1 | "Give MasterSelects a front door, without slowing down the editor." |
| Lead | Editörün neden ayrı tutulduğunu açıklar |
| Actions | "Start Editing" (primary, turuncu) + "See Dev Routes" (secondary, ghost) |
| Signal chips | Video · Audio · PDF · SVG · OBJ · JSON · CSV · glTF |

**Sağ (Stage — 3 yüzen kart):**
| Kart | Label | İçerik |
|---|---|---|
| Inputs | "Incoming Files" | PDF becomes texture / OBJ becomes geometry / CSV becomes motion data |
| Core | "MasterSelects" | "Timeline, composite, export" + açıklama metni |
| Output | "Action" | "Start Editing" teal CTA butonu |

Her kart farklı açıda döndürülmüş (`rotate(5deg)`, `-3deg`, `4deg`) ve `landingFloat` animasyonuyla yüzer.

### Metrics (3 kart)
| Kart | Label | Değer |
|---|---|---|
| Entry split | Metric | "Landing + editor" |
| Dev mode | Metric | "Separate URL" |
| Current build | Metric | `v{APP_VERSION}` (version.ts'den dinamik) |

### Why This Split Works (3 kolon)
| Başlık | Maddeler |
|---|---|
| Media first | Video and audio timelines / Image sequences / Fast jump |
| Beyond media | PDF, SVG, JSON, CSV / 3D formats / Everything can become a visual signal |
| Operator flow | Landing for onboarding / Editor uncluttered / Separate URL for power users |

### Dev Routes (#routes)
| Kart | URL |
|---|---|
| Editor | `http://localhost:5173/` |
| Landing preview | `http://landing.localhost:5173/` (accent card) |
| Fallback | `http://localhost:5173/landing` |

---

## Design System

### Renkler
| Token | Değer | Kullanım |
|---|---|---|
| `--landing-paper` | `#f4ecdc` | Ana arka plan |
| `--landing-paper-strong` | `#efe1c1` | Güçlü yüzey |
| `--landing-ink` | `#161616` | Yazı rengi |
| `--landing-muted` | `rgba(22,22,22,0.68)` | İkincil metin |
| `--landing-border` | `rgba(22,22,22,0.14)` | Kenar çizgisi |
| `--landing-accent` | `#ef562f` | Turuncu vurgu (CTA, bullet, logo) |
| `--landing-accent-strong` | `#d63b14` | Hover turuncu |
| `--landing-teal` | `#0e7c86` | Output kart CTA |

### Arka Plan
```
radial-gradient(circle at top left, rgba(239,86,47,0.22), transparent 28%)
radial-gradient(circle at 85% 18%, rgba(14,124,134,0.18), transparent 24%)
linear-gradient(180deg, #f9f4ea → #f4ecdc → #f1e4c8)
```
+ Turuncu ve teal renkte iki adet `::before`/`::after` bulanık blob
+ Grid noise overlay (28×28px, `opacity: 0.28`)

### Tipografi
| Kullanım | Font Stack |
|---|---|
| Body / UI | "Aptos", "Segoe UI Variable Display", "Trebuchet MS", sans-serif |
| Başlıklar | "Aptos Display", "Bahnschrift", "Trebuchet MS" |
| Kod blokları | "Cascadia Code", "Consolas", monospace |
| Logo mark | "Bahnschrift", "Aptos" |

### H1 Boyutu
`clamp(3rem, 8vw, 5.9rem)` — letter-spacing: -0.04em, line-height: 0.98

### Animasyonlar
```css
@keyframes landingFloat {
  0%, 100% { transform: translateY(0) rotate(var(--landing-tilt)) }
  50%       { transform: translateY(-8px) rotate(var(--landing-tilt)) }
}
```
- Inputs kart: `6s ease-in-out infinite`, tilt `5deg`
- Core kart: `7s ease-in-out infinite reverse`, tilt `-3deg`
- Output kart: `5.5s ease-in-out infinite`, tilt `4deg`

### Hover Efektleri
```css
transform: translateY(-1px)  /* tüm linkler ve butonlar */
transition: 180ms ease
```

---

## Responsive
| Breakpoint | Değişiklik |
|---|---|
| `≤ 1080px` | Hero, metrics, columns, routes → tek sütun |
| `≤ 720px` | Header dikey, H1 max-width: 100%, actions dikey, butonlar full-width |

---

## Routing

```typescript
// src/routing/entryExperience.ts
buildEditorHref(window.location)  // CTA her ortamda doğru editör URL'ini üretir
```

**Dev subdomain yönlendirmesi** (`vite.config.ts`'de):
- `landing.localhost:5173` → LandingPage render
- `localhost:5173/landing` → fallback path

**Cloudflare Pages'de:**
- Root domain → editör (app shell)
- `masterselects-25u.pages.dev` → deploy edilen tüm proje (landing dahil)

---

## Dosyalar

| Dosya | Açıklama |
|---|---|
| `src/marketing/LandingPage.tsx` | Tüm sayfa bileşeni |
| `src/marketing/landing.css` | Tüm stiller (BEM-benzeri `.landing-*` prefix) |
| `src/routing/entryExperience.ts` | `buildEditorHref()` helper |
| `src/version.ts` | `APP_VERSION` (metrics kartında gösterilir) |
| `wrangler.toml` | Cloudflare Pages config (`masterselects` project name) |

---

## Gelecek Adımlar

- [ ] "Landing Preview" label'ını gerçek production landing içeriğiyle değiştir
- [ ] Signal chips'i interaktif yap (hover'da dosya tipi açıklaması)
- [ ] Stage kartlarına gerçek ürün ekran görüntüleri ekle
- [ ] SEO meta tags ve OG image ekle
- [ ] Analytics entegrasyonu (Cloudflare Analytics veya Plausible)
- [ ] Auth durumuna göre CTA değiştir: "Start Editing" vs "Continue to Editor"
